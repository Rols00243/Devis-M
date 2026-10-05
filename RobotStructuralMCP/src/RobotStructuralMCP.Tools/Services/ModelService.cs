using System.Globalization;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Tools.Infrastructure;

namespace RobotStructuralMCP.Tools.Services;

public sealed record NewNode(int? Id, Point3 Point);
public sealed record NewBar(int? Id, int StartNode, int EndNode, string? Section = null, string? Material = null);

/// <summary>
/// Opérations de modélisation validées (valeurs SI). Toute la validation est faite AVANT le premier appel
/// d'écriture vers Robot, pour éviter les modèles à moitié modifiés.
/// </summary>
public sealed class ModelService
{
    public const double CoincidenceTolerance = 1e-3; // m
    private readonly IRobotGateway _g;

    public ModelService(IRobotGateway gateway) => _g = gateway;

    public IRobotGateway Gateway => _g;

    // ---------------------------------------------------------------- Nœuds

    /// <summary>Crée des nœuds. Si <paramref name="reuseCoincident"/>, un nœud existant à moins de 1 mm est réutilisé.</summary>
    public IReadOnlyList<NodeData> CreateNodes(IReadOnlyList<NewNode> nodes, OperationContext ctx, int maxBatch, bool reuseCoincident = false)
    {
        var v = new Validator();
        v.NotEmpty(nodes, "nodes").Require(nodes.Count <= maxBatch, $"Lot trop grand ({nodes.Count} > {maxBatch}).");
        var explicitIds = new HashSet<int>();
        for (int i = 0; i < nodes.Count; i++)
        {
            var n = nodes[i];
            v.Id(n.Id, $"nodes[{i}].id").Coordinate(n.Point.X, $"nodes[{i}].x").Coordinate(n.Point.Y, $"nodes[{i}].y").Coordinate(n.Point.Z, $"nodes[{i}].z");
            if (n.Id is { } id && !explicitIds.Add(id)) v.Error($"Numéro de nœud {id} dupliqué dans le lot.");
        }
        v.ThrowIfAny();

        var existing = _g.GetNodes();
        var existingIds = existing.Select(n => n.Id).ToHashSet();
        foreach (var id in explicitIds.Where(existingIds.Contains)) v.Error($"Le nœud {id} existe déjà.", ErrorCodes.AlreadyExists);
        v.ThrowIfAny();

        var index = new SpatialIndex(existing);
        var created = new List<NodeData>();
        int next = Math.Max(_g.NextNodeId(), existing.Count == 0 ? 1 : existing.Max(n => n.Id) + 1);
        foreach (var n in nodes)
        {
            var match = index.Find(n.Point, CoincidenceTolerance);
            if (match is not null)
            {
                if (reuseCoincident && n.Id is null)
                {
                    created.Add(match);
                    continue;
                }
                ctx.Warn("COINCIDENT_NODE", $"Le nouveau nœud en ({n.Point.X}; {n.Point.Y}; {n.Point.Z}) coïncide avec le nœud {match.Id} (< 1 mm).", $"node:{match.Id}");
            }
            int id = n.Id ?? NextFree(ref next, explicitIds);
            _g.CreateNode(id, n.Point.X, n.Point.Y, n.Point.Z);
            var data = new NodeData(id, n.Point.X, n.Point.Y, n.Point.Z, null);
            index.Add(data);
            created.Add(data);
            ctx.Touch("node", id.ToString(CultureInfo.InvariantCulture));
        }
        return created;
    }

    private static int NextFree(ref int next, HashSet<int> reserved)
    {
        while (reserved.Contains(next)) next++;
        return next++;
    }

    public NodeData MoveNode(int id, Point3 p, OperationContext ctx)
    {
        new Validator().Id(id, "id").Coordinate(p.X, "x").Coordinate(p.Y, "y").Coordinate(p.Z, "z").ThrowIfAny();
        RequireNodes(new[] { id });
        _g.MoveNode(id, p.X, p.Y, p.Z);
        ctx.Touch("node", id.ToString(CultureInfo.InvariantCulture));
        return _g.GetNodes(new[] { id })[0];
    }

    public void RequireNodes(IEnumerable<int> ids)
    {
        var wanted = ids.Distinct().ToList();
        var found = _g.GetNodes(wanted).Select(n => n.Id).ToHashSet();
        var missing = wanted.Where(i => !found.Contains(i)).ToList();
        if (missing.Count > 0)
            throw new RobotMcpException(ErrorCodes.NotFound, $"Nœud(s) inexistant(s) : {SelectionParser.Format(missing)}.", new { missing });
    }

    public void RequireBars(IEnumerable<int> ids)
    {
        var wanted = ids.Distinct().ToList();
        var found = _g.GetBars(wanted).Select(b => b.Id).ToHashSet();
        var missing = wanted.Where(i => !found.Contains(i)).ToList();
        if (missing.Count > 0)
            throw new RobotMcpException(ErrorCodes.NotFound, $"Barre(s) inexistante(s) : {SelectionParser.Format(missing)}.", new { missing });
    }

    public void RequirePanels(IEnumerable<int> ids)
    {
        var wanted = ids.Distinct().ToList();
        var found = _g.GetPanels(wanted).Select(p => p.Id).ToHashSet();
        var missing = wanted.Where(i => !found.Contains(i)).ToList();
        if (missing.Count > 0)
            throw new RobotMcpException(ErrorCodes.NotFound, $"Panneau(x) inexistant(s) : {SelectionParser.Format(missing)}.", new { missing });
    }

    // ---------------------------------------------------------------- Barres

    public IReadOnlyList<BarData> CreateBars(IReadOnlyList<NewBar> bars, OperationContext ctx, int maxBatch)
    {
        var v = new Validator();
        v.NotEmpty(bars, "bars").Require(bars.Count <= maxBatch, $"Lot trop grand ({bars.Count} > {maxBatch}).");
        var explicitIds = new HashSet<int>();
        for (int i = 0; i < bars.Count; i++)
        {
            var b = bars[i];
            v.Id(b.Id, $"bars[{i}].id").Id(b.StartNode, $"bars[{i}].start_node").Id(b.EndNode, $"bars[{i}].end_node")
             .Require(b.StartNode != b.EndNode, $"bars[{i}] : nœud origine et extrémité identiques ({b.StartNode}).");
            if (b.Id is { } id && !explicitIds.Add(id)) v.Error($"Numéro de barre {id} dupliqué dans le lot.");
        }

        var nodeIds = bars.SelectMany(b => new[] { b.StartNode, b.EndNode }).Distinct().ToList();
        var nodes = _g.GetNodes(nodeIds).ToDictionary(n => n.Id);
        var missing = nodeIds.Where(n => !nodes.ContainsKey(n)).ToList();
        if (missing.Count > 0) v.Error($"Nœud(s) inexistant(s) : {SelectionParser.Format(missing)}.", ErrorCodes.NotFound);

        var existingBars = _g.GetBars();
        var existingIds = existingBars.Select(b => b.Id).ToHashSet();
        foreach (var id in explicitIds.Where(existingIds.Contains)) v.Error($"La barre {id} existe déjà.", ErrorCodes.AlreadyExists);

        var sections = bars.Select(b => b.Section).Where(s => s is not null).Distinct().ToList();
        if (sections.Count > 0)
        {
            var known = _g.GetSections().Select(s => s.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var s in sections.Where(s => !known.Contains(s!))) v.Error($"Section « {s} » inexistante (create_section d'abord).", ErrorCodes.NotFound);
        }
        var materials = bars.Select(b => b.Material).Where(s => s is not null).Distinct().ToList();
        if (materials.Count > 0)
        {
            var known = _g.GetMaterials().Select(s => s.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var m in materials.Where(m => !known.Contains(m!))) v.Error($"Matériau « {m} » inexistant (create_material d'abord).", ErrorCodes.NotFound);
        }
        v.ThrowIfAny();

        foreach (var b in bars)
        {
            var len = nodes[b.StartNode].Point.DistanceTo(nodes[b.EndNode].Point);
            v.Require(len > CoincidenceTolerance, $"Barre {b.StartNode}→{b.EndNode} de longueur nulle (nœuds coïncidents).");
            if (len > Validator.Limits.MaxBarLength) ctx.Warn("LONG_BAR", $"Barre {b.StartNode}→{b.EndNode} très longue ({len:F2} m).");
        }
        v.ThrowIfAny();

        var pairs = existingBars.Select(b => Pair(b.StartNode, b.EndNode)).ToHashSet();
        int next = Math.Max(_g.NextBarId(), existingBars.Count == 0 ? 1 : existingBars.Max(b => b.Id) + 1);
        // Les panneaux partagent la numérotation des objets avec les barres dans Robot : on évite les collisions.
        var panelIds = _g.GetPanels().Select(p => p.Id).ToHashSet();
        foreach (var p in panelIds) explicitIds.Add(p);

        var created = new List<int>();
        foreach (var b in bars)
        {
            if (!pairs.Add(Pair(b.StartNode, b.EndNode)))
                ctx.Warn("DUPLICATE_BAR", $"Une barre relie déjà les nœuds {b.StartNode} et {b.EndNode}.");
            int id = b.Id ?? NextFree(ref next, explicitIds);
            _g.CreateBar(id, b.StartNode, b.EndNode);
            created.Add(id);
        }
        foreach (var group in bars.Zip(created).Where(x => x.First.Section is not null).GroupBy(x => x.First.Section!))
            _g.AssignSection(group.Select(x => x.Second).ToList(), group.Key);
        foreach (var group in bars.Zip(created).Where(x => x.First.Material is not null).GroupBy(x => x.First.Material!))
            _g.AssignMaterial(ElementKind.Bar, group.Select(x => x.Second).ToList(), group.Key);
        ctx.Touch("bar", created);
        return _g.GetBars(created);
    }

    private static (int, int) Pair(int a, int b) => a < b ? (a, b) : (b, a);

    public BarData UpdateBar(int id, int? startNode, int? endNode, double? gammaRad, string? section, string? material, OperationContext ctx)
    {
        RequireBars(new[] { id });
        var bar = _g.GetBars(new[] { id })[0];
        if (startNode is not null || endNode is not null)
        {
            int s = startNode ?? bar.StartNode, e = endNode ?? bar.EndNode;
            if (s == e) throw new ValidationException("Nœud origine et extrémité identiques.");
            RequireNodes(new[] { s, e });
            _g.SetBarNodes(id, s, e);
        }
        if (gammaRad is { } g)
        {
            new Validator().Finite(g, "gamma").ThrowIfAny();
            _g.SetBarGamma(id, g);
        }
        if (section is not null) AssignSection(new[] { id }, section, ctx);
        if (material is not null)
        {
            RequireMaterial(material);
            _g.AssignMaterial(ElementKind.Bar, new[] { id }, material);
        }
        ctx.Touch("bar", new[] { id });
        return _g.GetBars(new[] { id })[0];
    }

    public void AssignSection(IReadOnlyCollection<int> barIds, string section, OperationContext ctx)
    {
        new Validator().NotEmpty(barIds, "bar_ids").NotEmpty(section, "section").ThrowIfAny();
        if (!_g.GetSections().Any(s => string.Equals(s.Name, section, StringComparison.OrdinalIgnoreCase)))
            throw new RobotMcpException(ErrorCodes.NotFound, $"Section « {section} » inexistante.");
        RequireBars(barIds);
        _g.AssignSection(barIds, section);
        ctx.Touch("bar", barIds);
    }

    public void RequireMaterial(string name)
    {
        if (!_g.GetMaterials().Any(m => string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)))
            throw new RobotMcpException(ErrorCodes.NotFound, $"Matériau « {name} » inexistant (create_material d'abord).");
    }

    /// <summary>Divise une barre en <paramref name="parts"/> parts égales ou aux positions relatives données.</summary>
    public IReadOnlyList<BarData> DivideBar(int id, int? parts, IReadOnlyList<double>? positions, OperationContext ctx)
    {
        RequireBars(new[] { id });
        var bar = _g.GetBars(new[] { id })[0];
        var cuts = positions?.ToList() ?? new List<double>();
        var v = new Validator();
        if (cuts.Count == 0)
        {
            v.Require(parts is >= 2 and <= 1000, "parts doit être compris entre 2 et 1000 (ou fournir positions).");
            v.ThrowIfAny();
            cuts = Enumerable.Range(1, parts!.Value - 1).Select(i => (double)i / parts.Value).ToList();
        }
        foreach (var c in cuts) v.Require(c > 0 && c < 1, $"Position relative {c} hors de ]0 ; 1[.");
        v.ThrowIfAny();
        cuts = cuts.Distinct().OrderBy(c => c).ToList();

        var nodes = _g.GetNodes(new[] { bar.StartNode, bar.EndNode }).ToDictionary(n => n.Id);
        var a = nodes[bar.StartNode].Point;
        var b = nodes[bar.EndNode].Point;
        var newNodes = CreateNodes(cuts.Select(c => new NewNode(null, a + (b - a) * c)).ToList(), ctx, int.MaxValue);
        var chain = new[] { bar.StartNode }.Concat(newNodes.Select(n => n.Id)).Append(bar.EndNode).ToList();

        // La barre d'origine est conservée (même numéro, mêmes étiquettes) sur le premier tronçon.
        _g.SetBarNodes(id, chain[0], chain[1]);
        var segments = new List<NewBar>();
        for (int i = 1; i < chain.Count - 1; i++) segments.Add(new NewBar(null, chain[i], chain[i + 1], bar.Section, bar.Material));
        var created = CreateBars(segments, ctx, int.MaxValue);
        if (bar.Release is not null)
            ctx.Warn("RELEASE_REVIEW", $"La barre {id} avait le relâchement « {bar.Release} » : vérifiez son affectation sur les nouveaux tronçons.");
        if (Math.Abs(bar.GammaRad) > 1e-12)
            foreach (var c in created) _g.SetBarGamma(c.Id, bar.GammaRad);
        ctx.Touch("bar", new[] { id });
        return _g.GetBars(new[] { id }.Concat(created.Select(c => c.Id)).ToList());
    }

    // ---------------------------------------------------------------- Panneaux

    public string EnsureThickness(double thickness, string? material, OperationContext ctx, string? name = null)
    {
        new Validator().Range(thickness, Validator.Limits.MinThickness, Validator.Limits.MaxThickness, "thickness", "m").ThrowIfAny();
        if (material is not null) RequireMaterial(material);
        if (thickness < 0.08 || thickness > 1.0)
            ctx.Warn("UNUSUAL_THICKNESS", $"Épaisseur inhabituelle pour une dalle/voile : {thickness * 100:F1} cm.");
        name ??= $"EP{thickness * 100:0.#}cm" + (material is null ? "" : "_" + material);
        var existing = _g.GetThicknesses().FirstOrDefault(t => string.Equals(t.Name, name, StringComparison.OrdinalIgnoreCase));
        if (existing is null || Math.Abs(existing.Thickness - thickness) > 1e-9 || existing.Material != material)
        {
            _g.UpsertThickness(new ThicknessData(name, thickness, material));
            ctx.Touch("thickness", name);
        }
        return name;
    }

    public PanelData CreatePanel(int? id, IReadOnlyList<Point3> contour, string thicknessName, string? expectedOrientation, OperationContext ctx)
    {
        var v = new Validator();
        v.Id(id, "id").Require(contour.Count >= 3, "Un contour de panneau doit compter au moins 3 sommets.");
        for (int i = 0; i < contour.Count; i++)
            v.Coordinate(contour[i].X, $"contour[{i}].x").Coordinate(contour[i].Y, $"contour[{i}].y").Coordinate(contour[i].Z, $"contour[{i}].z");
        v.ThrowIfAny();
        var pts = contour.ToList();
        if (pts.Count > 3 && pts[0].DistanceTo(pts[^1]) < CoincidenceTolerance) pts.RemoveAt(pts.Count - 1); // contour fermé fourni
        for (int i = 0; i < pts.Count; i++)
            v.Require(pts[i].DistanceTo(pts[(i + 1) % pts.Count]) > CoincidenceTolerance, $"Sommets {i} et {(i + 1) % pts.Count} confondus.");
        var area = GeometryMath.Area(pts);
        v.Require(area > 1e-4, $"Contour dégénéré (aire {area:E2} m²).");
        var dev = GeometryMath.PlanarityDeviation(pts);
        v.Require(dev <= CoincidenceTolerance, $"Contour non plan (écart {dev * 1000:F1} mm au plan moyen).");
        v.ThrowIfAny();
        var orientation = GeometryMath.Orientation(pts);
        if (expectedOrientation == "horizontal" && orientation != "horizontal")
            throw new ValidationException($"Une dalle doit être horizontale (contour {orientation}).");
        if (expectedOrientation == "vertical" && orientation != "vertical")
            throw new ValidationException($"Un voile doit être vertical (contour {orientation}).");
        if (!_g.GetThicknesses().Any(t => string.Equals(t.Name, thicknessName, StringComparison.OrdinalIgnoreCase)))
            throw new RobotMcpException(ErrorCodes.NotFound, $"Épaisseur « {thicknessName} » inexistante.");

        int panelId = id ?? Math.Max(_g.NextPanelId(), 1);
        if (id is not null && (_g.PanelExists(panelId) || _g.BarExists(panelId)))
            throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Le numéro d'objet {panelId} est déjà utilisé (panneau ou barre).");
        _g.CreatePanel(panelId, pts, thicknessName);
        ctx.Touch("panel", new[] { panelId });
        return _g.GetPanels(new[] { panelId }).FirstOrDefault()
               ?? new PanelData(panelId, pts, thicknessName, null, null, true);
    }

    // ---------------------------------------------------------------- Copie / déplacement

    public object CopyElements(IReadOnlyCollection<int> nodeIds, IReadOnlyCollection<int> barIds, IReadOnlyCollection<int> panelIds,
        Point3 vector, int copies, OperationContext ctx, int maxBatch)
    {
        new Validator().Require(copies is >= 1 and <= 100, "copies doit être compris entre 1 et 100.")
            .Require(vector.Length > CoincidenceTolerance, "Le vecteur de copie est nul.")
            .Require(nodeIds.Count + barIds.Count + panelIds.Count > 0, "Aucun élément à copier.").ThrowIfAny();
        var bars = barIds.Count > 0 ? _g.GetBars(barIds) : Array.Empty<BarData>();
        if (bars.Count != barIds.Count) RequireBars(barIds);
        var panels = panelIds.Count > 0 ? _g.GetPanels(panelIds) : Array.Empty<PanelData>();
        if (panels.Count != panelIds.Count) RequirePanels(panelIds);
        var allNodeIds = nodeIds.Concat(bars.SelectMany(b => new[] { b.StartNode, b.EndNode })).Distinct().ToList();
        var nodes = _g.GetNodes(allNodeIds).ToDictionary(n => n.Id);
        if (nodes.Count != allNodeIds.Count) RequireNodes(allNodeIds);
        if ((allNodeIds.Count + bars.Count) * copies > maxBatch)
            throw new ValidationException($"Copie trop volumineuse ({(allNodeIds.Count + bars.Count) * copies} éléments > {maxBatch}).");

        var newNodes = new List<int>();
        var newBars = new List<int>();
        var newPanels = new List<int>();
        for (int k = 1; k <= copies; k++)
        {
            var offset = vector * k;
            var map = new Dictionary<int, int>();
            var created = CreateNodes(allNodeIds.Select(id => new NewNode(null, nodes[id].Point + offset)).ToList(), ctx, int.MaxValue, reuseCoincident: true);
            for (int i = 0; i < allNodeIds.Count; i++) map[allNodeIds[i]] = created[i].Id;
            newNodes.AddRange(created.Select(c => c.Id));
            // Les appuis suivent les nœuds copiés.
            foreach (var g in allNodeIds.Where(id => nodes[id].Support is not null).GroupBy(id => nodes[id].Support!))
                _g.AssignSupport(g.Select(id => map[id]).ToList(), g.Key);
            if (bars.Count > 0)
            {
                var cb = CreateBars(bars.Select(b => new NewBar(null, map[b.StartNode], map[b.EndNode], b.Section, b.Material)).ToList(), ctx, int.MaxValue);
                newBars.AddRange(cb.Select(b => b.Id));
                foreach (var (orig, copy) in bars.Zip(cb))
                {
                    if (orig.Release is not null) _g.AssignRelease(new[] { copy.Id }, orig.Release);
                    if (Math.Abs(orig.GammaRad) > 1e-12) _g.SetBarGamma(copy.Id, orig.GammaRad);
                }
            }
            foreach (var p in panels)
            {
                if (p.Thickness is null || p.Contour.Count < 3)
                {
                    ctx.Warn("PANEL_NOT_COPIED", $"Panneau {p.Id} non copié (contour ou épaisseur illisible).", $"panel:{p.Id}");
                    continue;
                }
                newPanels.Add(CreatePanel(null, p.Contour.Select(c => c + offset).ToList(), p.Thickness, null, ctx).Id);
            }
        }
        ctx.Warn("LOADS_NOT_COPIED", "Les charges ne sont pas copiées avec les éléments.");
        return new { new_nodes = SelectionParser.Format(newNodes.Distinct()), new_bars = SelectionParser.Format(newBars), new_panels = SelectionParser.Format(newPanels) };
    }

    public object MoveElements(IReadOnlyCollection<int> nodeIds, IReadOnlyCollection<int> barIds, IReadOnlyCollection<int> panelIds,
        Point3 vector, OperationContext ctx)
    {
        new Validator().Require(vector.Length > 0, "Le vecteur de déplacement est nul.")
            .Require(nodeIds.Count + barIds.Count + panelIds.Count > 0, "Aucun élément à déplacer.").ThrowIfAny();
        var bars = barIds.Count > 0 ? _g.GetBars(barIds) : Array.Empty<BarData>();
        if (bars.Count != barIds.Count) RequireBars(barIds);
        var panels = panelIds.Count > 0 ? _g.GetPanels(panelIds) : Array.Empty<PanelData>();
        if (panels.Count != panelIds.Count) RequirePanels(panelIds);
        var allNodeIds = nodeIds.Concat(bars.SelectMany(b => new[] { b.StartNode, b.EndNode })).Distinct().ToList();
        var nodes = _g.GetNodes(allNodeIds);
        if (nodes.Count != allNodeIds.Count) RequireNodes(allNodeIds);

        // Les barres non sélectionnées reliées aux nœuds déplacés seront déformées : on le signale.
        var moved = allNodeIds.ToHashSet();
        var affected = _g.GetBars().Where(b => !barIds.Contains(b.Id) && (moved.Contains(b.StartNode) || moved.Contains(b.EndNode))).Select(b => b.Id).ToList();
        if (affected.Count > 0)
            ctx.Warn("CONNECTED_BARS_DEFORMED", $"Barres non sélectionnées mais reliées aux nœuds déplacés (leur géométrie change) : {SelectionParser.Format(affected)}.");

        foreach (var n in nodes)
        {
            var p = n.Point + vector;
            new Validator().Coordinate(p.X, "x").Coordinate(p.Y, "y").Coordinate(p.Z, "z").ThrowIfAny();
            _g.MoveNode(n.Id, p.X, p.Y, p.Z);
        }
        ctx.Touch("node", allNodeIds);

        var movedPanels = new List<int>();
        foreach (var p in panels)
        {
            if (p.Thickness is null || p.Contour.Count < 3)
            {
                ctx.Warn("PANEL_NOT_MOVED", $"Panneau {p.Id} non déplacé (contour ou épaisseur illisible).", $"panel:{p.Id}");
                continue;
            }
            // Un panneau défini par contour est recréé au même numéro avec la même épaisseur.
            _g.DeletePanel(p.Id);
            _g.CreatePanel(p.Id, p.Contour.Select(c => c + vector).ToList(), p.Thickness);
            movedPanels.Add(p.Id);
            ctx.Warn("PANEL_RECREATED", $"Panneau {p.Id} recréé à sa nouvelle position : ses charges surfaciques et paramètres de maillage spécifiques doivent être vérifiés.", $"panel:{p.Id}");
        }
        ctx.Touch("panel", movedPanels);
        return new { moved_nodes = SelectionParser.Format(allNodeIds.OrderBy(i => i)), moved_panels = SelectionParser.Format(movedPanels) };
    }

    // ---------------------------------------------------------------- Résolution de sélections

    /// <summary>Résout une sélection de barres : ids explicites, texte Robot, groupe, filtre de rôle.</summary>
    public IReadOnlyList<BarData> ResolveBars(IReadOnlyCollection<int>? ids, string? selection, string? group, BarRoleFilter role = BarRoleFilter.Any)
    {
        var wanted = new HashSet<int>(ids ?? Array.Empty<int>());
        foreach (var i in SelectionParser.Parse(selection)) wanted.Add(i);
        if (!string.IsNullOrWhiteSpace(group))
        {
            var g = _g.GetGroups().FirstOrDefault(x => x.ObjectType == "bar" && string.Equals(x.Name, group, StringComparison.OrdinalIgnoreCase))
                    ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Groupe de barres « {group} » inexistant.");
            foreach (var i in SelectionParser.Parse(g.Selection)) wanted.Add(i);
        }
        var bars = wanted.Count > 0 ? _g.GetBars(wanted) : _g.GetBars();
        if (wanted.Count > 0 && bars.Count != wanted.Count) RequireBars(wanted);
        if (role == BarRoleFilter.Any) return bars;
        var nodes = _g.GetNodes(bars.SelectMany(b => new[] { b.StartNode, b.EndNode }).Distinct().ToList()).ToDictionary(n => n.Id);
        var target = role switch { BarRoleFilter.Beam => "beam", BarRoleFilter.Column => "column", _ => "inclined" };
        return bars.Where(b => GeometryMath.BarRole(nodes[b.StartNode].Point, nodes[b.EndNode].Point) == target).ToList();
    }

    public IReadOnlyList<int> ResolveNodes(IReadOnlyCollection<int>? ids, string? selection, string? group)
    {
        var wanted = new HashSet<int>(ids ?? Array.Empty<int>());
        foreach (var i in SelectionParser.Parse(selection)) wanted.Add(i);
        if (!string.IsNullOrWhiteSpace(group))
        {
            var g = _g.GetGroups().FirstOrDefault(x => x.ObjectType == "node" && string.Equals(x.Name, group, StringComparison.OrdinalIgnoreCase))
                    ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Groupe de nœuds « {group} » inexistant.");
            foreach (var i in SelectionParser.Parse(g.Selection)) wanted.Add(i);
        }
        if (wanted.Count == 0) return _g.GetNodes().Select(n => n.Id).ToList();
        RequireNodes(wanted);
        return wanted.OrderBy(i => i).ToList();
    }

    /// <summary>Résout les cas : ids explicites, sinon tous les cas simples et combinaisons.</summary>
    public IReadOnlyList<LoadCaseData> ResolveCases(IReadOnlyCollection<int>? caseIds)
    {
        var all = _g.GetLoadCases();
        if (caseIds is not { Count: > 0 }) return all;
        var byId = all.ToDictionary(c => c.Id);
        var missing = caseIds.Where(c => !byId.ContainsKey(c)).ToList();
        if (missing.Count > 0) throw new RobotMcpException(ErrorCodes.NotFound, $"Cas inexistant(s) : {SelectionParser.Format(missing)}.");
        return caseIds.Distinct().Select(c => byId[c]).ToList();
    }

    /// <summary>Index spatial simple (grille de 1 m) pour détecter les nœuds coïncidents.</summary>
    private sealed class SpatialIndex
    {
        private readonly Dictionary<(long, long, long), List<NodeData>> _cells = new();

        public SpatialIndex(IEnumerable<NodeData> nodes)
        {
            foreach (var n in nodes) Add(n);
        }

        private static (long, long, long) Cell(Point3 p) => ((long)Math.Floor(p.X), (long)Math.Floor(p.Y), (long)Math.Floor(p.Z));

        public void Add(NodeData n)
        {
            var c = Cell(n.Point);
            if (!_cells.TryGetValue(c, out var l)) _cells[c] = l = new List<NodeData>();
            l.Add(n);
        }

        public NodeData? Find(Point3 p, double tol)
        {
            var (cx, cy, cz) = Cell(p);
            for (long dx = -1; dx <= 1; dx++)
            for (long dy = -1; dy <= 1; dy++)
            for (long dz = -1; dz <= 1; dz++)
                if (_cells.TryGetValue((cx + dx, cy + dy, cz + dz), out var l))
                    foreach (var n in l)
                        if (n.Point.DistanceTo(p) < tol) return n;
            return null;
        }
    }
}
