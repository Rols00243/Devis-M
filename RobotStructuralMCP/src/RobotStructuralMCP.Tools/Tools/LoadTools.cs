using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class LoadTools(ToolRunner runner, IRobotGateway gateway, LoadService loads, UnitService units, ConfirmationService confirm)
{
    private int MaxBatch => runner.Safety.MaxBatchSize;

    [McpServerTool(Name = "get_load_cases", ReadOnly = true, Idempotent = true)]
    [Description("Cas de charges (simples et combinaisons) : numéro, nom, nature, type d'analyse, nombre de charges.")]
    public Task<CallToolResult> GetLoadCases() =>
        runner.RunAsync("get_load_cases", SafetyLevel.Read, null, _ => gateway.GetLoadCases());

    [McpServerTool(Name = "create_load_case")]
    [Description("Crée un cas de charge simple. Nature : permanent, live (exploitation), wind, snow, temperature, accidental, seismic. Analyse : static_linear (défaut), static_nonlinear, modal (modal_modes), buckling.")]
    public Task<CallToolResult> CreateLoadCase(string name, CaseNature nature, AnalysisKind analysis = AnalysisKind.StaticLinear,
        int? id = null, [Description("Nombre de modes (analyse modale).")] int? modal_modes = null) =>
        runner.RunAsync("create_load_case", SafetyLevel.Write, new { name, nature, analysis, id, modal_modes }, ctx =>
        {
            var v = new Validator().NotEmpty(name, "name").Id(id, "id");
            if (analysis == AnalysisKind.Modal) v.Require(modal_modes is >= 1 and <= 1000, "modal_modes (1..1000) est obligatoire pour une analyse modale.");
            v.ThrowIfAny();
            int caseId = id ?? gateway.NextCaseId();
            if (gateway.CaseExists(caseId)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Le cas {caseId} existe déjà.");
            if (analysis == AnalysisKind.Buckling)
                ctx.Warn("BUCKLING_CASE", "Analyse de flambement : Robot l'applique aux charges de ce cas ; vérifiez ses paramètres dans Robot.");
            gateway.CreateLoadCase(caseId, name, nature, analysis, modal_modes);
            ctx.Touch("case", new[] { caseId });
            return gateway.GetLoadCases().First(c => c.Id == caseId);
        });

    [McpServerTool(Name = "delete_load_case", Destructive = true)]
    [Description("Supprime un cas de charge ou une combinaison. Si le cas contient des charges ou est utilisé par des combinaisons : confirmation explicite requise.")]
    public Task<CallToolResult> DeleteLoadCase(int id, string? confirmation_token = null) =>
        runner.RunAsync("delete_load_case", SafetyLevel.Destructive, new { id, confirmation_token }, ctx =>
        {
            var c = gateway.GetLoadCases().FirstOrDefault(x => x.Id == id) ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Cas {id} inexistant.");
            var usedBy = gateway.GetCombinations().Where(k => k.Factors.Any(f => f.CaseId == id)).Select(k => k.Id).ToList();
            if (c.RecordCount > 0 || usedBy.Count > 0)
                confirm.Require("delete_load_case", id.ToString(), confirmation_token,
                    $"le cas {id} « {c.Name} » ({c.RecordCount} charge(s)) sera supprimé ; combinaisons qui l'utilisent : {(usedBy.Count == 0 ? "aucune" : SelectionParser.Format(usedBy))}.");
            gateway.DeleteCase(id);
            ctx.Touch("case", new[] { id });
            return new { deleted_case = id, affected_combinations = usedBy };
        });

    [McpServerTool(Name = "get_loads", ReadOnly = true, Idempotent = true)]
    [Description("Charges d'un cas (ou de tous) : type, objets, valeurs en SI avec leurs unités.")]
    public Task<CallToolResult> GetLoads(int? case_id = null) =>
        runner.RunAsync("get_loads", SafetyLevel.Read, new { case_id }, _ => gateway.GetLoads(case_id).Select(Out.Load).ToList());

    [McpServerTool(Name = "delete_load")]
    [Description("Supprime une charge (enregistrement n° record_index) d'un cas.")]
    public Task<CallToolResult> DeleteLoad(int case_id, int record_index) =>
        runner.RunAsync("delete_load", SafetyLevel.Write, new { case_id, record_index }, ctx =>
        {
            gateway.DeleteLoad(case_id, record_index);
            ctx.Touch("load", $"{case_id}#{record_index}");
            return new { case_id, deleted_record = record_index, note = "Les enregistrements suivants du cas sont renumérotés." };
        });

    [McpServerTool(Name = "add_self_weight")]
    [Description("Ajoute le poids propre (direction −Z) à un cas, sur toute la structure (défaut) ou sur des barres données.")]
    public Task<CallToolResult> AddSelfWeight(int case_id, [Description("Coefficient multiplicateur (1 = poids propre).")] double factor = 1,
        [Description("Barres concernées (vide = toute la structure).")] int[]? bar_ids = null) =>
        Apply("add_self_weight", new LoadInput { Kind = LoadKind.SelfWeight, CaseId = case_id, Factor = factor, Objects = bar_ids ?? Array.Empty<int>(), Unit = "-" });

    [McpServerTool(Name = "add_nodal_load")]
    [Description("Force (et moment) concentrés sur des nœuds, repère global. Z négatif = vers le bas.")]
    public Task<CallToolResult> AddNodalLoad(int case_id, int[] node_ids, ForceUnit force_unit, double fx = 0, double fy = 0, double fz = 0,
        double mx = 0, double my = 0, double mz = 0, MomentUnit? moment_unit = null) =>
        Apply("add_nodal_load", new LoadInput
        {
            Kind = LoadKind.NodalForce, CaseId = case_id, Objects = node_ids, X = fx, Y = fy, Z = fz, Unit = force_unit.ToString(),
            MX = mx, MY = my, MZ = mz, MomentUnit = moment_unit?.ToString(),
        });

    [McpServerTool(Name = "add_bar_uniform_load")]
    [Description("Charge uniformément répartie sur des barres (repère global par défaut). Ex. pz=-10 kN/m.")]
    public Task<CallToolResult> AddBarUniformLoad(int case_id, int[] bar_ids, LinearLoadUnit load_unit, double px = 0, double py = 0, double pz = 0,
        [Description("Repère local de la barre.")] bool local = false) =>
        Apply("add_bar_uniform_load", new LoadInput
        {
            Kind = LoadKind.BarUniform, CaseId = case_id, Objects = bar_ids, X = px, Y = py, Z = pz, Unit = UnitService.Symbol(load_unit), Local = local,
        });

    [McpServerTool(Name = "add_bar_point_load")]
    [Description("Force concentrée sur des barres à une position (relative 0..1 par défaut, ou absolue en m).")]
    public Task<CallToolResult> AddBarPointLoad(int case_id, int[] bar_ids, ForceUnit force_unit, double position, bool relative = true,
        double fx = 0, double fy = 0, double fz = 0, bool local = false) =>
        Apply("add_bar_point_load", new LoadInput
        {
            Kind = LoadKind.BarPointForce, CaseId = case_id, Objects = bar_ids, X = fx, Y = fy, Z = fz, Unit = force_unit.ToString(),
            Position = position, Relative = relative, Local = local,
        });

    [McpServerTool(Name = "add_panel_load")]
    [Description("Charge surfacique uniforme sur des panneaux donnés. Ex. pz=-2 kN/m2 (exploitation).")]
    public Task<CallToolResult> AddPanelLoad(int case_id, int[] panel_ids, SurfaceLoadUnit load_unit, double px = 0, double py = 0, double pz = 0,
        bool local = false) =>
        Apply("add_panel_load", new LoadInput
        {
            Kind = LoadKind.PanelUniform, CaseId = case_id, Objects = panel_ids, X = px, Y = py, Z = pz, Unit = UnitService.Symbol(load_unit), Local = local,
        });

    [McpServerTool(Name = "add_surface_load")]
    [Description("Charge surfacique verticale uniforme sur TOUTES les dalles (panneaux horizontaux), éventuellement limitées à une altitude. Valeur négative = vers le bas.")]
    public Task<CallToolResult> AddSurfaceLoad(int case_id, double pz, SurfaceLoadUnit load_unit,
        [Description("Altitude des dalles à charger (optionnel).")] double? z_level = null, LengthUnit? length_unit = null) =>
        runner.RunAsync("add_surface_load", SafetyLevel.Write, new { case_id, pz, load_unit, z_level, length_unit }, ctx =>
        {
            if (z_level is not null && length_unit is null) throw new RobotMcpException(ErrorCodes.UnitError, "length_unit est obligatoire avec z_level.");
            double? z = z_level is null ? null : units.ToSi(z_level.Value, length_unit!.Value);
            var slabs = gateway.GetPanels().Where(p => p.Contour.Count >= 3 && GeometryMath.Orientation(p.Contour) == "horizontal"
                                                      && (z is null || Math.Abs(p.Contour[0].Z - z.Value) < ModelService.CoincidenceTolerance))
                .Select(p => p.Id).ToArray();
            if (slabs.Length == 0) throw new RobotMcpException(ErrorCodes.NotFound, "Aucune dalle (panneau horizontal) correspondante.");
            return new
            {
                slabs = SelectionParser.Format(slabs),
                applied = loads.Apply(new[] { new LoadInput { Kind = LoadKind.PanelUniform, CaseId = case_id, Objects = slabs, Z = pz, Unit = UnitService.Symbol(load_unit) } }, ctx, MaxBatch),
            };
        });

    [McpServerTool(Name = "add_temperature_load")]
    [Description("Variation uniforme de température sur des barres (°C).")]
    public Task<CallToolResult> AddTemperatureLoad(int case_id, int[] bar_ids, [Description("Variation uniforme ΔT en °C.")] double delta_t_degc) =>
        Apply("add_temperature_load", new LoadInput { Kind = LoadKind.BarTemperature, CaseId = case_id, Objects = bar_ids, Temperature = delta_t_degc, Unit = "degC" });

    [McpServerTool(Name = "apply_loads")]
    [Description("Applique un lot de charges hétérogènes en un appel (validation complète avant écriture). Chaque charge précise kind, case_id, objects, composantes et unit.")]
    public Task<CallToolResult> ApplyLoads(LoadInput[] loads_list) =>
        runner.RunAsync("apply_loads", SafetyLevel.Write, new { loads_list }, ctx => new { applied = loads.Apply(loads_list, ctx, MaxBatch) });

    private Task<CallToolResult> Apply(string op, LoadInput input) =>
        runner.RunAsync(op, SafetyLevel.Write, input, ctx => new { applied = loads.Apply(new[] { input }, ctx, MaxBatch) });
}
