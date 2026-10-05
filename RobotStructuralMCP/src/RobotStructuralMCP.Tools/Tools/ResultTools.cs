using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;
using static RobotStructuralMCP.Core.Units.UnitService;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class ResultTools(ToolRunner runner, IRobotGateway gateway, ModelService model, ResultService results)
{
    private const string CasesDoc = "Cas ou combinaisons (vide = tous).";

    [McpServerTool(Name = "get_node_displacements", ReadOnly = true, Idempotent = true)]
    [Description("Déplacements (mm) et rotations (rad) de nœuds. Filtres : nœuds, sélection, groupe, cas/combinaisons ; extremes_only pour ne garder que les extrêmes.")]
    public Task<CallToolResult> GetNodeDisplacements(int[]? node_ids = null, string? selection = null, string? group = null,
        [Description(CasesDoc)] int[]? case_ids = null, bool extremes_only = false) =>
        runner.RunAsync("get_node_displacements", SafetyLevel.Read, new { node_ids, selection, group, case_ids, extremes_only }, _ =>
        {
            results.EnsureResults();
            var nodes = model.ResolveNodes(node_ids, selection, group);
            var cases = model.ResolveCases(case_ids);
            ResultService.CheckSize((long)nodes.Count * cases.Count);
            var values = nodes.SelectMany(n => cases.Select(c => gateway.GetNodeDisplacement(n, c.Id))).ToList();
            if (extremes_only)
                return new
                {
                    extremes = Enum.GetValues<DisplacementComponent>().ToDictionary(c => c.ToString(), c =>
                    {
                        var max = values.MaxBy(v => ResultService.Displacement(v, c))!;
                        var min = values.MinBy(v => ResultService.Displacement(v, c))!;
                        return (object)new
                        {
                            max = new { value_mm = Round(ResultService.Displacement(max, c) * 1000, 4), node = max.Node, @case = max.Case },
                            min = new { value_mm = Round(ResultService.Displacement(min, c) * 1000, 4), node = min.Node, @case = min.Case },
                        };
                    }),
                    units = ResultService.DisplacementUnits,
                };
            return new { rows = values.Select(ResultService.DisplacementRow), units = ResultService.DisplacementUnits };
        });

    [McpServerTool(Name = "get_support_reactions", ReadOnly = true, Idempotent = true)]
    [Description("Réactions d'appui (kN, kNm) par nœud appuyé et par cas, avec la somme par cas (contrôle d'équilibre).")]
    public Task<CallToolResult> GetSupportReactions([Description(CasesDoc)] int[]? case_ids = null, int[]? node_ids = null) =>
        runner.RunAsync("get_support_reactions", SafetyLevel.Read, new { case_ids, node_ids }, _ =>
        {
            results.EnsureResults();
            var supported = gateway.GetSupports().SelectMany(s => s.Nodes).Distinct().OrderBy(n => n).ToList();
            if (node_ids is { Length: > 0 }) supported = supported.Intersect(node_ids).ToList();
            var cases = model.ResolveCases(case_ids);
            ResultService.CheckSize((long)supported.Count * cases.Count);
            var values = supported.SelectMany(n => cases.Select(c => gateway.GetNodeReaction(n, c.Id))).ToList();
            var sums = values.GroupBy(v => v.Case).Select(g => new
            {
                @case = g.Key,
                sum_FX = Round(g.Sum(v => v.FX) / 1e3, 3), sum_FY = Round(g.Sum(v => v.FY) / 1e3, 3), sum_FZ = Round(g.Sum(v => v.FZ) / 1e3, 3),
            });
            return new { rows = values.Select(ResultService.ReactionRow), sums, units = ResultService.ReactionUnits };
        });

    [McpServerTool(Name = "get_bar_forces", ReadOnly = true, Idempotent = true)]
    [Description("Efforts internes N (FX), Vy (FY), Vz (FZ), Mx (MX), My (MY), Mz (MZ) en kN / kNm le long des barres (points répartis). Convention Robot : FX > 0 = compression. Filtres : barres, sélection, groupe, rôle, cas ; extremes_only.")]
    public Task<CallToolResult> GetBarForces(int[]? bar_ids = null, string? selection = null, string? group = null, BarRoleFilter role = BarRoleFilter.Any,
        [Description(CasesDoc)] int[]? case_ids = null,
        [Description("Nombre de points par barre (1..101 ; 1 = mi-travée).")] int points = 5,
        bool extremes_only = false) =>
        runner.RunAsync("get_bar_forces", SafetyLevel.Read, new { bar_ids, selection, group, role, case_ids, points, extremes_only }, _ =>
        {
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, selection, group, role);
            var cases = model.ResolveCases(case_ids);
            var values = results.BarForces(bars, cases, ResultService.Positions(points));
            var byId = bars.ToDictionary(b => b.Id);
            if (extremes_only) return new { extremes = ResultService.Extremes(values, byId), bars = bars.Count, cases = cases.Count, units = ResultService.ForceUnits };
            return new { rows = values.Select(v => ResultService.ForceRow(v, byId[v.Bar])), units = ResultService.ForceUnits, sign_convention = "FX > 0 : compression (convention Robot)" };
        });

    [McpServerTool(Name = "get_bar_displacements", ReadOnly = true, Idempotent = true)]
    [Description("Déplacements globaux (mm, rad) et flèches locales (mm) le long des barres.")]
    public Task<CallToolResult> GetBarDisplacements(int[]? bar_ids = null, string? selection = null, string? group = null, BarRoleFilter role = BarRoleFilter.Any,
        [Description(CasesDoc)] int[]? case_ids = null, int points = 5, bool include_deflections = true) =>
        runner.RunAsync("get_bar_displacements", SafetyLevel.Read, new { bar_ids, selection, group, role, case_ids, points, include_deflections }, ctx =>
        {
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, selection, group, role);
            var cases = model.ResolveCases(case_ids);
            var pos = ResultService.Positions(points);
            ResultService.CheckSize((long)bars.Count * cases.Count * pos.Count);
            var rows = new List<object>();
            foreach (var b in bars)
                foreach (var c in cases)
                    foreach (var p in pos)
                    {
                        var d = gateway.GetBarDisplacement(b.Id, c.Id, p);
                        BarDeflection? f = null;
                        if (include_deflections)
                        {
                            try
                            {
                                f = gateway.GetBarDeflection(b.Id, c.Id, p);
                            }
                            catch (RobotMcpException ex) when (ex.Code == ErrorCodes.RobotApiMemberNotFound)
                            {
                                ctx.Warn("DEFLECTION_UNAVAILABLE", ex.Message);
                                include_deflections = false;
                            }
                        }
                        rows.Add(new
                        {
                            bar = b.Id, @case = c.Id, position = p,
                            UX = Round(d.UX * 1000, 4), UY = Round(d.UY * 1000, 4), UZ = Round(d.UZ * 1000, 4),
                            RX = Round(d.RX, 8), RY = Round(d.RY, 8), RZ = Round(d.RZ, 8),
                            deflection = f is null ? null : new { UX = Round(f.UX * 1000, 4), UY = Round(f.UY * 1000, 4), UZ = Round(f.UZ * 1000, 4) },
                        });
                    }
            return new { rows, units = Out.Units(("ux,uy,uz", "mm"), ("rx,ry,rz", "rad"), ("deflection", "mm, repère local")) };
        });

    [McpServerTool(Name = "get_bar_stresses", ReadOnly = true, Idempotent = true)]
    [Description("Contraintes normales extrêmes (Smax, Smin…) et tangentielles le long des barres, en MPa.")]
    public Task<CallToolResult> GetBarStresses(int[]? bar_ids = null, string? selection = null, string? group = null, BarRoleFilter role = BarRoleFilter.Any,
        [Description(CasesDoc)] int[]? case_ids = null, int points = 3, bool extremes_only = false) =>
        runner.RunAsync("get_bar_stresses", SafetyLevel.Read, new { bar_ids, selection, group, role, case_ids, points, extremes_only }, _ =>
        {
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, selection, group, role);
            var cases = model.ResolveCases(case_ids);
            var pos = ResultService.Positions(points);
            ResultService.CheckSize((long)bars.Count * cases.Count * pos.Count);
            var values = bars.SelectMany(b => cases.SelectMany(c => pos.Select(p => gateway.GetBarStress(b.Id, c.Id, p)))).ToList();
            if (extremes_only)
            {
                var keys = values.SelectMany(v => v.Values.Keys).Distinct();
                return new
                {
                    extremes = keys.ToDictionary(k => k, k =>
                    {
                        var withKey = values.Where(v => v.Values.ContainsKey(k)).ToList();
                        var max = withKey.MaxBy(v => v.Values[k])!;
                        var min = withKey.MinBy(v => v.Values[k])!;
                        return (object)new
                        {
                            max = new { value = Round(max.Values[k] / 1e6, 3), bar = max.Bar, @case = max.Case, position = max.Position },
                            min = new { value = Round(min.Values[k] / 1e6, 3), bar = min.Bar, @case = min.Case, position = min.Position },
                        };
                    }),
                    units = new { stress = "MPa" },
                };
            }
            return new
            {
                rows = values.Select(v => new { bar = v.Bar, @case = v.Case, position = v.Position, values = v.Values.ToDictionary(k => k.Key, k => Round(k.Value / 1e6, 3)) }),
                units = new { stress = "MPa" },
            };
        });

    [McpServerTool(Name = "get_bar_extremes", ReadOnly = true, Idempotent = true)]
    [Description("Valeurs extrêmes (max/min) de N, Vy, Vz, Mx, My, Mz sur les barres filtrées et les cas demandés, avec barre, cas et abscisse.")]
    public Task<CallToolResult> GetBarExtremes(int[]? bar_ids = null, string? selection = null, string? group = null, BarRoleFilter role = BarRoleFilter.Any,
        [Description(CasesDoc)] int[]? case_ids = null, int points = 11) =>
        runner.RunAsync("get_bar_extremes", SafetyLevel.Read, new { bar_ids, selection, group, role, case_ids, points }, _ =>
        {
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, selection, group, role);
            var cases = model.ResolveCases(case_ids);
            var values = results.BarForces(bars, cases, ResultService.Positions(points));
            return new
            {
                extremes = ResultService.Extremes(values, bars.ToDictionary(b => b.Id)),
                sampling = $"{points} points par barre",
                units = ResultService.ForceUnits,
                note = "Extrêmes dérivés des valeurs Robot aux points échantillonnés.",
            };
        });

    [McpServerTool(Name = "get_result_envelope", ReadOnly = true, Idempotent = true)]
    [Description("Enveloppe par barre (max/min de chaque effort sur l'ensemble des cas/combinaisons choisis), avec le cas et l'abscisse déterminants.")]
    public Task<CallToolResult> GetResultEnvelope(int[]? bar_ids = null, string? selection = null, string? group = null, BarRoleFilter role = BarRoleFilter.Any,
        [Description(CasesDoc)] int[]? case_ids = null, int points = 11) =>
        runner.RunAsync("get_result_envelope", SafetyLevel.Read, new { bar_ids, selection, group, role, case_ids, points }, _ =>
        {
            results.EnsureResults();
            var bars = model.ResolveBars(bar_ids, selection, group, role);
            var cases = model.ResolveCases(case_ids);
            var values = results.BarForces(bars, cases, ResultService.Positions(points));
            return new { envelope = ResultService.Envelope(values), cases = cases.Select(c => c.Id), units = ResultService.ForceUnits };
        });

    [McpServerTool(Name = "get_panel_results", ReadOnly = true, Idempotent = true)]
    [Description("Résultats détaillés d'un panneau aux nœuds du maillage pour un cas : efforts membranaires NXX/NYY/NXY (kN/m), moments MXX/MYY/MXY (kNm/m), efforts tranchants QXX/QYY (kN/m) — via l'API de requête de résultats de Robot.")]
    public Task<CallToolResult> GetPanelResults(int panel_id, int case_id, bool extremes_only = false) =>
        runner.RunAsync("get_panel_results", SafetyLevel.Read, new { panel_id, case_id, extremes_only }, _ =>
        {
            results.EnsureResults();
            model.RequirePanels(new[] { panel_id });
            model.ResolveCases(new[] { case_id });
            var rows = gateway.GetPanelResults(panel_id, case_id);
            var scaled = rows.Select(r => new { node = r.Node, element = r.Element, values = r.Values.ToDictionary(k => k.Key, k => Round(k.Value / 1e3, 4)) }).ToList();
            var units = Out.Units(("NXX,NYY,NXY,QXX,QYY", "kN/m"), ("MXX,MYY,MXY", "kNm/m"), ("keys", "noms RobotOM sans préfixe I_FRT_DETAILED_"));
            if (!extremes_only) return new { panel = panel_id, @case = case_id, rows = scaled, units };
            var keys = scaled.SelectMany(r => r.values.Keys).Distinct();
            return new
            {
                panel = panel_id, @case = case_id,
                extremes = keys.ToDictionary(k => k, k =>
                {
                    var with = scaled.Where(r => r.values.ContainsKey(k)).ToList();
                    var max = with.MaxBy(r => r.values[k])!;
                    var min = with.MinBy(r => r.values[k])!;
                    return (object)new { max = max.values[k], max_node = max.node, min = min.values[k], min_node = min.node };
                }),
                units,
            };
        });
}
