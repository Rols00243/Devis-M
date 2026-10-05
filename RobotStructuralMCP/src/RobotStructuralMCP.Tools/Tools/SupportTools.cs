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
public sealed class SupportTools(ToolRunner runner, IRobotGateway gateway, ModelService model, ConfirmationService confirm)
{
    [McpServerTool(Name = "get_supports", ReadOnly = true, Idempotent = true)]
    [Description("Appuis définis : état de chaque degré de liberté (free/fixed/spring + raideur SI) et nœuds affectés.")]
    public Task<CallToolResult> GetSupports() =>
        runner.RunAsync("get_supports", SafetyLevel.Read, null, _ => gateway.GetSupports().Select(Out.Support).ToList());

    [McpServerTool(Name = "create_support")]
    [Description("Crée un type d'appui en définissant indépendamment UX, UY, UZ, RX, RY, RZ : free, fixed ou spring (raideur obligatoire : translations en kN/m, rotations en kNm/rad). Exemples : encastrement = tout fixed ; rotule = UX,UY,UZ fixed.")]
    public Task<CallToolResult> CreateSupport(string name, DofInput ux, DofInput uy, DofInput uz, DofInput rx, DofInput ry, DofInput rz,
        [Description("Raideur translation X (kN/m) si ux=spring.")] double? kx = null,
        [Description("Raideur translation Y (kN/m) si uy=spring.")] double? ky = null,
        [Description("Raideur translation Z (kN/m) si uz=spring.")] double? kz = null,
        [Description("Raideur rotation X (kNm/rad) si rx=spring.")] double? hx = null,
        [Description("Raideur rotation Y (kNm/rad) si ry=spring.")] double? hy = null,
        [Description("Raideur rotation Z (kNm/rad) si rz=spring.")] double? hz = null,
        [Description("Nœuds auxquels affecter immédiatement l'appui (optionnel).")] int[]? node_ids = null) =>
        runner.RunAsync("create_support", SafetyLevel.Write, new { name, ux, uy, uz, rx, ry, rz, kx, ky, kz, hx, hy, hz, node_ids },
            ctx => Upsert(ctx, name, ux, uy, uz, rx, ry, rz, kx, ky, kz, hx, hy, hz, node_ids, false));

    [McpServerTool(Name = "update_support")]
    [Description("Redéfinit un appui existant (tous les nœuds qui le portent sont affectés).")]
    public Task<CallToolResult> UpdateSupport(string name, DofInput ux, DofInput uy, DofInput uz, DofInput rx, DofInput ry, DofInput rz,
        double? kx = null, double? ky = null, double? kz = null, double? hx = null, double? hy = null, double? hz = null) =>
        runner.RunAsync("update_support", SafetyLevel.Write, new { name, ux, uy, uz, rx, ry, rz, kx, ky, kz, hx, hy, hz },
            ctx => Upsert(ctx, name, ux, uy, uz, rx, ry, rz, kx, ky, kz, hx, hy, hz, null, true));

    private object Upsert(OperationContext ctx, string name, DofInput ux, DofInput uy, DofInput uz, DofInput rx, DofInput ry, DofInput rz,
        double? kx, double? ky, double? kz, double? hx, double? hy, double? hz, int[]? nodes, bool mustExist)
    {
        var v = new Validator().NotEmpty(name, "name");
        DofDefinition Dof(DofInput s, double? k, double scale, string dof, string unit)
        {
            if (s != DofInput.Spring)
            {
                if (k is not null) v.Error($"{dof} : raideur fournie mais l'état n'est pas « spring ».");
                return s == DofInput.Fixed ? DofDefinition.Fixed : DofDefinition.Free;
            }
            if (k is null || !(k > 0)) v.Error($"{dof} = spring : raideur strictement positive obligatoire ({unit}).");
            return new DofDefinition(DofState.Spring, (k ?? 0) * scale);
        }
        var def = new SupportData(name,
            Dof(ux, kx, 1e3, "UX", "kN/m"), Dof(uy, ky, 1e3, "UY", "kN/m"), Dof(uz, kz, 1e3, "UZ", "kN/m"),
            Dof(rx, hx, 1e3, "RX", "kNm/rad"), Dof(ry, hy, 1e3, "RY", "kNm/rad"), Dof(rz, hz, 1e3, "RZ", "kNm/rad"), Array.Empty<int>());
        v.ThrowIfAny();
        var exists = gateway.GetSupports().Any(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase));
        if (mustExist && !exists) throw new RobotMcpException(ErrorCodes.NotFound, $"Appui « {name} » inexistant.");
        if (!mustExist && exists) ctx.Warn("SUPPORT_EXISTS", $"L'appui « {name} » existait déjà : il est redéfini.");
        if (def.Dofs().All(d => d.Def.State == DofState.Free)) ctx.Warn("FREE_SUPPORT", "Appui entièrement libre : il ne retient rien.");
        if (nodes is { Length: > 0 }) model.RequireNodes(nodes);
        gateway.UpsertSupport(def);
        ctx.Touch("support", name);
        if (nodes is { Length: > 0 })
        {
            gateway.AssignSupport(nodes, name);
            ctx.Touch("node", nodes);
        }
        return Out.Support(gateway.GetSupports().First(s => string.Equals(s.Name, name, StringComparison.OrdinalIgnoreCase)));
    }

    [McpServerTool(Name = "assign_support")]
    [Description("Affecte un appui existant à des nœuds (ids, sélection Robot ou groupe ; ou tous les nœuds à l'altitude z_level).")]
    public Task<CallToolResult> AssignSupport(string support, int[]? node_ids = null, string? selection = null, string? group = null,
        [Description("Affecter à tous les nœuds situés à cette altitude.")] double? z_level = null,
        [Description("Unité de z_level (obligatoire si z_level est fourni).")] LengthUnit? length_unit = null) =>
        runner.RunAsync("assign_support", SafetyLevel.Write, new { support, node_ids, selection, group, z_level, length_unit }, ctx =>
        {
            List<int> ids;
            if (z_level is not null)
            {
                if (length_unit is null) throw new RobotMcpException(ErrorCodes.UnitError, "length_unit est obligatoire avec z_level.");
                var z = new UnitService().ToSi(z_level.Value, length_unit.Value);
                ids = gateway.GetNodes().Where(n => Math.Abs(n.Z - z) < ModelService.CoincidenceTolerance).Select(n => n.Id).ToList();
                if (ids.Count == 0) throw new RobotMcpException(ErrorCodes.NotFound, $"Aucun nœud à z = {z} m.");
            }
            else
            {
                if (node_ids is null && selection is null && group is null) throw new ValidationException("Préciser les nœuds (node_ids, selection, group ou z_level).");
                ids = model.ResolveNodes(node_ids, selection, group).ToList();
            }
            if (!gateway.GetSupports().Any(s => string.Equals(s.Name, support, StringComparison.OrdinalIgnoreCase)))
                throw new RobotMcpException(ErrorCodes.NotFound, $"Appui « {support} » inexistant (create_support).");
            gateway.AssignSupport(ids, support);
            ctx.Touch("node", ids);
            return new { support, nodes = SelectionParser.Format(ids), count = ids.Count };
        });

    [McpServerTool(Name = "remove_support")]
    [Description("Retire l'appui des nœuds indiqués (le type d'appui est conservé).")]
    public Task<CallToolResult> RemoveSupport(int[] node_ids) =>
        runner.RunAsync("remove_support", SafetyLevel.Write, new { node_ids }, ctx =>
        {
            new Validator().NotEmpty(node_ids, "node_ids").ThrowIfAny();
            model.RequireNodes(node_ids);
            gateway.RemoveSupport(node_ids);
            ctx.Touch("node", node_ids);
            return new { nodes = SelectionParser.Format(node_ids) };
        });

    [McpServerTool(Name = "delete_support", Destructive = true)]
    [Description("Supprime un type d'appui. S'il est utilisé par des nœuds, ceux-ci perdent leur appui : confirmation explicite requise.")]
    public Task<CallToolResult> DeleteSupport(string name, string? confirmation_token = null) =>
        runner.RunAsync("delete_support", SafetyLevel.Destructive, new { name, confirmation_token }, ctx =>
        {
            var s = gateway.GetSupports().FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase))
                    ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Appui « {name} » inexistant.");
            if (s.Nodes.Count > 0)
            {
                confirm.Require("delete_support", s.Name, confirmation_token,
                    $"l'appui « {s.Name} » est utilisé par {s.Nodes.Count} nœud(s) qui deviendront libres.", new { nodes = SelectionParser.Format(s.Nodes) });
                gateway.RemoveSupport(s.Nodes);
                ctx.Touch("node", s.Nodes);
            }
            gateway.DeleteSupport(s.Name);
            ctx.Touch("support", s.Name);
            return new { deleted = s.Name, freed_nodes = SelectionParser.Format(s.Nodes) };
        });

    [McpServerTool(Name = "get_releases", ReadOnly = true, Idempotent = true)]
    [Description("Relâchements de barres définis (degrés de liberté relâchés à l'origine et à l'extrémité) et barres affectées.")]
    public Task<CallToolResult> GetReleases() =>
        runner.RunAsync("get_releases", SafetyLevel.Read, null, _ => gateway.GetReleases().Select(Out.Release).ToList());

    [McpServerTool(Name = "create_bar_release")]
    [Description("Crée un relâchement de barre : liste des degrés de liberté RELÂCHÉS à chaque extrémité (UX, UY, UZ, RX, RY, RZ). Ex. articulation en extrémité : end_released=[\"RY\",\"RZ\"].")]
    public Task<CallToolResult> CreateBarRelease(string name,
        [Description("DDL relâchés au nœud origine.")] string[] start_released,
        [Description("DDL relâchés au nœud extrémité.")] string[] end_released,
        [Description("Barres auxquelles l'affecter immédiatement.")] int[]? bar_ids = null) =>
        runner.RunAsync("create_bar_release", SafetyLevel.Write, new { name, start_released, end_released, bar_ids }, ctx =>
        {
            EndRelease Parse(string[] dofs, string which)
            {
                var allowed = new[] { "UX", "UY", "UZ", "RX", "RY", "RZ" };
                var bad = dofs.Where(d => !allowed.Contains(d.ToUpperInvariant())).ToList();
                if (bad.Count > 0) throw new ValidationException($"{which} : DDL inconnus {string.Join(", ", bad)} (attendus : {string.Join(", ", allowed)}).");
                var set = dofs.Select(d => d.ToUpperInvariant()).ToHashSet();
                return new EndRelease(set.Contains("UX"), set.Contains("UY"), set.Contains("UZ"), set.Contains("RX"), set.Contains("RY"), set.Contains("RZ"));
            }
            var start = Parse(start_released, "start_released");
            var end = Parse(end_released, "end_released");
            if (start.RX && end.RX) ctx.Warn("TORSION_MECHANISM", "RX relâché aux deux extrémités : mécanisme en torsion.");
            if (start.UX && end.UX) ctx.Warn("AXIAL_MECHANISM", "UX relâché aux deux extrémités : mécanisme axial.");
            if (bar_ids is { Length: > 0 }) model.RequireBars(bar_ids);
            gateway.UpsertRelease(new ReleaseData(name, start, end, Array.Empty<int>()));
            ctx.Touch("release", name);
            if (bar_ids is { Length: > 0 })
            {
                gateway.AssignRelease(bar_ids, name);
                ctx.Touch("bar", bar_ids);
            }
            ctx.Warn("RELEASE_MAPPING", "La correspondance relâché ↔ valeur RobotOM (Robot:ReleaseReleasedValue) doit avoir été vérifiée une fois sur votre version (voir docs/ROBOTOM_API.md).");
            return Out.Release(gateway.GetReleases().First(r => r.Name == name));
        });

    [McpServerTool(Name = "assign_bar_release")]
    [Description("Affecte un relâchement existant à des barres.")]
    public Task<CallToolResult> AssignBarRelease(string release, int[]? bar_ids = null, string? selection = null, string? group = null) =>
        runner.RunAsync("assign_bar_release", SafetyLevel.Write, new { release, bar_ids, selection, group }, ctx =>
        {
            if (bar_ids is null && selection is null && group is null) throw new ValidationException("Préciser les barres.");
            if (!gateway.GetReleases().Any(r => string.Equals(r.Name, release, StringComparison.OrdinalIgnoreCase)))
                throw new RobotMcpException(ErrorCodes.NotFound, $"Relâchement « {release} » inexistant.");
            var ids = model.ResolveBars(bar_ids, selection, group).Select(b => b.Id).ToList();
            gateway.AssignRelease(ids, release);
            ctx.Touch("bar", ids);
            return new { release, bars = SelectionParser.Format(ids) };
        });
}
