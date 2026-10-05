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
using static RobotStructuralMCP.Core.Units.UnitService;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class HighLevelTools(ToolRunner runner, IRobotGateway gateway, ModelService model, StructureBuilder builder, LoadService loads,
    UnitService units, ModelChecker checker, AnalysisTracker tracker, ResultService results, ProposalStore proposals, SummaryService summary)
{
    private int MaxBatch => runner.Safety.MaxBatchSize;
    private double[] L(double[] values, LengthUnit u) => values.Select(v => units.ToSi(v, u)).ToArray();

    // ------------------------------------------------------------------ Création de structures

    [McpServerTool(Name = "create_3d_frame")]
    [Description("Crée un portique 3D régulier : grille de poteaux (travées x_spans × y_spans), étages storey_heights, poutres dans les deux directions, appuis en pied. Sections existantes (create_section) optionnelles. Checkpoint automatique.")]
    public Task<CallToolResult> Create3DFrame(
        [Description("Longueurs des travées en X (ex. [5, 5, 6]).")] double[] x_spans,
        [Description("Longueurs des travées en Y (vide = portique plan).")] double[] y_spans,
        [Description("Hauteurs des étages, du bas vers le haut.")] double[] storey_heights,
        [Description("Unité de toutes les longueurs.")] LengthUnit length_unit,
        string? column_section = null, string? beam_section = null,
        [Description("« fixed », « pinned » ou nom d'un appui existant.")] string support = "fixed",
        double origin_x = 0, double origin_y = 0, double origin_z = 0, bool beams_x = true, bool beams_y = true) =>
        runner.RunAsync("create_3d_frame", SafetyLevel.Write,
            new { x_spans, y_spans, storey_heights, length_unit, column_section, beam_section, support, origin_x, origin_y, origin_z, beams_x, beams_y }, ctx =>
            {
                var f = builder.BuildFrame(new Point3(units.ToSi(origin_x, length_unit), units.ToSi(origin_y, length_unit), units.ToSi(origin_z, length_unit)),
                    L(x_spans, length_unit), L(y_spans ?? Array.Empty<double>(), length_unit), L(storey_heights, length_unit),
                    column_section, beam_section, support, beams_x, beams_y, ctx, MaxBatch);
                if (column_section is null || beam_section is null) ctx.Warn("NO_SECTION", "Des barres ont été créées sans section : affectez-les avant le calcul.");
                return FrameData(f);
            }, new RunOptions { Checkpoint = true });

    private static object FrameData(FrameResult f) => new
    {
        nodes = f.Nodes.Count, columns = SelectionParser.Format(f.Columns), beams_x = SelectionParser.Format(f.BeamsX), beams_y = SelectionParser.Format(f.BeamsY),
        base_nodes = SelectionParser.Format(f.BaseNodes), levels_z_m = f.LevelsZ.Select(z => Round(z, 4)),
    };

    [McpServerTool(Name = "create_grid_structure")]
    [Description("Crée une grille horizontale de poutres (plancher, grillage) à l'altitude z, avec appuis aux coins, en périphérie, partout ou nulle part.")]
    public Task<CallToolResult> CreateGridStructure(double[] x_spans, double[] y_spans, double z, LengthUnit length_unit,
        string? beam_section = null, [Description("corners, perimeter, all ou none.")] string support_nodes = "corners",
        [Description("« fixed », « pinned » ou appui existant.")] string support = "pinned", double origin_x = 0, double origin_y = 0) =>
        runner.RunAsync("create_grid_structure", SafetyLevel.Write, new { x_spans, y_spans, z, length_unit, beam_section, support_nodes, support, origin_x, origin_y }, ctx =>
        {
            var v = new Validator();
            StructureBuilder.ValidateSpans(v, L(x_spans, length_unit), "x_spans");
            StructureBuilder.ValidateSpans(v, L(y_spans, length_unit), "y_spans");
            v.Require(support_nodes is "corners" or "perimeter" or "all" or "none", "support_nodes : corners, perimeter, all ou none.");
            v.ThrowIfAny();
            var xs = StructureBuilder.Cumulative(units.ToSi(origin_x, length_unit), L(x_spans, length_unit));
            var ys = StructureBuilder.Cumulative(units.ToSi(origin_y, length_unit), L(y_spans, length_unit));
            var zz = units.ToSi(z, length_unit);
            var nodes = model.CreateNodes(ys.SelectMany(y => xs.Select(x => new NewNode(null, new Point3(x, y, zz)))).ToList(), ctx, MaxBatch, reuseCoincident: true);
            int Id(int ix, int iy) => nodes[iy * xs.Count + ix].Id;
            var bars = new List<NewBar>();
            for (int iy = 0; iy < ys.Count; iy++)
                for (int ix = 0; ix < xs.Count; ix++)
                {
                    if (ix + 1 < xs.Count) bars.Add(new NewBar(null, Id(ix, iy), Id(ix + 1, iy), beam_section));
                    if (iy + 1 < ys.Count) bars.Add(new NewBar(null, Id(ix, iy), Id(ix, iy + 1), beam_section));
                }
            var created = model.CreateBars(bars, ctx, MaxBatch);
            var supported = new List<int>();
            for (int iy = 0; iy < ys.Count; iy++)
                for (int ix = 0; ix < xs.Count; ix++)
                {
                    bool edgeX = ix == 0 || ix == xs.Count - 1, edgeY = iy == 0 || iy == ys.Count - 1;
                    if (support_nodes == "all" || (support_nodes == "perimeter" && (edgeX || edgeY)) || (support_nodes == "corners" && edgeX && edgeY))
                        supported.Add(Id(ix, iy));
                }
            if (supported.Count > 0) gateway.AssignSupport(supported, builder.EnsureSupport(support, ctx));
            return new { nodes = nodes.Count, bars = SelectionParser.Format(created.Select(b => b.Id)), supported_nodes = SelectionParser.Format(supported), z_m = zz };
        }, new RunOptions { Checkpoint = true });

    [McpServerTool(Name = "create_rc_building")]
    [Description("Crée un bâtiment béton armé complet : matériau (base Robot, ex. « C30/37 »), sections poteaux/poutres rectangulaires, portique 3D, dalles par travée à chaque niveau, encastrements en pied. Toutes les dimensions avec unités explicites. Checkpoint automatique.")]
    public Task<CallToolResult> CreateRcBuilding(double[] x_spans, double[] y_spans, double[] storey_heights, LengthUnit length_unit,
        [Description("Béton de la base Robot, ex. « C30/37 ».")] string concrete,
        double column_b, double column_h, double beam_b, double beam_h,
        [Description("Unité des dimensions de sections.")] LengthUnit section_unit,
        double slab_thickness, LengthUnit slab_thickness_unit,
        [Description("« fixed », « pinned » ou appui existant.")] string support = "fixed",
        [Description("Créer les dalles.")] bool create_slabs = true) =>
        runner.RunAsync("create_rc_building", SafetyLevel.Write,
            new { x_spans, y_spans, storey_heights, length_unit, concrete, column_b, column_h, beam_b, beam_h, section_unit, slab_thickness, slab_thickness_unit, support, create_slabs }, ctx =>
            {
                if (!gateway.GetMaterials().Any(m => string.Equals(m.Name, concrete, StringComparison.OrdinalIgnoreCase)))
                {
                    gateway.UpsertMaterial(new MaterialDefinition(concrete, "concrete", concrete, null, null, null, null, null, null));
                    ctx.Touch("material", concrete);
                }
                string Cm(double v, LengthUnit u) => Math.Round(units.ToSi(v, u) * 100, 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
                var colName = $"POT {Cm(column_b, section_unit)}x{Cm(column_h, section_unit)}";
                var beamName = $"POU {Cm(beam_b, section_unit)}x{Cm(beam_h, section_unit)}";
                gateway.UpsertSection(SectionFactory.Build(units, colName, SectionShape.ConcreteColumnRect, section_unit, column_b, column_h, null, null, null, concrete, ctx));
                gateway.UpsertSection(SectionFactory.Build(units, beamName, SectionShape.ConcreteBeamRect, section_unit, beam_b, beam_h, null, null, null, concrete, ctx));
                ctx.Touch("section", colName);
                ctx.Touch("section", beamName);
                var f = builder.BuildFrame(new Point3(0, 0, 0), L(x_spans, length_unit), L(y_spans, length_unit), L(storey_heights, length_unit),
                    colName, beamName, support, true, true, ctx, MaxBatch);
                gateway.AssignMaterial(ElementKind.Bar, f.Columns.Concat(f.BeamsX).Concat(f.BeamsY).ToList(), concrete);
                IReadOnlyList<int> slabs = Array.Empty<int>();
                if (create_slabs && x_spans.Length > 0 && y_spans.Length > 0)
                {
                    var thick = model.EnsureThickness(units.ToSi(slab_thickness, slab_thickness_unit), concrete, ctx);
                    slabs = builder.SlabsPerBay(f, thick, ctx);
                }
                return new
                {
                    frame = FrameData(f), material = concrete, column_section = colName, beam_section = beamName,
                    slabs = SelectionParser.Format(slabs), slab_thickness_m = units.ToSi(slab_thickness, slab_thickness_unit),
                    next_steps = "apply_standard_building_loads → generate_combinations → check_model → analyze_structure",
                };
            }, new RunOptions { Checkpoint = true });

    [McpServerTool(Name = "apply_standard_building_loads")]
    [Description("Crée les cas usuels d'un bâtiment et charge toutes les dalles : G poids propre (option), G2 charges permanentes surfaciques, Q exploitation, S neige sur la toiture (niveau le plus haut). Aucune valeur par défaut : chaque charge est fournie explicitement avec son unité (valeurs positives = vers le bas).")]
    public Task<CallToolResult> ApplyStandardBuildingLoads(
        [Description("Exploitation (valeur positive, appliquée vers le bas).")] double live_load,
        SurfaceLoadUnit load_unit,
        [Description("Charges permanentes ajoutées G2 (revêtements, cloisons…) ; 0 = aucune.")] double superimposed_dead_load = 0,
        [Description("Neige sur la toiture ; 0 = aucune.")] double snow_load = 0,
        bool include_self_weight = true,
        [Description("Appliquer l'exploitation aussi sur la toiture (sinon niveaux courants seulement si snow_load > 0).")] bool live_on_roof = true) =>
        runner.RunAsync("apply_standard_building_loads", SafetyLevel.Write,
            new { live_load, load_unit, superimposed_dead_load, snow_load, include_self_weight, live_on_roof }, ctx =>
            {
                var v = new Validator().Range(live_load, 0, 1e6, "live_load", UnitService.Symbol(load_unit))
                    .Range(superimposed_dead_load, 0, 1e6, "superimposed_dead_load", UnitService.Symbol(load_unit))
                    .Range(snow_load, 0, 1e6, "snow_load", UnitService.Symbol(load_unit));
                v.ThrowIfAny();
                var slabs = gateway.GetPanels().Where(p => p.Contour.Count >= 3 && GeometryMath.Orientation(p.Contour) == "horizontal").ToList();
                if (slabs.Count == 0 && (live_load > 0 || superimposed_dead_load > 0 || snow_load > 0))
                    throw new RobotMcpException(ErrorCodes.NotFound, "Aucune dalle (panneau horizontal) : créez les dalles ou utilisez add_bar_uniform_load.");
                var roofZ = slabs.Count == 0 ? 0 : slabs.Max(p => p.Contour[0].Z);
                var roof = slabs.Where(p => Math.Abs(p.Contour[0].Z - roofZ) < 1e-3).Select(p => p.Id).ToArray();
                var allSlabs = slabs.Select(p => p.Id).ToArray();
                var liveSlabs = live_on_roof ? allSlabs : allSlabs.Except(roof).ToArray();
                var unit = UnitService.Symbol(load_unit);
                var created = new Dictionary<string, int>();
                var inputs = new List<LoadInput>();
                int NewCase(string name, CaseNature nature)
                {
                    int id = gateway.NextCaseId();
                    gateway.CreateLoadCase(id, name, nature, AnalysisKind.StaticLinear);
                    ctx.Touch("case", new[] { id });
                    created[name] = id;
                    return id;
                }
                if (include_self_weight)
                    inputs.Add(new LoadInput { Kind = LoadKind.SelfWeight, CaseId = NewCase("G - Poids propre", CaseNature.Permanent), Unit = "-" });
                if (superimposed_dead_load > 0)
                    inputs.Add(new LoadInput { Kind = LoadKind.PanelUniform, CaseId = NewCase("G2 - Charges permanentes", CaseNature.Permanent), Objects = allSlabs, Z = -superimposed_dead_load, Unit = unit });
                if (live_load > 0 && liveSlabs.Length > 0)
                    inputs.Add(new LoadInput { Kind = LoadKind.PanelUniform, CaseId = NewCase("Q - Exploitation", CaseNature.Live), Objects = liveSlabs, Z = -live_load, Unit = unit });
                if (snow_load > 0)
                    inputs.Add(new LoadInput { Kind = LoadKind.PanelUniform, CaseId = NewCase("S - Neige", CaseNature.Snow), Objects = roof, Z = -snow_load, Unit = unit });
                var applied = loads.Apply(inputs, ctx, MaxBatch);
                ctx.Warn("NO_DEFAULT_VALUES", "Valeurs de charges reprises telles que fournies ; aucune catégorie d'usage ni norme n'a été supposée.");
                return new { cases = created, slabs = SelectionParser.Format(allSlabs), roof_slabs = SelectionParser.Format(roof), applied, units = new { surface_loads = unit } };
            });

    // ------------------------------------------------------------------ Analyse

    [McpServerTool(Name = "analyze_structure")]
    [Description("Enchaîne : check_model → generate_mesh (si panneaux) → run_analysis → messages → principaux résultats (déplacement max, réactions, efforts max). S'arrête avant calcul si check_model trouve des erreurs (sauf ignore_model_errors).")]
    public Task<CallToolResult> AnalyzeStructure(int wait_seconds = 600, bool ignore_model_errors = false, bool generate_mesh = true) =>
        runner.RunAsync("analyze_structure", SafetyLevel.Write, new { wait_seconds, ignore_model_errors, generate_mesh }, async ctx =>
        {
            var steps = new List<object>();
            var check = checker.Check();
            var errors = check.Where(i => i.Severity == "error").ToList();
            steps.Add(new { step = "check_model", errors = errors.Count, warnings = check.Count(i => i.Severity == "warning") });
            if (errors.Count > 0 && !ignore_model_errors)
                throw new RobotMcpException(ErrorCodes.ValidationFailed,
                    $"check_model a détecté {errors.Count} erreur(s) bloquante(s) : calcul non lancé. Corrigez-les ou relancez avec ignore_model_errors=true.",
                    new { issues = errors.Take(50) });
            foreach (var w in check.Where(i => i.Severity == "warning").Take(20)) ctx.Warn("MODEL_" + w.Category.ToUpperInvariant(), w.Message, w.ElementId);

            if (generate_mesh && gateway.GetPanels().Count > 0)
            {
                gateway.GenerateMesh();
                steps.Add(new { step = "generate_mesh", statistics = gateway.GetMeshStatistics() });
            }

            var snap = await tracker.RunAsync(gateway, TimeSpan.FromSeconds(Math.Clamp(wait_seconds, 1, 1800)));
            steps.Add(new { step = "run_analysis", state = snap.State, duration_s = snap.DurationS, messages = snap.Messages });
            AnalysisTools.Interpret(snap, ctx);
            if (snap.State != "succeeded") return new { steps, status = snap };
            return new { steps, status = snap, main_results = MainResults(ctx) };
        });

    private object MainResults(OperationContext ctx)
    {
        var cases = gateway.GetLoadCases();
        var main = new Dictionary<string, object?>();
        try
        {
            var nodes = gateway.GetNodes().Select(n => n.Id).ToList();
            if ((long)nodes.Count * cases.Count <= ResultService.MaxRows)
            {
                var disp = nodes.SelectMany(n => cases.Select(c => gateway.GetNodeDisplacement(n, c.Id))).ToList();
                var max = disp.MaxBy(d => ResultService.Displacement(d, DisplacementComponent.Total));
                if (max is not null) main["max_displacement"] = ResultService.DisplacementRow(max);
                var maxUz = disp.MinBy(d => d.UZ);
                if (maxUz is not null) main["max_downward_UZ"] = ResultService.DisplacementRow(maxUz);
            }
            var supported = gateway.GetSupports().SelectMany(s => s.Nodes).Distinct().ToList();
            main["reaction_sums"] = cases.Select(c =>
            {
                var r = supported.Select(n => gateway.GetNodeReaction(n, c.Id)).ToList();
                return new { @case = c.Id, c.Name, sum_FZ_kN = Round(r.Sum(x => x.FZ) / 1e3, 3) };
            }).ToList();
            var bars = gateway.GetBars();
            if ((long)bars.Count * cases.Count * 5 <= ResultService.MaxRows && bars.Count > 0)
                main["bar_extremes"] = ResultService.Extremes(results.BarForces(bars, cases, ResultService.Positions(5)), bars.ToDictionary(b => b.Id));
            else if (bars.Count > 0)
                ctx.Warn("RESULTS_TRUNCATED", "Modèle volumineux : utilisez get_bar_extremes avec des filtres pour les efforts.");
        }
        catch (RobotMcpException ex)
        {
            ctx.Warn("MAIN_RESULTS_PARTIAL", $"Extraction partielle des résultats : {ex.Message}");
        }
        main["units"] = new { displacements = "mm", forces = "kN", moments = "kNm" };
        return main;
    }

    // ------------------------------------------------------------------ Recherche d'extrêmes

    [McpServerTool(Name = "find_max_bar_force", ReadOnly = true)]
    [Description("Barres présentant la plus grande valeur absolue d'un effort (ex. MY pour le moment fléchissant des poutres, FX pour l'effort normal des poteaux). Filtres : rôle, barres, groupe, cas.")]
    public Task<CallToolResult> FindMaxBarForce(ForceComponent component, BarRoleFilter role = BarRoleFilter.Any, int[]? bar_ids = null, string? group = null,
        int[]? case_ids = null, [Description("Nombre de barres renvoyées.")] int top = 5, int points = 11) =>
        runner.RunAsync("find_max_bar_force", SafetyLevel.Read, new { component, role, bar_ids, group, case_ids, top, points }, _ =>
        {
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, null, group, role);
            var cases = model.ResolveCases(case_ids);
            var values = results.BarForces(bars, cases, ResultService.Positions(points));
            var byId = bars.ToDictionary(b => b.Id);
            var ranking = values.GroupBy(v => v.Bar)
                .Select(g => g.MaxBy(v => Math.Abs(ResultService.Component(v, component)))!)
                .OrderByDescending(v => Math.Abs(ResultService.Component(v, component)))
                .Take(Math.Clamp(top, 1, 100))
                .Select(v => new
                {
                    bar = v.Bar, value = Round(ResultService.Component(v, component) / 1e3, 4), @case = v.Case, position = v.Position,
                    x_m = Round(byId[v.Bar].Length * v.Position, 3), section = byId[v.Bar].Section,
                });
            return new { component = component.ToString(), unit = ResultService.UnitOf(component), role = role.ToString().ToLowerInvariant(), ranking };
        });

    [McpServerTool(Name = "find_max_displacement", ReadOnly = true)]
    [Description("Nœuds présentant les plus grands déplacements (composante UX, UY, UZ ou total), en mm.")]
    public Task<CallToolResult> FindMaxDisplacement(DisplacementComponent component = DisplacementComponent.Total, int[]? case_ids = null, int top = 5) =>
        runner.RunAsync("find_max_displacement", SafetyLevel.Read, new { component, case_ids, top }, _ =>
        {
            results.EnsureResults();
            var nodes = gateway.GetNodes().Select(n => n.Id).ToList();
            var cases = model.ResolveCases(case_ids);
            ResultService.CheckSize((long)nodes.Count * cases.Count);
            var ranking = nodes.SelectMany(n => cases.Select(c => gateway.GetNodeDisplacement(n, c.Id)))
                .OrderByDescending(d => Math.Abs(ResultService.Displacement(d, component))).Take(Math.Clamp(top, 1, 100))
                .Select(ResultService.DisplacementRow);
            return new { component = component.ToString(), ranking, units = ResultService.DisplacementUnits };
        });

    [McpServerTool(Name = "find_max_reaction", ReadOnly = true)]
    [Description("Appuis présentant les plus grandes réactions (composante FX, FY, FZ, MX, MY ou MZ), en kN / kNm.")]
    public Task<CallToolResult> FindMaxReaction(ForceComponent component = ForceComponent.FZ, int[]? case_ids = null, int top = 5) =>
        runner.RunAsync("find_max_reaction", SafetyLevel.Read, new { component, case_ids, top }, _ =>
        {
            results.EnsureResults();
            var supported = gateway.GetSupports().SelectMany(s => s.Nodes).Distinct().ToList();
            var cases = model.ResolveCases(case_ids);
            double Comp(NodeReaction r) => component switch
            {
                ForceComponent.FX => r.FX, ForceComponent.FY => r.FY, ForceComponent.FZ => r.FZ,
                ForceComponent.MX => r.MX, ForceComponent.MY => r.MY, _ => r.MZ,
            };
            var ranking = supported.SelectMany(n => cases.Select(c => gateway.GetNodeReaction(n, c.Id)))
                .OrderByDescending(r => Math.Abs(Comp(r))).Take(Math.Clamp(top, 1, 100)).Select(ResultService.ReactionRow);
            return new { component = component.ToString(), ranking, units = ResultService.ReactionUnits };
        });

    [McpServerTool(Name = "find_overstressed_members", ReadOnly = true)]
    [Description("Barres dont le taux de travail dépasse un seuil (ex. 0.9). Taux fournis par le module acier de Robot pour les barres acier. Les barres béton armé ne peuvent pas être évaluées via l'API (listées à part, avec la limitation).")]
    public Task<CallToolResult> FindOverstressedMembers([Description("Seuil de taux de travail (0.9 = 90 %).")] double threshold = 0.9,
        BarRoleFilter role = BarRoleFilter.Any, int[]? bar_ids = null, string? group = null, int[]? case_ids = null) =>
        runner.RunAsync("find_overstressed_members", SafetyLevel.Read, new { threshold, role, bar_ids, group, case_ids }, ctx =>
        {
            new Validator().Range(threshold, 0.01, 10, "threshold", "-").ThrowIfAny();
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, null, group, role);
            var sections = gateway.GetSections().ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
            var concrete = bars.Where(b => b.Section is not null && sections.TryGetValue(b.Section, out var s) && s.IsConcrete).Select(b => b.Id).ToList();
            var steel = bars.Where(b => b.Section is not null && sections.TryGetValue(b.Section, out var s) && !s.IsConcrete).Select(b => b.Id).ToArray();
            object? steelResult = null;
            var over = new List<object>();
            if (steel.Length > 0)
            {
                var cases = case_ids is { Length: > 0 } ? case_ids.ToList() : gateway.GetCombinations().Where(c => c.Type == "ULS").Select(c => c.Id).ToList();
                if (cases.Count == 0) cases = gateway.GetLoadCases().Where(c => c.Kind == "simple").Select(c => c.Id).ToList();
                var checks = gateway.RunSteelMemberVerification(steel, cases);
                over.AddRange(checks.Where(c => c.Ratio > threshold).OrderByDescending(c => c.Ratio)
                    .Select(c => new { member = c.Member, ratio = Math.Round(c.Ratio!.Value, 3), section = c.Section, governing_case = c.GoverningCase }));
                steelResult = new { evaluated = checks.Count(c => c.Ratio is not null), unavailable = checks.Where(c => c.Ratio is null).Select(c => c.Member) };
            }
            if (concrete.Count > 0)
                ctx.Warn(ErrorCodes.NotSupportedByApi,
                    $"{concrete.Count} barre(s) béton armé non évaluée(s) : le taux de travail BA n'est pas exposé par une API RobotOM vérifiée (voir check_rc_column / check_rc_beam).");
            return new
            {
                threshold, overstressed = over, steel = steelResult,
                not_evaluated_rc = SelectionParser.Format(concrete),
                not_evaluated_without_section = SelectionParser.Format(bars.Where(b => b.Section is null).Select(b => b.Id)),
            };
        });

    // ------------------------------------------------------------------ Optimisation des sections

    [McpServerTool(Name = "optimize_sections", ReadOnly = true)]
    [Description("PROPOSE (sans les appliquer) de nouvelles sections pour des barres acier, parmi des sections candidates existantes, à partir des taux de travail Robot. Estimation de pré-dimensionnement (proportionnalité à l'aire pour les poteaux, à l'inertie^0.75 sinon) : à confirmer par check_steel_member après application. Renvoie un proposal_id pour apply_section_proposals.")]
    public Task<CallToolResult> OptimizeSections(
        [Description("Noms de sections candidates EXISTANTES (create_section d'abord), ex. une série HEA.")] string[] candidate_sections,
        [Description("Taux de travail visé (ex. 0.9).")] double target_ratio = 0.9,
        BarRoleFilter role = BarRoleFilter.Any, int[]? bar_ids = null, string? group = null, int[]? case_ids = null) =>
        runner.RunAsync("optimize_sections", SafetyLevel.Read, new { candidate_sections, target_ratio, role, bar_ids, group, case_ids }, ctx =>
        {
            new Validator().NotEmpty(candidate_sections, "candidate_sections").Range(target_ratio, 0.1, 1.5, "target_ratio", "-").ThrowIfAny();
            var sections = gateway.GetSections().ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
            var missing = candidate_sections.Where(c => !sections.ContainsKey(c)).ToList();
            if (missing.Count > 0) throw new RobotMcpException(ErrorCodes.NotFound, $"Sections candidates inexistantes : {string.Join(", ", missing)} (create_section d'abord).");
            var candidates = candidate_sections.Select(c => sections[c]).ToList();
            if (candidates.Any(c => c.IsConcrete))
                ctx.Warn("RC_CANDIDATES", "Des sections candidates sont en béton : aucun taux BA n'étant disponible via l'API, elles ne seront proposées qu'à des barres béton… ce qui est impossible ici ; elles sont ignorées.");
            candidates = candidates.Where(c => !c.IsConcrete).ToList();

            var check = (dynamic)DesignTools.SteelCheck(ctx, model, gateway, results, bar_ids, null, group, role, case_ids);
            var bars = model.ResolveBars(bar_ids, null, group, role).ToDictionary(b => b.Id);
            var nodes = gateway.GetNodes(bars.Values.SelectMany(b => new[] { b.StartNode, b.EndNode }).Distinct().ToList()).ToDictionary(n => n.Id);
            var items = new List<SectionProposal>();
            var notEvaluated = new List<int>();
            foreach (var c in (IEnumerable<dynamic>)check.checks)
            {
                int member = c.member;
                double? ratio = c.ratio;
                if (ratio is null || !bars.TryGetValue(member, out var bar) || bar.Section is null || !sections.TryGetValue(bar.Section, out var current))
                {
                    notEvaluated.Add(member);
                    continue;
                }
                var isColumn = GeometryMath.BarRole(nodes[bar.StartNode].Point, nodes[bar.EndNode].Point) == "column";
                var key = isColumn ? "AX" : "IY";
                var exponent = isColumn ? 1.0 : 0.75;
                if (!current.Properties.TryGetValue(key, out var pCur) || pCur <= 0)
                {
                    notEvaluated.Add(member);
                    continue;
                }
                var ranked = candidates.Where(s => s.Properties.TryGetValue(key, out var p) && p > 0)
                    .Select(s => (Section: s, Est: ratio.Value * Math.Pow(pCur / s.Properties[key], exponent)))
                    .OrderBy(x => x.Section.Properties[key]).ToList();
                if (ranked.Count == 0)
                {
                    notEvaluated.Add(member);
                    continue;
                }
                var choice = ranked.FirstOrDefault(x => x.Est <= target_ratio);
                var basis = $"taux Robot {ratio:F3} ; estimation ∝ ({key} actuel / {key} candidat)^{exponent}";
                if (choice.Section is null)
                {
                    choice = ranked[^1];
                    basis += " ; AUCUNE candidate n'atteint le taux visé (plus grande proposée)";
                }
                if (string.Equals(choice.Section.Name, current.Name, StringComparison.OrdinalIgnoreCase)) continue;
                items.Add(new SectionProposal(member, current.Name, choice.Section.Name, Math.Round(ratio.Value, 3), Math.Round(choice.Est, 3), basis));
            }
            var set = proposals.Add(items, "Estimation de pré-dimensionnement à partir des taux du module acier Robot");
            return new
            {
                proposal_id = set.Id, applied = false, target_ratio, proposals = items,
                not_evaluated = SelectionParser.Format(notEvaluated),
                next_step = "apply_section_proposals(proposal_id, bar_ids=[…]) pour appliquer tout ou partie, puis check_steel_member après recalcul.",
            };
        });

    [McpServerTool(Name = "apply_section_proposals")]
    [Description("Applique une proposition d'optimize_sections, en totalité ou seulement aux barres listées (ex. [12, 16, 24]). Checkpoint automatique ; les résultats deviennent obsolètes (relancer le calcul).")]
    public Task<CallToolResult> ApplySectionProposals(string proposal_id, [Description("Sous-ensemble de barres (vide = toutes les propositions).")] int[]? bar_ids = null) =>
        runner.RunAsync("apply_section_proposals", SafetyLevel.Write, new { proposal_id, bar_ids }, ctx =>
        {
            var set = proposals.Get(proposal_id) ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Proposition « {proposal_id} » inconnue.");
            var selected = bar_ids is { Length: > 0 } ? set.Items.Where(i => bar_ids.Contains(i.Bar)).ToList() : set.Items.ToList();
            if (bar_ids is { Length: > 0 })
            {
                var unknown = bar_ids.Except(set.Items.Select(i => i.Bar)).ToList();
                if (unknown.Count > 0) throw new RobotMcpException(ErrorCodes.NotFound, $"Barres absentes de la proposition {proposal_id} : {SelectionParser.Format(unknown)}.");
            }
            if (selected.Count == 0) throw new ValidationException("Aucune proposition à appliquer.");
            foreach (var g in selected.GroupBy(i => i.ProposedSection)) model.AssignSection(g.Select(i => i.Bar).ToList(), g.Key, ctx);
            ctx.Warn("RERUN_ANALYSIS", "Sections modifiées : relancez le calcul puis check_steel_member pour confirmer les taux.");
            return new
            {
                applied = selected.Select(i => new { bar = i.Bar, from = i.CurrentSection, to = i.ProposedSection }),
                not_applied = set.Items.Except(selected).Select(i => i.Bar),
            };
        }, new RunOptions { Checkpoint = true });

    [McpServerTool(Name = "generate_structural_summary", ReadOnly = true)]
    [Description("Synthèse structurée : modèle, vérification, état du calcul et, si disponibles, résultats principaux (déplacements, réactions, efforts extrêmes).")]
    public Task<CallToolResult> GenerateStructuralSummary() =>
        runner.RunAsync("generate_structural_summary", SafetyLevel.Read, null, ctx => new
        {
            model = summary.Build(),
            model_check = AnalysisTools.CheckModelData(checker),
            analysis = tracker.Current,
            results = gateway.ResultsAvailable() ? MainResults(ctx) : null,
        });
}
