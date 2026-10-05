using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.Tools.Services;

public sealed record ModelIssue(string Severity, string? ElementId, string Category, string Message, string RecommendedAction);

/// <summary>
/// Vérification du modèle avant calcul (check_model). Contrôles effectués côté serveur à partir des données lues
/// dans Robot : ils complètent — sans remplacer — la vérification de Robot lui-même (Analyse > Vérifier la structure),
/// dont le rapport n'est pas exposé par RobotOM.
/// </summary>
public sealed class ModelChecker
{
    private readonly IRobotGateway _g;

    public ModelChecker(IRobotGateway gateway) => _g = gateway;

    public IReadOnlyList<ModelIssue> Check()
    {
        var issues = new List<ModelIssue>();
        var nodes = _g.GetNodes();
        var bars = _g.GetBars();
        var panels = _g.GetPanels();
        var sections = _g.GetSections().ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
        var materials = _g.GetMaterials().ToDictionary(m => m.Name, StringComparer.OrdinalIgnoreCase);
        var thicknesses = _g.GetThicknesses().ToDictionary(t => t.Name, StringComparer.OrdinalIgnoreCase);
        var supports = _g.GetSupports();
        var cases = _g.GetLoadCases();
        var loads = _g.GetLoads();
        var combinations = _g.GetCombinations();
        var nodeById = nodes.ToDictionary(n => n.Id);

        void Add(string sev, string? id, string cat, string msg, string action) => issues.Add(new ModelIssue(sev, id, cat, msg, action));

        if (nodes.Count == 0)
        {
            Add("error", null, "geometry", "Le modèle ne contient aucun nœud.", "Créer la géométrie (create_nodes, create_bars, create_panel).");
            return issues;
        }

        // --- Connectivité des nœuds
        var used = new HashSet<int>(bars.SelectMany(b => new[] { b.StartNode, b.EndNode }));
        var panelPoints = panels.SelectMany(p => p.Contour).ToList();
        foreach (var n in nodes)
        {
            if (used.Contains(n.Id)) continue;
            bool onPanel = panelPoints.Any(p => p.DistanceTo(n.Point) < ModelService.CoincidenceTolerance)
                           || panels.Any(p => OnContour(p.Contour, n.Point));
            if (!onPanel)
                Add(n.Support is null ? "warning" : "info", $"node:{n.Id}", "connectivity",
                    $"Nœud {n.Id} non relié à une barre ni à un contour de panneau.", "Supprimer le nœud ou le relier à la structure.");
        }

        // --- Nœuds coïncidents
        var sorted = nodes.OrderBy(n => n.X).ToList();
        for (int i = 0; i < sorted.Count; i++)
            for (int j = i + 1; j < sorted.Count && sorted[j].X - sorted[i].X < ModelService.CoincidenceTolerance; j++)
                if (sorted[i].Point.DistanceTo(sorted[j].Point) < ModelService.CoincidenceTolerance)
                    Add("error", $"node:{sorted[j].Id}", "geometry", $"Nœuds {sorted[i].Id} et {sorted[j].Id} coïncidents.",
                        "Fusionner les nœuds (supprimer le doublon et reconnecter les barres).");

        // --- Barres
        var pairs = new Dictionary<(int, int), int>();
        foreach (var b in bars)
        {
            var id = $"bar:{b.Id}";
            if (!nodeById.ContainsKey(b.StartNode) || !nodeById.ContainsKey(b.EndNode))
            {
                Add("error", id, "geometry", $"Barre {b.Id} reliée à un nœud inexistant.", "Supprimer ou recréer la barre.");
                continue;
            }
            if (b.Length < ModelService.CoincidenceTolerance)
                Add("error", id, "geometry", $"Barre {b.Id} de longueur nulle.", "Supprimer la barre.");
            var key = b.StartNode < b.EndNode ? (b.StartNode, b.EndNode) : (b.EndNode, b.StartNode);
            if (pairs.TryGetValue(key, out var other))
                Add("warning", id, "geometry", $"Barres {other} et {b.Id} superposées (mêmes nœuds).", "Supprimer la barre en double.");
            else pairs[key] = b.Id;

            if (b.Section is null)
                Add("error", id, "section", $"Barre {b.Id} sans section.", "Affecter une section (assign_section).");
            else if (!sections.ContainsKey(b.Section))
                Add("error", id, "section", $"Barre {b.Id} : section « {b.Section} » introuvable.", "Créer la section ou en affecter une autre.");

            var sectionMaterial = b.Section is not null && sections.TryGetValue(b.Section, out var s) ? s.Material : null;
            var mat = b.Material ?? sectionMaterial;
            if (mat is null)
                Add("warning", id, "material", $"Barre {b.Id} sans matériau explicite (Robot utilisera le matériau par défaut).", "Affecter un matériau (assign_material).");
            else if (!materials.ContainsKey(mat))
                Add("error", id, "material", $"Barre {b.Id} : matériau « {mat} » introuvable.", "Créer le matériau (create_material).");
        }

        // --- Panneaux
        foreach (var p in panels)
        {
            var id = $"panel:{p.Id}";
            if (p.Thickness is null)
                Add("error", id, "panel", $"Panneau {p.Id} sans épaisseur.", "Affecter une épaisseur.");
            else if (!thicknesses.ContainsKey(p.Thickness))
                Add("error", id, "panel", $"Panneau {p.Id} : épaisseur « {p.Thickness} » introuvable.", "Créer l'épaisseur.");
            else if (thicknesses[p.Thickness].Material is null)
                Add("warning", id, "material", $"Panneau {p.Id} : épaisseur sans matériau.", "Définir le matériau de l'épaisseur.");
            if (!p.Meshed)
                Add("warning", id, "mesh", $"Panneau {p.Id} non maillé (simple contour) : il ne participe pas à la rigidité.", "Activer le maillage du panneau.");
            else if (p.FiniteElementCount == 0)
                Add("info", id, "mesh", $"Panneau {p.Id} : maillage non encore généré.", "generate_mesh (ou laisser run_analysis le générer).");
            if (p.Contour.Count >= 3 && GeometryMath.Area(p.Contour) < 1e-4)
                Add("error", id, "geometry", $"Panneau {p.Id} de surface nulle.", "Corriger le contour.");
        }

        // --- Appuis et stabilité globale (contrôle nécessaire, pas suffisant)
        var supported = supports.Where(s => s.Nodes.Count > 0).ToList();
        if (supported.Count == 0)
        {
            Add("error", null, "supports", "Aucun appui : la structure est un mécanisme.", "Définir et affecter des appuis (create_support, assign_support).");
        }
        else
        {
            var blocked = new[] { "UX", "UY", "UZ", "RX", "RY", "RZ" }
                .Where(dof => supported.Any(s => s.Dofs().Any(d => d.Dof == dof && d.Def.State != DofState.Free))).ToList();
            foreach (var dof in new[] { "UX", "UY", "UZ" }.Except(blocked))
                Add("error", null, "stability", $"Aucun appui ne retient {dof} : déplacement d'ensemble possible.", $"Bloquer {dof} sur au moins un appui.");
            var supportedNodes = supported.SelectMany(s => s.Nodes).Distinct().Count();
            bool rotationsHeld = blocked.Contains("RZ") || supportedNodes >= 2;
            if (!rotationsHeld)
                Add("warning", null, "stability", "Un seul nœud d'appui sans blocage de RZ : rotation d'ensemble autour de Z possible.", "Ajouter des appuis ou bloquer RZ.");
            foreach (var s in supported)
                foreach (var (dof, def) in s.Dofs())
                    if (def.State == DofState.Spring && def.Stiffness is not > 0)
                        Add("error", $"support:{s.Name}", "supports", $"Appui « {s.Name} » : ressort {dof} sans raideur positive.", "Définir une raideur > 0.");
        }

        // Nœuds d'extrémité libres (consoles) : information.
        var degree = bars.SelectMany(b => new[] { b.StartNode, b.EndNode }).GroupBy(n => n).ToDictionary(g => g.Key, g => g.Count());
        var supportedSet = supported.SelectMany(s => s.Nodes).ToHashSet();
        foreach (var (n, d) in degree)
            if (d == 1 && !supportedSet.Contains(n) && !panelPoints.Any(p => nodeById.TryGetValue(n, out var nd) && p.DistanceTo(nd.Point) < ModelService.CoincidenceTolerance))
                Add("info", $"node:{n}", "stability", $"Nœud {n} : extrémité libre (console).", "Vérifier qu'il s'agit bien d'un porte-à-faux voulu.");

        // Sous-structures non connectées (composantes connexes via les barres).
        var components = Components(nodes.Select(n => n.Id), bars);
        if (components.Count > 1)
        {
            foreach (var c in components.Where(c => !c.Any(supportedSet.Contains) && c.Count > 1))
                Add("error", $"node:{c.Min()}", "stability", $"Sous-structure de {c.Count} nœuds ({SelectionParser.Format(c.OrderBy(i => i).Take(10))}…) sans appui ni liaison au reste.",
                    "Relier cette partie à la structure ou l'appuyer.");
        }

        // --- Charges
        var simpleCases = cases.Where(c => c.Kind == "simple").ToList();
        if (simpleCases.Count == 0)
            Add("warning", null, "loads", "Aucun cas de charge.", "Créer des cas (create_load_case) et des charges.");
        var barIds = bars.Select(b => b.Id).ToHashSet();
        var panelIds = panels.Select(p => p.Id).ToHashSet();
        foreach (var c in simpleCases.Where(c => c.RecordCount == 0 && c.AnalysisType?.Contains("modal", StringComparison.OrdinalIgnoreCase) != true))
            Add("warning", $"case:{c.Id}", "loads", $"Cas {c.Id} « {c.Name} » sans charge.", "Ajouter des charges ou supprimer le cas.");
        foreach (var l in loads)
        {
            var objs = SafeParse(l.Objects);
            HashSet<int>? domain = l.Kind switch
            {
                "nodal_force" => nodeById.Keys.ToHashSet(),
                "bar_uniform" or "bar_point_force" or "bar_temperature" => barIds,
                "panel_uniform" => panelIds,
                _ => null,
            };
            if (domain is not null)
            {
                var bad = objs.Where(o => !domain.Contains(o)).ToList();
                if (bad.Count > 0)
                    Add("error", $"case:{l.CaseId}", "loads", $"Cas {l.CaseId}, charge n°{l.Index} ({l.Kind}) : objets inexistants {SelectionParser.Format(bad)}.", "Corriger ou supprimer la charge.");
                if (objs.Count == 0)
                    Add("warning", $"case:{l.CaseId}", "loads", $"Cas {l.CaseId}, charge n°{l.Index} ({l.Kind}) sans objet chargé.", "Affecter la charge à des éléments.");
            }
            if (l.Values.Values.Any(v => !double.IsFinite(v)))
                Add("error", $"case:{l.CaseId}", "loads", $"Cas {l.CaseId}, charge n°{l.Index} : valeur non finie.", "Corriger la charge.");
            if (l.Kind == "panel_uniform" && l.Values.TryGetValue("PZ", out var pz) && Math.Abs(pz) > 100e3)
                Add("warning", $"case:{l.CaseId}", "loads", $"Charge surfacique très élevée ({pz / 1e3:F1} kN/m²).", "Vérifier l'unité saisie.");
        }

        // --- Combinaisons
        var caseIds = cases.Select(c => c.Id).ToHashSet();
        foreach (var comb in combinations)
        {
            if (comb.Factors.Count == 0)
                Add("warning", $"case:{comb.Id}", "combinations", $"Combinaison {comb.Id} vide.", "Ajouter des cas ou la supprimer.");
            foreach (var f in comb.Factors.Where(f => !caseIds.Contains(f.CaseId)))
                Add("error", $"case:{comb.Id}", "combinations", $"Combinaison {comb.Id} : cas {f.CaseId} inexistant.", "Corriger la combinaison.");
        }

        return issues.OrderBy(i => i.Severity switch { "error" => 0, "warning" => 1, _ => 2 }).ToList();
    }

    private static IReadOnlyList<int> SafeParse(string text)
    {
        try
        {
            return SelectionParser.Parse(text);
        }
        catch
        {
            return Array.Empty<int>();
        }
    }

    private static bool OnContour(IReadOnlyList<Point3> contour, Point3 p)
    {
        for (int i = 0; i < contour.Count; i++)
        {
            var a = contour[i];
            var b = contour[(i + 1) % contour.Count];
            var ab = b - a;
            var len2 = Point3.Dot(ab, ab);
            if (len2 < 1e-12) continue;
            var t = Math.Clamp(Point3.Dot(p - a, ab) / len2, 0, 1);
            if ((a + ab * t).DistanceTo(p) < ModelService.CoincidenceTolerance) return true;
        }
        return false;
    }

    private static List<List<int>> Components(IEnumerable<int> nodes, IReadOnlyList<BarData> bars)
    {
        var parent = nodes.ToDictionary(n => n, n => n);
        int Find(int x)
        {
            while (parent[x] != x) x = parent[x] = parent[parent[x]];
            return x;
        }
        foreach (var b in bars)
            if (parent.ContainsKey(b.StartNode) && parent.ContainsKey(b.EndNode))
                parent[Find(b.StartNode)] = Find(b.EndNode);
        var connected = bars.SelectMany(b => new[] { b.StartNode, b.EndNode }).ToHashSet();
        return parent.Keys.Where(connected.Contains).GroupBy(Find).Select(g => g.ToList()).ToList();
    }
}
