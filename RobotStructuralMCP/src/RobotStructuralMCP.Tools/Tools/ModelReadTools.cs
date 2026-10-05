using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class ModelReadTools(ToolRunner runner, IRobotGateway gateway, ModelService model, SummaryService summary)
{
    [McpServerTool(Name = "get_model_summary", ReadOnly = true, Idempotent = true)]
    [Description("Résumé compact du modèle : nombre de nœuds/barres/panneaux, emprise, poteaux/poutres, sections, matériaux, appuis, cas, combinaisons, état des résultats.")]
    public Task<CallToolResult> GetModelSummary() =>
        runner.RunAsync("get_model_summary", SafetyLevel.Read, null, _ => summary.Build());

    [McpServerTool(Name = "get_nodes", ReadOnly = true, Idempotent = true)]
    [Description("Liste des nœuds (coordonnées en m, appui). Filtres : ids, sélection Robot (« 1to10 15 »), groupe. Pagination par offset/limit.")]
    public Task<CallToolResult> GetNodes(
        [Description("Numéros de nœuds.")] int[]? ids = null,
        [Description("Sélection au format Robot, ex. « 1to20 25 30to40by2 ».")] string? selection = null,
        [Description("Nom d'un groupe de nœuds Robot.")] string? group = null,
        [Description("Index de départ.")] int offset = 0,
        [Description("Nombre maximal de nœuds renvoyés (1..5000).")] int limit = 500) =>
        runner.RunAsync("get_nodes", SafetyLevel.Read, new { ids, selection, group, offset, limit }, _ =>
        {
            var wanted = model.ResolveNodes(ids, selection, group);
            var nodes = gateway.GetNodes(ids is null && selection is null && group is null ? null : wanted);
            return Page(nodes.Select(Out.Node).ToList(), offset, limit, new { coordinates = "m" });
        });

    [McpServerTool(Name = "get_node", ReadOnly = true, Idempotent = true)]
    [Description("Détail d'un nœud : coordonnées (m), appui, barres connectées.")]
    public Task<CallToolResult> GetNode([Description("Numéro du nœud.")] int id) =>
        runner.RunAsync("get_node", SafetyLevel.Read, new { id }, _ =>
        {
            var n = gateway.GetNodes(new[] { id }).FirstOrDefault() ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Nœud {id} inexistant.");
            var bars = gateway.GetBars().Where(b => b.StartNode == id || b.EndNode == id).Select(b => b.Id).ToList();
            return new { node = Out.Node(n), connected_bars = bars, units = new { coordinates = "m" } };
        });

    [McpServerTool(Name = "get_bars", ReadOnly = true, Idempotent = true)]
    [Description("Liste des barres (nœuds, longueur en m, section, matériau, relâchement, rôle déduit : column/beam/inclined). Filtres : ids, sélection, groupe, rôle.")]
    public Task<CallToolResult> GetBars(
        [Description("Numéros de barres.")] int[]? ids = null,
        [Description("Sélection au format Robot.")] string? selection = null,
        [Description("Nom d'un groupe de barres Robot.")] string? group = null,
        [Description("Filtre de rôle géométrique.")] BarRoleFilter role = BarRoleFilter.Any,
        [Description("Filtre sur le nom de section.")] string? section = null,
        int offset = 0,
        [Description("Nombre maximal renvoyé (1..5000).")] int limit = 500) =>
        runner.RunAsync("get_bars", SafetyLevel.Read, new { ids, selection, group, role, section, offset, limit }, _ =>
        {
            var bars = model.ResolveBars(ids, selection, group, role);
            if (section is not null) bars = bars.Where(b => string.Equals(b.Section, section, StringComparison.OrdinalIgnoreCase)).ToList();
            var nodes = gateway.GetNodes(bars.SelectMany(b => new[] { b.StartNode, b.EndNode }).Distinct().ToList()).ToDictionary(n => n.Id);
            return Page(bars.Select(b => Out.Bar(b, nodes)).ToList(), offset, limit, new { length = "m", gamma = "deg" });
        });

    [McpServerTool(Name = "get_bar", ReadOnly = true, Idempotent = true)]
    [Description("Détail d'une barre : nœuds et coordonnées, longueur, rôle, section (avec propriétés), matériau, relâchement.")]
    public Task<CallToolResult> GetBar([Description("Numéro de la barre.")] int id) =>
        runner.RunAsync("get_bar", SafetyLevel.Read, new { id }, _ =>
        {
            var b = gateway.GetBars(new[] { id }).FirstOrDefault() ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Barre {id} inexistante.");
            var nodes = gateway.GetNodes(new[] { b.StartNode, b.EndNode }).ToDictionary(n => n.Id);
            var section = b.Section is null ? null : gateway.GetSections().FirstOrDefault(s => s.Name == b.Section);
            return new
            {
                bar = Out.Bar(b, nodes),
                start = nodes.TryGetValue(b.StartNode, out var s) ? Out.Node(s) : null,
                end = nodes.TryGetValue(b.EndNode, out var e) ? Out.Node(e) : null,
                section = section is null ? null : Out.Section(section),
                units = new { length = "m", coordinates = "m" },
            };
        });

    [McpServerTool(Name = "get_panels", ReadOnly = true, Idempotent = true)]
    [Description("Liste des panneaux (dalles horizontales, voiles verticaux) : contour (m), épaisseur (m), matériau, aire (m²), maillage.")]
    public Task<CallToolResult> GetPanels([Description("Numéros de panneaux (vide = tous).")] int[]? ids = null,
        [Description("Filtre : slab, wall ou inclined.")] string? kind = null) =>
        runner.RunAsync("get_panels", SafetyLevel.Read, new { ids, kind }, _ =>
        {
            var panels = gateway.GetPanels(ids).Select(Out.Panel).ToList();
            if (kind is not null) panels = panels.Where(p => string.Equals((string)((dynamic)p).kind, kind, StringComparison.OrdinalIgnoreCase)).ToList();
            return new { count = panels.Count, panels, units = new { contour = "m", thickness = "m", area = "m2" } };
        });

    [McpServerTool(Name = "get_groups", ReadOnly = true, Idempotent = true)]
    [Description("Groupes Robot (nœuds, barres, panneaux) et leur sélection.")]
    public Task<CallToolResult> GetGroups() =>
        runner.RunAsync("get_groups", SafetyLevel.Read, null, _ => gateway.GetGroups());

    [McpServerTool(Name = "get_levels", ReadOnly = true, Idempotent = true)]
    [Description("Niveaux déduits de la géométrie : altitudes Z distinctes des nœuds (m), avec nombre de nœuds et de poutres par niveau.")]
    public Task<CallToolResult> GetLevels() =>
        runner.RunAsync("get_levels", SafetyLevel.Read, null, _ =>
        {
            var nodes = gateway.GetNodes();
            var byId = nodes.ToDictionary(n => n.Id);
            var bars = gateway.GetBars();
            var levels = nodes.GroupBy(n => Math.Round(n.Z, 3)).OrderBy(g => g.Key).Select(g =>
            {
                var ids = g.Select(n => n.Id).ToHashSet();
                int beams = bars.Count(b => ids.Contains(b.StartNode) && ids.Contains(b.EndNode));
                return new { z = g.Key, nodes = g.Count(), beams };
            }).ToList();
            return new
            {
                levels,
                note = "Niveaux déduits des altitudes de nœuds ; les « étages » définis dans Robot ne sont pas lus par cette version.",
                units = new { z = "m" },
            };
        });

    private static object Page(IReadOnlyList<object> items, int offset, int limit, object units)
    {
        limit = Math.Clamp(limit, 1, 5000);
        offset = Math.Max(0, offset);
        var page = items.Skip(offset).Take(limit).ToList();
        return new
        {
            total = items.Count, offset, returned = page.Count,
            next_offset = offset + page.Count < items.Count ? offset + page.Count : (int?)null,
            items = page, units,
        };
    }
}
