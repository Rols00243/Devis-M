using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class MaterialTools(ToolRunner runner, IRobotGateway gateway, ModelService model, UnitService units)
{
    [McpServerTool(Name = "get_materials", ReadOnly = true, Idempotent = true)]
    [Description("Matériaux définis dans le projet (E, ν, G en MPa ; poids volumique en kN/m³ ; fy en MPa).")]
    public Task<CallToolResult> GetMaterials() =>
        runner.RunAsync("get_materials", SafetyLevel.Read, null, _ => gateway.GetMaterials().Select(Out.Material).ToList());

    [McpServerTool(Name = "get_material", ReadOnly = true, Idempotent = true)]
    [Description("Propriétés d'un matériau du projet.")]
    public Task<CallToolResult> GetMaterial(string name) =>
        runner.RunAsync("get_material", SafetyLevel.Read, new { name }, _ =>
            Out.Material(gateway.GetMaterials().FirstOrDefault(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase))
                         ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Matériau « {name} » inexistant.")));

    [McpServerTool(Name = "create_material")]
    [Description("Crée un matériau : soit depuis la base de matériaux Robot (database_name, ex. « C30/37 », « S355 »), soit personnalisé (E, nu, poids volumique… avec unités explicites).")]
    public Task<CallToolResult> CreateMaterial(
        [Description("Nom de l'étiquette matériau dans le projet.")] string name,
        [Description("Type : concrete, steel, aluminium, timber, other.")] string type,
        [Description("Nom dans la base de matériaux Robot (prioritaire), ex. « C30/37 ».")] string? database_name = null,
        [Description("Module d'Young.")] double? e = null,
        [Description("Unité de E et fy (MPa, GPa, Pa).")] StressUnit? stress_unit = null,
        [Description("Coefficient de Poisson (0..0.5).")] double? nu = null,
        [Description("Poids volumique.")] double? unit_weight = null,
        [Description("Unité du poids volumique (kN/m3, N/m3).")] UnitWeightUnit? unit_weight_unit = null,
        [Description("Coefficient de dilatation thermique (1/°C).")] double? thermal_expansion = null,
        [Description("Limite élastique fy (acier).")] double? yield_strength = null) =>
        runner.RunAsync("create_material", SafetyLevel.Write,
            new { name, type, database_name, e, stress_unit, nu, unit_weight, unit_weight_unit, thermal_expansion, yield_strength },
            ctx => Upsert(ctx, name, type, database_name, e, stress_unit, nu, unit_weight, unit_weight_unit, thermal_expansion, yield_strength, mustExist: false));

    [McpServerTool(Name = "update_material")]
    [Description("Modifie un matériau existant (seuls les champs fournis changent).")]
    public Task<CallToolResult> UpdateMaterial(string name, string? type = null, double? e = null, StressUnit? stress_unit = null, double? nu = null,
        double? unit_weight = null, UnitWeightUnit? unit_weight_unit = null, double? thermal_expansion = null, double? yield_strength = null) =>
        runner.RunAsync("update_material", SafetyLevel.Write,
            new { name, type, e, stress_unit, nu, unit_weight, unit_weight_unit, thermal_expansion, yield_strength },
            ctx => Upsert(ctx, name, type, null, e, stress_unit, nu, unit_weight, unit_weight_unit, thermal_expansion, yield_strength, mustExist: true));

    private object Upsert(OperationContext ctx, string name, string? type, string? db, double? e, StressUnit? su, double? nu,
        double? uw, UnitWeightUnit? uwu, double? lx, double? fy, bool mustExist)
    {
        var existing = gateway.GetMaterials().FirstOrDefault(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase));
        var v = new Validator().NotEmpty(name, "name");
        if (mustExist && existing is null) throw new RobotMcpException(ErrorCodes.NotFound, $"Matériau « {name} » inexistant.");
        if (!mustExist && existing is not null) ctx.Warn("MATERIAL_EXISTS", $"Le matériau « {name} » existait déjà : il est mis à jour.");
        type ??= existing?.Type;
        v.Require(type is "concrete" or "steel" or "aluminium" or "timber" or "other", "type doit valoir concrete, steel, aluminium, timber ou other.");
        if ((e is not null || fy is not null) && su is null) v.Error("stress_unit est obligatoire lorsque e ou yield_strength est fourni.", ErrorCodes.UnitError);
        if (uw is not null && uwu is null) v.Error("unit_weight_unit est obligatoire lorsque unit_weight est fourni.", ErrorCodes.UnitError);
        if (!mustExist && db is null && existing is null) v.Require(e is not null && nu is not null && uw is not null,
            "Matériau personnalisé : fournir e, nu et unit_weight (ou database_name).");
        if (nu is not null) v.Range(nu.Value, 0, 0.5, "nu", "-");
        v.ThrowIfAny();
        double? E = e is null ? null : units.ToSi(e.Value, su!.Value);
        double? RO = uw is null ? null : units.ToSi(uw.Value, uwu!.Value);
        double? FY = fy is null ? null : units.ToSi(fy.Value, su!.Value);
        if (E is not null) v.Range(E.Value, Validator.Limits.MinE, Validator.Limits.MaxE, "E", "Pa");
        if (RO is not null) v.Range(RO.Value, 0, Validator.Limits.MaxUnitWeight, "unit_weight", "N/m3");
        v.ThrowIfAny();
        if (type == "concrete" && E is { } ec && (ec < 20e9 || ec > 50e9))
            ctx.Warn("UNUSUAL_E", $"E = {ec / 1e9:F1} GPa inhabituel pour un béton (≈ 27–44 GPa) : vérifiez l'unité.");
        if (type == "steel" && E is { } es && (es < 180e9 || es > 220e9))
            ctx.Warn("UNUSUAL_E", $"E = {es / 1e9:F1} GPa inhabituel pour un acier (≈ 210 GPa) : vérifiez l'unité.");
        if (type == "concrete" && RO is { } rc && (rc < 20e3 || rc > 28e3))
            ctx.Warn("UNUSUAL_UNIT_WEIGHT", $"Poids volumique {rc / 1e3:F1} kN/m³ inhabituel pour un béton armé (≈ 25 kN/m³).");
        gateway.UpsertMaterial(new MaterialDefinition(name, type!, db, E, nu, null, RO, lx, FY));
        ctx.Touch("material", name);
        return Out.Material(gateway.GetMaterials().First(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)));
    }

    [McpServerTool(Name = "assign_material")]
    [Description("Affecte un matériau à des barres, ou à des panneaux (via une épaisseur dérivée portant ce matériau).")]
    public Task<CallToolResult> AssignMaterial(string material, ElementKindInput element_type, int[] ids) =>
        runner.RunAsync("assign_material", SafetyLevel.Write, new { material, element_type, ids }, ctx =>
        {
            new Validator().NotEmpty(ids, "ids").Require(element_type != ElementKindInput.Node, "Un nœud ne porte pas de matériau.").ThrowIfAny();
            model.RequireMaterial(material);
            if (element_type == ElementKindInput.Bar)
            {
                model.RequireBars(ids);
                gateway.AssignMaterial(ElementKind.Bar, ids, material);
                ctx.Touch("bar", ids);
                return new { assigned = ids.Length, element_type = "bar", material };
            }
            model.RequirePanels(ids);
            var panels = gateway.GetPanels(ids);
            var created = new List<string>();
            foreach (var g in panels.GroupBy(p => p.ThicknessValue))
            {
                if (g.Key is null)
                {
                    ctx.Warn("NO_THICKNESS", $"Panneaux sans épaisseur lisible ignorés : {SelectionParser.Format(g.Select(p => p.Id))}.");
                    continue;
                }
                var thick = model.EnsureThickness(g.Key.Value, material, ctx);
                gateway.AssignThickness(g.Select(p => p.Id).ToList(), thick);
                created.Add(thick);
            }
            ctx.Touch("panel", ids);
            return new { assigned = ids.Length, element_type = "panel", material, thickness_labels = created };
        });
}

[McpServerToolType]
public sealed class SectionTools(ToolRunner runner, IRobotGateway gateway, ModelService model, UnitService units)
{
    [McpServerTool(Name = "get_sections", ReadOnly = true, Idempotent = true)]
    [Description("Sections de barres du projet : forme, dimensions (m), matériau, propriétés (SI : m², m⁴) et nombre de barres qui l'utilisent.")]
    public Task<CallToolResult> GetSections() =>
        runner.RunAsync("get_sections", SafetyLevel.Read, null, _ =>
        {
            var usage = gateway.GetBars().GroupBy(b => b.Section ?? "").ToDictionary(g => g.Key, g => g.Count());
            return gateway.GetSections().Select(s => new { section = Out.Section(s), bars = usage.GetValueOrDefault(s.Name) }).ToList();
        });

    [McpServerTool(Name = "get_section", ReadOnly = true, Idempotent = true)]
    [Description("Détail d'une section et barres qui l'utilisent.")]
    public Task<CallToolResult> GetSection(string name) =>
        runner.RunAsync("get_section", SafetyLevel.Read, new { name }, _ =>
        {
            var s = gateway.GetSections().FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))
                    ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Section « {name} » inexistante.");
            var bars = gateway.GetBars().Where(b => b.Section == s.Name).Select(b => b.Id);
            return new { section = Out.Section(s), bars = SelectionParser.Format(bars) };
        });

    [McpServerTool(Name = "create_section")]
    [Description("Crée une section : concrete_beam_rect (b,h), concrete_column_rect (b,h ; carré si b=h), concrete_column_circular (d), steel_database (profile, ex. « HEA 200 »), tube (d,t), rect_tube (b,h,t). Dimensions avec unité obligatoire.")]
    public Task<CallToolResult> CreateSection(string name, SectionShape shape,
        [Description("Unité des dimensions (m, cm, mm).")] LengthUnit dimension_unit,
        double? b = null, double? h = null, double? d = null, double? t = null,
        [Description("Profil de la base Robot (shape=steel_database).")] string? profile = null,
        [Description("Matériau existant associé à la section.")] string? material = null) =>
        runner.RunAsync("create_section", SafetyLevel.Write, new { name, shape, dimension_unit, b, h, d, t, profile, material },
            ctx => Upsert(ctx, name, shape, dimension_unit, b, h, d, t, profile, material, mustExist: false));

    [McpServerTool(Name = "update_section")]
    [Description("Redéfinit une section existante (toutes les barres qui l'utilisent sont affectées).")]
    public Task<CallToolResult> UpdateSection(string name, SectionShape shape, LengthUnit dimension_unit,
        double? b = null, double? h = null, double? d = null, double? t = null, string? profile = null, string? material = null) =>
        runner.RunAsync("update_section", SafetyLevel.Write, new { name, shape, dimension_unit, b, h, d, t, profile, material },
            ctx => Upsert(ctx, name, shape, dimension_unit, b, h, d, t, profile, material, mustExist: true));

    internal object Upsert(OperationContext ctx, string name, SectionShape shape, LengthUnit u, double? b, double? h, double? d, double? t,
        string? profile, string? material, bool mustExist)
    {
        var def = SectionFactory.Build(units, name, shape, u, b, h, d, t, profile, material, ctx);
        var exists = gateway.GetSections().Any(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));
        if (mustExist && !exists) throw new RobotMcpException(ErrorCodes.NotFound, $"Section « {name} » inexistante.");
        if (!mustExist && exists) ctx.Warn("SECTION_EXISTS", $"La section « {name} » existait déjà : elle est redéfinie.");
        if (material is not null) model.RequireMaterial(material);
        gateway.UpsertSection(def);
        ctx.Touch("section", name);
        return Out.Section(gateway.GetSections().First(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)));
    }

    [McpServerTool(Name = "assign_section")]
    [Description("Affecte une section existante à une ou plusieurs barres (ids, sélection Robot, groupe ou filtre de rôle).")]
    public Task<CallToolResult> AssignSection(string section, int[]? bar_ids = null, string? selection = null, string? group = null,
        BarRoleFilter role = BarRoleFilter.Any) =>
        runner.RunAsync("assign_section", SafetyLevel.Write, new { section, bar_ids, selection, group, role }, ctx =>
        {
            if (bar_ids is null && selection is null && group is null)
                throw new ValidationException("Préciser les barres (bar_ids, selection ou group).");
            var bars = model.ResolveBars(bar_ids, selection, group, role).Select(x => x.Id).ToList();
            model.AssignSection(bars, section, ctx);
            return new { section, bars = SelectionParser.Format(bars), count = bars.Count };
        });

    [McpServerTool(Name = "assign_sections")]
    [Description("Affectations de sections en lot : [{section, bar_ids}, …].")]
    public Task<CallToolResult> AssignSections(SectionAssignment[] assignments) =>
        runner.RunAsync("assign_sections", SafetyLevel.Write, new { assignments }, ctx =>
        {
            new Validator().NotEmpty(assignments, "assignments").ThrowIfAny();
            var known = gateway.GetSections().Select(s => s.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var v = new Validator();
            foreach (var a in assignments.Where(a => !known.Contains(a.Section))) v.Error($"Section « {a.Section} » inexistante.", ErrorCodes.NotFound);
            v.ThrowIfAny();
            model.RequireBars(assignments.SelectMany(a => a.BarIds));
            foreach (var a in assignments) model.AssignSection(a.BarIds, a.Section, ctx);
            return assignments.Select(a => new { a.Section, bars = SelectionParser.Format(a.BarIds) }).ToList();
        });

    [McpServerTool(Name = "get_thicknesses", ReadOnly = true, Idempotent = true)]
    [Description("Épaisseurs de panneaux définies (m) et matériau.")]
    public Task<CallToolResult> GetThicknesses() =>
        runner.RunAsync("get_thicknesses", SafetyLevel.Read, null, _ => new { thicknesses = gateway.GetThicknesses(), units = new { thickness = "m" } });

    [McpServerTool(Name = "create_thickness")]
    [Description("Crée/modifie une épaisseur de panneau homogène.")]
    public Task<CallToolResult> CreateThickness(double thickness, LengthUnit thickness_unit, string? material = null, string? name = null) =>
        runner.RunAsync("create_thickness", SafetyLevel.Write, new { thickness, thickness_unit, material, name }, ctx =>
            new { name = model.EnsureThickness(units.ToSi(thickness, thickness_unit), material, ctx, name) });
}

/// <summary>Construction et validation des définitions de section (partagé avec les tools de haut niveau).</summary>
public static class SectionFactory
{
    public static SectionDefinition Build(UnitService units, string name, SectionShape shape, LengthUnit u, double? b, double? h, double? d, double? t,
        string? profile, string? material, OperationContext ctx)
    {
        var v = new Validator().NotEmpty(name, "name");
        double? B = b is null ? null : units.ToSi(b.Value, u), H = h is null ? null : units.ToSi(h.Value, u),
            D = d is null ? null : units.ToSi(d.Value, u), T = t is null ? null : units.ToSi(t.Value, u);
        void Dim(double? x, string n)
        {
            if (x is null) v.Error($"{n} est obligatoire pour la forme {shape}.");
            else v.Range(x.Value, Validator.Limits.MinSectionDim, Validator.Limits.MaxSectionDim, n, "m");
        }
        switch (shape)
        {
            case SectionShape.ConcreteBeamRect or SectionShape.ConcreteColumnRect: Dim(B, "b"); Dim(H, "h"); break;
            case SectionShape.ConcreteColumnCircular: Dim(D, "d"); break;
            case SectionShape.Tube: Dim(D, "d"); Dim(T, "t"); if (D is not null && T is not null) v.Require(2 * T < D, "Épaisseur de tube trop grande (2t ≥ d)."); break;
            case SectionShape.RectTube: Dim(B, "b"); Dim(H, "h"); Dim(T, "t"); if (B is not null && H is not null && T is not null) v.Require(2 * T < Math.Min(B.Value, H.Value), "Épaisseur trop grande (2t ≥ min(b,h))."); break;
            case SectionShape.SteelDatabase: v.NotEmpty(profile, "profile"); break;
        }
        v.ThrowIfAny();
        if (shape is SectionShape.ConcreteBeamRect or SectionShape.ConcreteColumnRect)
        {
            if (Math.Min(B!.Value, H!.Value) < 0.10) ctx.Warn("UNUSUAL_DIMENSION", $"Section béton {name} : dimension < 10 cm, inhabituelle.");
            if (Math.Max(B.Value, H.Value) > 3) ctx.Warn("UNUSUAL_DIMENSION", $"Section béton {name} : dimension > 3 m, vérifiez l'unité.");
            if (shape == SectionShape.ConcreteBeamRect && H < B) ctx.Warn("BEAM_ORIENTATION", $"Poutre {name} : h < b (poutre « à plat »), vérifiez l'ordre b × h.");
        }
        return new SectionDefinition(name, shape, B, H, D, T, profile, material);
    }
}
