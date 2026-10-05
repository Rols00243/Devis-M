using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Tools.Infrastructure;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>Conversion (unités explicites → SI), validation et application des charges.</summary>
public sealed class LoadService(IRobotGateway gateway, ModelService model, UnitService units)
{
    public LoadDefinition ToDefinition(LoadInput l, Validator v, OperationContext ctx)
    {
        Dimension dim = l.Kind switch
        {
            LoadKind.NodalForce or LoadKind.BarPointForce => Dimension.Force,
            LoadKind.BarUniform => Dimension.LinearLoad,
            LoadKind.PanelUniform => Dimension.SurfaceLoad,
            LoadKind.BarTemperature => Dimension.Temperature,
            _ => Dimension.Dimensionless,
        };
        double Si(double x) => units.ToSi(x, l.Unit, dim);
        double fx = 0, fy = 0, fz = 0, mx = 0, my = 0, mz = 0;
        if (l.Kind != LoadKind.SelfWeight && l.Kind != LoadKind.BarTemperature)
        {
            fx = Si(l.X);
            fy = Si(l.Y);
            fz = Si(l.Z);
            if (fx == 0 && fy == 0 && fz == 0 && !(l.Kind == LoadKind.NodalForce && (l.MX != 0 || l.MY != 0 || l.MZ != 0)))
                v.Error($"Charge {l.Kind} du cas {l.CaseId} : toutes les composantes sont nulles.");
        }
        else
        {
            units.ToSi(0, l.Unit, dim); // vérifie que l'unité est cohérente avec le type de charge
        }
        if (l.Kind == LoadKind.NodalForce && (l.MX != 0 || l.MY != 0 || l.MZ != 0))
        {
            if (l.MomentUnit is null) v.Error("moment_unit est obligatoire pour des moments nodaux.", ErrorCodes.UnitError);
            else
            {
                mx = units.ToSi(l.MX, l.MomentUnit, Dimension.Moment);
                my = units.ToSi(l.MY, l.MomentUnit, Dimension.Moment);
                mz = units.ToSi(l.MZ, l.MomentUnit, Dimension.Moment);
            }
        }
        if (l.Kind != LoadKind.SelfWeight) v.Require(l.Objects.Length > 0, $"Charge {l.Kind} du cas {l.CaseId} : « objects » ne doit pas être vide.");
        if (l.Kind == LoadKind.SelfWeight) v.Range(l.Factor, 0.01, 10, "factor", "-");
        if (l.Kind == LoadKind.BarPointForce)
        {
            if (l.Position is null) v.Error("bar_point_force : position obligatoire.");
            else if (l.Relative) v.Range(l.Position.Value, 0, 1, "position", "(relative)");
            else v.Range(l.Position.Value, 0, Validator.Limits.MaxBarLength, "position", "m");
        }
        if (l.Kind == LoadKind.BarTemperature) v.Range(l.Temperature, -200, 200, "temperature", "degC");

        // Valeurs manifestement incohérentes (souvent une erreur d'unité) : avertissement.
        var magnitude = Math.Sqrt(fx * fx + fy * fy + fz * fz);
        if (l.Kind == LoadKind.PanelUniform && magnitude > 100e3)
            ctx.Warn("UNUSUAL_LOAD", $"Charge surfacique de {magnitude / 1e3:F1} kN/m² très élevée : vérifiez l'unité.");
        if (l.Kind == LoadKind.BarUniform && magnitude > 1000e3)
            ctx.Warn("UNUSUAL_LOAD", $"Charge linéique de {magnitude / 1e3:F1} kN/m très élevée : vérifiez l'unité.");
        if (l.Kind is LoadKind.NodalForce or LoadKind.BarPointForce && magnitude > 1e8)
            ctx.Warn("UNUSUAL_LOAD", $"Force de {magnitude / 1e3:F0} kN très élevée : vérifiez l'unité.");
        if (l.Kind is LoadKind.PanelUniform or LoadKind.BarUniform && fz > 0 && !l.Local)
            ctx.Warn("UPWARD_LOAD", $"Charge du cas {l.CaseId} dirigée vers le HAUT (+Z). Une charge de gravité doit être négative en Z.");

        return new LoadDefinition(l.Kind, l.Objects, fx, fy, fz, mx, my, mz, l.Position, l.Relative, l.Local, l.Factor, l.Temperature);
    }

    /// <summary>Valide puis applique un lot de charges (aucune écriture si une seule charge est invalide).</summary>
    public IReadOnlyList<object> Apply(IReadOnlyList<LoadInput> loads, OperationContext ctx, int maxBatch)
    {
        var v = new Validator();
        v.NotEmpty(loads, "loads").Require(loads.Count <= maxBatch, $"Lot trop grand ({loads.Count}).");
        v.ThrowIfAny();
        var cases = gateway.GetLoadCases().ToDictionary(c => c.Id);
        var defs = new List<(LoadInput In, LoadDefinition Def)>();
        foreach (var l in loads)
        {
            if (!cases.TryGetValue(l.CaseId, out var c)) v.Error($"Cas {l.CaseId} inexistant (create_load_case).", ErrorCodes.NotFound);
            else if (c.Kind != "simple") v.Error($"Le cas {l.CaseId} est une combinaison : impossible d'y placer une charge.");
            try
            {
                defs.Add((l, ToDefinition(l, v, ctx)));
            }
            catch (RobotMcpException ex)
            {
                v.Error(ex.Message, ex.Code);
            }
        }
        v.ThrowIfAny();
        model.RequireNodes(defs.Where(d => d.Def.Kind == LoadKind.NodalForce).SelectMany(d => d.Def.Objects));
        model.RequireBars(defs.Where(d => d.Def.Kind is LoadKind.BarUniform or LoadKind.BarPointForce or LoadKind.BarTemperature).SelectMany(d => d.Def.Objects));
        model.RequirePanels(defs.Where(d => d.Def.Kind == LoadKind.PanelUniform).SelectMany(d => d.Def.Objects));
        if (defs.Any(d => d.Def.Kind == LoadKind.SelfWeight && d.Def.Objects.Count > 0))
            model.RequireBars(defs.Where(d => d.Def.Kind == LoadKind.SelfWeight).SelectMany(d => d.Def.Objects));

        var applied = new List<object>();
        foreach (var (input, def) in defs)
        {
            var index = gateway.AddLoad(input.CaseId, def);
            ctx.Touch("load", $"{input.CaseId}#{index}");
            applied.Add(new { case_id = input.CaseId, record_index = index, kind = def.Kind, objects = SelectionParser.Format(def.Objects), input_unit = input.Unit });
        }
        return applied;
    }
}
