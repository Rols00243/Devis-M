using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class GeometryTools(ToolRunner runner, IRobotGateway gateway, ModelService model, UnitService units, ConfirmationService confirm)
{
    private Point3 P(double x, double y, double z, LengthUnit u) => new(units.ToSi(x, u), units.ToSi(y, u), units.ToSi(z, u));

    private int MaxBatch => runner.Safety.MaxBatchSize;

    [McpServerTool(Name = "create_node")]
    [Description("Crée un nœud. Unité de longueur obligatoire.")]
    public Task<CallToolResult> CreateNode(double x, double y, double z,
        [Description("Unité des coordonnées (m, cm, mm).")] LengthUnit length_unit,
        [Description("Numéro souhaité (optionnel).")] int? id = null) =>
        runner.RunAsync("create_node", SafetyLevel.Write, new { x, y, z, length_unit, id }, ctx =>
        {
            var n = model.CreateNodes(new[] { new NewNode(id, P(x, y, z, length_unit)) }, ctx, MaxBatch)[0];
            return new { node = Out.Node(n), units = new { coordinates = "m" } };
        });

    [McpServerTool(Name = "create_nodes")]
    [Description("Crée plusieurs nœuds en un seul appel (batch). Validation complète avant toute écriture.")]
    public Task<CallToolResult> CreateNodes(
        [Description("Nœuds à créer.")] NodeInput[] nodes,
        [Description("Unité des coordonnées (m, cm, mm).")] LengthUnit length_unit,
        [Description("Réutiliser un nœud existant situé à moins de 1 mm au lieu d'en créer un doublon (nœuds sans numéro imposé).")] bool reuse_coincident = false) =>
        runner.RunAsync("create_nodes", SafetyLevel.Write, new { nodes, length_unit, reuse_coincident }, ctx =>
        {
            var created = model.CreateNodes(nodes.Select(n => new NewNode(n.Id, P(n.X, n.Y, n.Z, length_unit))).ToList(), ctx, MaxBatch, reuse_coincident);
            return new { count = created.Count, nodes = created.Select(Out.Node), units = new { coordinates = "m" } };
        });

    [McpServerTool(Name = "move_node")]
    [Description("Déplace un nœud vers de nouvelles coordonnées absolues (les barres reliées suivent).")]
    public Task<CallToolResult> MoveNode(int id, double x, double y, double z, [Description("Unité des coordonnées.")] LengthUnit length_unit) =>
        runner.RunAsync("move_node", SafetyLevel.Write, new { id, x, y, z, length_unit }, ctx =>
            new { node = Out.Node(model.MoveNode(id, P(x, y, z, length_unit), ctx)), units = new { coordinates = "m" } });

    [McpServerTool(Name = "delete_node", Destructive = true)]
    [Description("Supprime un ou plusieurs nœuds (Robot supprime aussi les barres attachées). Au-delà du seuil de suppression massive, ou si des barres sont supprimées, une confirmation explicite est requise.")]
    public Task<CallToolResult> DeleteNodes(
        [Description("Numéros des nœuds à supprimer.")] int[] ids,
        [Description("Jeton de confirmation (opération destructive).")] string? confirmation_token = null) =>
        runner.RunAsync("delete_node", ids.Length > runner.Safety.MassDeletionThreshold ? SafetyLevel.Destructive : SafetyLevel.Write,
            new { ids, confirmation_token }, ctx =>
            {
                new Validator().NotEmpty(ids, "ids").ThrowIfAny();
                model.RequireNodes(ids);
                var set = ids.ToHashSet();
                var attached = gateway.GetBars().Where(b => set.Contains(b.StartNode) || set.Contains(b.EndNode)).Select(b => b.Id).ToList();
                if (ids.Length > runner.Safety.MassDeletionThreshold || attached.Count > 0)
                    confirm.Require("delete_node", SelectionParser.Format(ids.OrderBy(i => i)), confirmation_token,
                        $"{ids.Length} nœud(s) et {attached.Count} barre(s) attachée(s) seront supprimés.",
                        new { nodes = SelectionParser.Format(ids.OrderBy(i => i)), attached_bars = SelectionParser.Format(attached) });
                foreach (var id in ids) gateway.DeleteNode(id);
                ctx.Touch("node", ids);
                ctx.Touch("bar", attached);
                return new { deleted_nodes = ids.Length, deleted_bars = attached };
            });

    [McpServerTool(Name = "create_bar")]
    [Description("Crée une barre entre deux nœuds existants, avec section et matériau optionnels.")]
    public Task<CallToolResult> CreateBar(int start_node, int end_node, int? id = null, string? section = null, string? material = null) =>
        runner.RunAsync("create_bar", SafetyLevel.Write, new { start_node, end_node, id, section, material }, ctx =>
        {
            var bars = model.CreateBars(new[] { new NewBar(id, start_node, end_node, section, material) }, ctx, MaxBatch);
            var nodes = gateway.GetNodes(new[] { start_node, end_node }).ToDictionary(n => n.Id);
            return new { bar = Out.Bar(bars[0], nodes), units = new { length = "m" } };
        });

    [McpServerTool(Name = "create_bars")]
    [Description("Crée plusieurs barres en un seul appel (batch) avec sections/matériaux optionnels.")]
    public Task<CallToolResult> CreateBars([Description("Barres à créer.")] BarInput[] bars) =>
        runner.RunAsync("create_bars", SafetyLevel.Write, new { bars }, ctx =>
        {
            var created = model.CreateBars(bars.Select(b => new NewBar(b.Id, b.StartNode, b.EndNode, b.Section, b.Material)).ToList(), ctx, MaxBatch);
            var nodes = gateway.GetNodes(created.SelectMany(b => new[] { b.StartNode, b.EndNode }).Distinct().ToList()).ToDictionary(n => n.Id);
            return new { count = created.Count, bars = created.Select(b => Out.Bar(b, nodes)), units = new { length = "m" } };
        });

    [McpServerTool(Name = "update_bar")]
    [Description("Modifie une barre : nœuds, angle gamma, section, matériau (seuls les champs fournis changent).")]
    public Task<CallToolResult> UpdateBar(int id, int? start_node = null, int? end_node = null,
        [Description("Angle gamma (rotation autour de l'axe de la barre).")] double? gamma = null,
        [Description("Unité de gamma (deg, rad) — obligatoire si gamma est fourni.")] AngleUnit? gamma_unit = null,
        string? section = null, string? material = null) =>
        runner.RunAsync("update_bar", SafetyLevel.Write, new { id, start_node, end_node, gamma, gamma_unit, section, material }, ctx =>
        {
            if (gamma is not null && gamma_unit is null) throw new RobotMcpException(ErrorCodes.UnitError, "gamma_unit est obligatoire lorsque gamma est fourni.");
            double? g = gamma is null ? null : units.ToSi(gamma.Value, gamma_unit!.Value);
            var b = model.UpdateBar(id, start_node, end_node, g, section, material, ctx);
            return new { bar = Out.Bar(b), units = new { length = "m", gamma = "deg" } };
        });

    [McpServerTool(Name = "delete_bar", Destructive = true)]
    [Description("Supprime une ou plusieurs barres. Au-delà du seuil de suppression massive : confirmation explicite requise.")]
    public Task<CallToolResult> DeleteBars(int[] ids, string? confirmation_token = null) =>
        runner.RunAsync("delete_bar", ids.Length > runner.Safety.MassDeletionThreshold ? SafetyLevel.Destructive : SafetyLevel.Write,
            new { ids, confirmation_token }, ctx =>
            {
                new Validator().NotEmpty(ids, "ids").ThrowIfAny();
                model.RequireBars(ids);
                if (ids.Length > runner.Safety.MassDeletionThreshold)
                    confirm.Require("delete_bar", SelectionParser.Format(ids.OrderBy(i => i)), confirmation_token,
                        $"{ids.Length} barres seront supprimées (suppression massive).");
                foreach (var id in ids) gateway.DeleteBar(id);
                ctx.Touch("bar", ids);
                return new { deleted_bars = ids.Length };
            });

    [McpServerTool(Name = "divide_bar")]
    [Description("Divise une barre en parts égales (parts) ou aux positions relatives données (positions 0..1). La barre d'origine garde son numéro sur le premier tronçon.")]
    public Task<CallToolResult> DivideBar(int id, int? parts = null,
        [Description("Positions relatives de coupure dans ]0;1[.")] double[]? positions = null) =>
        runner.RunAsync("divide_bar", SafetyLevel.Write, new { id, parts, positions }, ctx =>
            new { bars = model.DivideBar(id, parts, positions, ctx).Select(b => Out.Bar(b)), units = new { length = "m" } });

    [McpServerTool(Name = "create_panel")]
    [Description("Crée un panneau (dalle, voile ou panneau incliné) à partir d'un contour plan et d'une épaisseur. L'épaisseur est créée si besoin (avec son matériau).")]
    public Task<CallToolResult> CreatePanel(
        [Description("Sommets du contour, dans l'ordre (≥ 3, coplanaires).")] PointInput[] contour,
        [Description("Unité des coordonnées du contour.")] LengthUnit length_unit,
        [Description("Épaisseur du panneau.")] double thickness,
        [Description("Unité de l'épaisseur (m, cm, mm).")] LengthUnit thickness_unit,
        [Description("Matériau (existant) de l'épaisseur, ex. « C30/37 ».")] string? material = null,
        int? id = null) => CreatePanelCore("create_panel", null, contour, length_unit, thickness, thickness_unit, material, id);

    [McpServerTool(Name = "create_slab")]
    [Description("Crée une dalle : panneau HORIZONTAL (contour plan à Z constant) d'épaisseur donnée.")]
    public Task<CallToolResult> CreateSlab(PointInput[] contour, LengthUnit length_unit, double thickness, LengthUnit thickness_unit,
        string? material = null, int? id = null) => CreatePanelCore("create_slab", "horizontal", contour, length_unit, thickness, thickness_unit, material, id);

    [McpServerTool(Name = "create_wall")]
    [Description("Crée un voile : panneau VERTICAL. Fournir soit le contour complet, soit utiliser create_wall_between pour un voile entre deux points en plan.")]
    public Task<CallToolResult> CreateWall(PointInput[] contour, LengthUnit length_unit, double thickness, LengthUnit thickness_unit,
        string? material = null, int? id = null) => CreatePanelCore("create_wall", "vertical", contour, length_unit, thickness, thickness_unit, material, id);

    [McpServerTool(Name = "create_wall_between")]
    [Description("Crée un voile vertical entre deux points en plan (x1,y1)→(x2,y2), de z_bottom à z_top.")]
    public Task<CallToolResult> CreateWallBetween(double x1, double y1, double x2, double y2, double z_bottom, double z_top,
        LengthUnit length_unit, double thickness, LengthUnit thickness_unit, string? material = null, int? id = null)
    {
        var contour = new[]
        {
            new PointInput { X = x1, Y = y1, Z = z_bottom }, new PointInput { X = x2, Y = y2, Z = z_bottom },
            new PointInput { X = x2, Y = y2, Z = z_top }, new PointInput { X = x1, Y = y1, Z = z_top },
        };
        return CreatePanelCore("create_wall_between", "vertical", contour, length_unit, thickness, thickness_unit, material, id);
    }

    private Task<CallToolResult> CreatePanelCore(string op, string? orientation, PointInput[] contour, LengthUnit length_unit,
        double thickness, LengthUnit thickness_unit, string? material, int? id) =>
        runner.RunAsync(op, SafetyLevel.Write, new { contour, length_unit, thickness, thickness_unit, material, id }, ctx =>
        {
            var pts = contour.Select(c => P(c.X, c.Y, c.Z, length_unit)).ToList();
            var thick = model.EnsureThickness(units.ToSi(thickness, thickness_unit), material, ctx);
            var panel = model.CreatePanel(id, pts, thick, orientation, ctx);
            return new { panel = Out.Panel(panel), units = new { contour = "m", thickness = "m", area = "m2" } };
        });

    [McpServerTool(Name = "delete_panel", Destructive = true)]
    [Description("Supprime un ou plusieurs panneaux (au-delà du seuil de suppression massive : confirmation requise).")]
    public Task<CallToolResult> DeletePanels(int[] ids, string? confirmation_token = null) =>
        runner.RunAsync("delete_panel", ids.Length > runner.Safety.MassDeletionThreshold ? SafetyLevel.Destructive : SafetyLevel.Write,
            new { ids, confirmation_token }, ctx =>
            {
                new Validator().NotEmpty(ids, "ids").ThrowIfAny();
                model.RequirePanels(ids);
                if (ids.Length > runner.Safety.MassDeletionThreshold)
                    confirm.Require("delete_panel", SelectionParser.Format(ids.OrderBy(i => i)), confirmation_token, $"{ids.Length} panneaux seront supprimés.");
                foreach (var id in ids) gateway.DeletePanel(id);
                ctx.Touch("panel", ids);
                return new { deleted_panels = ids.Length };
            });

    [McpServerTool(Name = "copy_elements")]
    [Description("Copie des nœuds/barres/panneaux par translation (vecteur dx,dy,dz), éventuellement plusieurs fois. Sections, matériaux, relâchements, appuis et épaisseurs sont reportés ; les charges non.")]
    public Task<CallToolResult> CopyElements(double dx, double dy, double dz, LengthUnit length_unit,
        int[]? node_ids = null, int[]? bar_ids = null, int[]? panel_ids = null,
        [Description("Nombre de copies successives (1..100).")] int copies = 1) =>
        runner.RunAsync("copy_elements", SafetyLevel.Write, new { dx, dy, dz, length_unit, node_ids, bar_ids, panel_ids, copies }, ctx =>
            model.CopyElements(node_ids ?? Array.Empty<int>(), bar_ids ?? Array.Empty<int>(), panel_ids ?? Array.Empty<int>(),
                P(dx, dy, dz, length_unit), copies, ctx, MaxBatch), new RunOptions { Checkpoint = true });

    [McpServerTool(Name = "move_elements")]
    [Description("Translate des nœuds/barres/panneaux (vecteur dx,dy,dz). Les barres non sélectionnées reliées aux nœuds déplacés sont déformées (signalé en avertissement).")]
    public Task<CallToolResult> MoveElements(double dx, double dy, double dz, LengthUnit length_unit,
        int[]? node_ids = null, int[]? bar_ids = null, int[]? panel_ids = null) =>
        runner.RunAsync("move_elements", SafetyLevel.Write, new { dx, dy, dz, length_unit, node_ids, bar_ids, panel_ids }, ctx =>
            model.MoveElements(node_ids ?? Array.Empty<int>(), bar_ids ?? Array.Empty<int>(), panel_ids ?? Array.Empty<int>(),
                P(dx, dy, dz, length_unit), ctx), new RunOptions { Checkpoint = true });
}
