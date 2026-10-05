using System.Text.Json;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.RobotAPI.Simulation;

/// <summary>
/// Modèle structurel en mémoire, sans Robot. Destiné aux tests automatisés et au développement hors Windows.
/// - Toutes les opérations de modélisation sont réellement appliquées au modèle en mémoire.
/// - AUCUN solveur : RunAnalysis renvoie un échec explicite (NOT_SUPPORTED_IN_SIMULATION).
///   Les résultats ne peuvent être qu'injectés par les tests (<see cref="SeedResults"/>).
/// </summary>
public sealed class SimulationGateway : IRobotGateway
{
    private readonly object _lock = new();
    private SimModel _m = new();
    private bool _connected;

    public string BackendName => "Simulation (en mémoire, sans solveur)";
    public string? CurrentProjectPath => _m.FilePath;

    /// <summary>Résultats injectés (tests uniquement).</summary>
    public SimResults Results { get; } = new();

    public sealed class SimModel
    {
        public string Name { get; set; } = "Simulation";
        public string? FilePath { get; set; }
        public SortedDictionary<int, NodeData> Nodes { get; set; } = new();
        public SortedDictionary<int, BarData> Bars { get; set; } = new();
        public SortedDictionary<int, PanelData> Panels { get; set; } = new();
        public Dictionary<string, MaterialData> Materials { get; set; } = new();
        public Dictionary<string, SectionData> Sections { get; set; } = new();
        public Dictionary<string, ThicknessData> Thicknesses { get; set; } = new();
        public Dictionary<string, SupportData> Supports { get; set; } = new();
        public Dictionary<string, ReleaseData> Releases { get; set; } = new();
        public SortedDictionary<int, LoadCaseData> Cases { get; set; } = new();
        public Dictionary<int, List<LoadRecordData>> Loads { get; set; } = new();
        public SortedDictionary<int, CombinationData> Combinations { get; set; } = new();
        public Dictionary<int, double> MeshSizes { get; set; } = new();
        public bool MeshGenerated { get; set; }
    }

    public sealed class SimResults
    {
        public bool Available { get; set; }
        public Dictionary<(int Node, int Case), NodeDisplacement> Displacements { get; } = new();
        public Dictionary<(int Node, int Case), NodeReaction> Reactions { get; } = new();
        /// <summary>Efforts par barre et cas, échantillonnés : la valeur la plus proche de la position demandée est renvoyée.</summary>
        public Dictionary<(int Bar, int Case), List<BarForces>> Forces { get; } = new();
        public Dictionary<int, double> SteelRatios { get; } = new();
    }

    private T Locked<T>(Func<T> f)
    {
        lock (_lock)
        {
            if (!_connected)
                throw new RobotMcpException(ErrorCodes.RobotNotConnected, "Non connecté (simulation) : appelez robot_connect.");
            return f();
        }
    }

    private void Locked(Action a) => Locked(() => { a(); return true; });

    private static RobotMcpException Missing(string what, object id) => new(ErrorCodes.NotFound, $"{what} {id} inexistant(e).");

    // --- Connexion ------------------------------------------------------------------------------

    public RobotStatus GetStatus() => new(BackendName, true, true, null, _connected, _connected, "simulation", _m.Name, _m.FilePath,
        _connected ? "Connecté au modèle simulé (aucun solveur)." : "Simulation disponible, non connectée.");

    public RobotStatus Connect(bool launchIfNotRunning)
    {
        lock (_lock) _connected = true;
        return GetStatus();
    }

    public void Disconnect()
    {
        lock (_lock) _connected = false;
    }

    public ProjectInfo GetProjectInfo() => Locked(() => new ProjectInfo(_m.Name, _m.FilePath, "simulation", true, Results.Available,
        "simulation", new Dictionary<string, string>(), new[] { "Mode simulation : aucune norme ni solveur Robot." }));

    public void SaveProject() => Locked(() =>
    {
        if (_m.FilePath is null) throw new RobotMcpException(ErrorCodes.ValidationFailed, "Projet jamais enregistré : utilisez robot_save_project_as.");
        Write(_m.FilePath);
    });

    public void SaveProjectAs(string path) => Locked(() =>
    {
        _m.FilePath = path;
        Write(path);
    });

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = false, IncludeFields = true };

    private void Write(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllText(path, JsonSerializer.Serialize(Snapshot(), Json));
    }

    private sealed record Snap(string Name, string? FilePath, List<NodeData> Nodes, List<BarData> Bars, List<PanelSnap> Panels,
        List<MaterialData> Materials, List<SectionSnap> Sections, List<ThicknessData> Thicknesses, List<SupportData> Supports,
        List<ReleaseData> Releases, List<LoadCaseData> Cases, List<LoadRecordData> Loads, List<CombinationData> Combinations,
        Dictionary<int, double> MeshSizes, bool MeshGenerated);
    private sealed record PanelSnap(int Id, List<Point3> Contour, string? Thickness, string? Material, double? ThicknessValue, bool Meshed);
    private sealed record SectionSnap(string Name, string Shape, string? Material, bool IsConcrete, Dictionary<string, double> Dimensions, Dictionary<string, double> Properties);

    private Snap Snapshot() => new(_m.Name, _m.FilePath, _m.Nodes.Values.ToList(), _m.Bars.Values.ToList(),
        _m.Panels.Values.Select(p => new PanelSnap(p.Id, p.Contour.ToList(), p.Thickness, p.Material, p.ThicknessValue, p.Meshed)).ToList(),
        _m.Materials.Values.ToList(),
        _m.Sections.Values.Select(s => new SectionSnap(s.Name, s.Shape, s.Material, s.IsConcrete, new(s.Dimensions), new(s.Properties))).ToList(),
        _m.Thicknesses.Values.ToList(), _m.Supports.Values.ToList(), _m.Releases.Values.ToList(), _m.Cases.Values.ToList(),
        _m.Loads.Values.SelectMany(l => l).ToList(), _m.Combinations.Values.ToList(), new(_m.MeshSizes), _m.MeshGenerated);

    public void WriteCheckpoint(string path) => Locked(() => Write(path));

    public void RestoreCheckpoint(string path) => Locked(() =>
    {
        var s = JsonSerializer.Deserialize<Snap>(File.ReadAllText(path), Json)
                ?? throw new RobotMcpException(ErrorCodes.CheckpointFailed, "Checkpoint illisible.");
        var keepPath = _m.FilePath;
        _m = new SimModel
        {
            Name = s.Name,
            FilePath = keepPath,
            Nodes = new(s.Nodes.ToDictionary(n => n.Id)),
            Bars = new(s.Bars.ToDictionary(b => b.Id)),
            Panels = new(s.Panels.ToDictionary(p => p.Id, p => new PanelData(p.Id, p.Contour, p.Thickness, p.Material, p.ThicknessValue, p.Meshed))),
            Materials = s.Materials.ToDictionary(m => m.Name),
            Sections = s.Sections.ToDictionary(x => x.Name, x => new SectionData(x.Name, x.Shape, x.Material, x.IsConcrete, x.Dimensions, x.Properties)),
            Thicknesses = s.Thicknesses.ToDictionary(t => t.Name),
            Supports = s.Supports.ToDictionary(x => x.Name),
            Releases = s.Releases.ToDictionary(x => x.Name),
            Cases = new(s.Cases.ToDictionary(c => c.Id)),
            Loads = s.Loads.GroupBy(l => l.CaseId).ToDictionary(g => g.Key, g => g.ToList()),
            Combinations = new(s.Combinations.ToDictionary(c => c.Id)),
            MeshSizes = s.MeshSizes,
            MeshGenerated = s.MeshGenerated,
        };
        Results.Available = false;
    });

    // --- Nœuds ------------------------------------------------------------------------------------

    public IReadOnlyList<NodeData> GetNodes(IReadOnlyCollection<int>? ids = null) => Locked(() =>
    {
        IEnumerable<NodeData> nodes = ids is { Count: > 0 } ? ids.Where(_m.Nodes.ContainsKey).Select(i => _m.Nodes[i]) : _m.Nodes.Values;
        return (IReadOnlyList<NodeData>)nodes.Select(n => n with { Support = SupportOf(n.Id) }).ToList();
    });

    private string? SupportOf(int node) => _m.Supports.Values.FirstOrDefault(s => s.Nodes.Contains(node))?.Name;

    public bool NodeExists(int id) => Locked(() => _m.Nodes.ContainsKey(id));
    public int NextNodeId() => Locked(() => _m.Nodes.Count == 0 ? 1 : _m.Nodes.Keys.Max() + 1);

    public void CreateNode(int id, double x, double y, double z) => Locked(() =>
    {
        if (_m.Nodes.ContainsKey(id)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Nœud {id} déjà existant.");
        _m.Nodes[id] = new NodeData(id, x, y, z, null);
        Invalidate();
    });

    public void MoveNode(int id, double x, double y, double z) => Locked(() =>
    {
        if (!_m.Nodes.TryGetValue(id, out var n)) throw Missing("Nœud", id);
        _m.Nodes[id] = n with { X = x, Y = y, Z = z };
        foreach (var b in _m.Bars.Values.Where(b => b.StartNode == id || b.EndNode == id).ToList())
            _m.Bars[b.Id] = b with { Length = BarLength(b.StartNode, b.EndNode) };
        Invalidate();
    });

    public void DeleteNode(int id) => Locked(() =>
    {
        if (!_m.Nodes.Remove(id)) throw Missing("Nœud", id);
        // Comme Robot : supprimer un nœud supprime les barres qui s'y rattachent.
        foreach (var b in _m.Bars.Values.Where(b => b.StartNode == id || b.EndNode == id).Select(b => b.Id).ToList()) _m.Bars.Remove(b);
        foreach (var s in _m.Supports.Values.ToList())
            _m.Supports[s.Name] = s with { Nodes = s.Nodes.Where(n => n != id).ToList() };
        Invalidate();
    });

    private void Invalidate()
    {
        Results.Available = false;
        _m.MeshGenerated = false;
    }

    private double BarLength(int a, int b) => _m.Nodes[a].Point.DistanceTo(_m.Nodes[b].Point);

    // --- Barres ------------------------------------------------------------------------------------

    public IReadOnlyList<BarData> GetBars(IReadOnlyCollection<int>? ids = null) => Locked(() =>
        (IReadOnlyList<BarData>)(ids is { Count: > 0 } ? ids.Where(_m.Bars.ContainsKey).Select(i => _m.Bars[i]) : _m.Bars.Values)
            .Select(b => b with { Release = _m.Releases.Values.FirstOrDefault(r => r.Bars.Contains(b.Id))?.Name }).ToList());

    public bool BarExists(int id) => Locked(() => _m.Bars.ContainsKey(id));
    public int NextBarId() => Locked(() => _m.Bars.Count == 0 ? 1 : _m.Bars.Keys.Max() + 1);

    public void CreateBar(int id, int startNode, int endNode) => Locked(() =>
    {
        if (_m.Bars.ContainsKey(id)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Barre {id} déjà existante.");
        if (!_m.Nodes.ContainsKey(startNode)) throw Missing("Nœud", startNode);
        if (!_m.Nodes.ContainsKey(endNode)) throw Missing("Nœud", endNode);
        _m.Bars[id] = new BarData(id, startNode, endNode, BarLength(startNode, endNode), 0, null, null, null);
        Invalidate();
    });

    public void SetBarNodes(int id, int startNode, int endNode) => Locked(() =>
    {
        if (!_m.Bars.TryGetValue(id, out var b)) throw Missing("Barre", id);
        _m.Bars[id] = b with { StartNode = startNode, EndNode = endNode, Length = BarLength(startNode, endNode) };
        Invalidate();
    });

    public void SetBarGamma(int id, double gammaRad) => Locked(() =>
    {
        if (!_m.Bars.TryGetValue(id, out var b)) throw Missing("Barre", id);
        _m.Bars[id] = b with { GammaRad = gammaRad };
        Invalidate();
    });

    public void DeleteBar(int id) => Locked(() =>
    {
        if (!_m.Bars.Remove(id)) throw Missing("Barre", id);
        foreach (var r in _m.Releases.Values.ToList()) _m.Releases[r.Name] = r with { Bars = r.Bars.Where(b => b != id).ToList() };
        Invalidate();
    });

    // --- Panneaux ----------------------------------------------------------------------------------

    public IReadOnlyList<PanelData> GetPanels(IReadOnlyCollection<int>? ids = null) => Locked(() =>
        (IReadOnlyList<PanelData>)(ids is { Count: > 0 } ? ids.Where(_m.Panels.ContainsKey).Select(i => _m.Panels[i]) : _m.Panels.Values)
            .Select(p =>
            {
                var t = p.Thickness is not null && _m.Thicknesses.TryGetValue(p.Thickness, out var th) ? th : null;
                return p with { ThicknessValue = t?.Thickness, Material = t?.Material, FiniteElementCount = _m.MeshGenerated && p.Meshed ? EstimateElements(p) : 0 };
            }).ToList());

    private int EstimateElements(PanelData p)
    {
        var size = _m.MeshSizes.TryGetValue(p.Id, out var s) ? s : 0.5;
        return Math.Max(1, (int)Math.Ceiling(GeometryMath.Area(p.Contour) / (size * size)));
    }

    public bool PanelExists(int id) => Locked(() => _m.Panels.ContainsKey(id));
    public int NextPanelId() => Locked(() => Math.Max(_m.Panels.Count == 0 ? 1 : _m.Panels.Keys.Max() + 1, _m.Bars.Count == 0 ? 1 : _m.Bars.Keys.Max() + 1));

    public void CreatePanel(int id, IReadOnlyList<Point3> contour, string thicknessLabel) => Locked(() =>
    {
        if (_m.Panels.ContainsKey(id)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Panneau {id} déjà existant.");
        if (!_m.Thicknesses.ContainsKey(thicknessLabel)) throw Missing("Épaisseur", thicknessLabel);
        _m.Panels[id] = new PanelData(id, contour.ToList(), thicknessLabel, null, null, true);
        Invalidate();
    });

    public void DeletePanel(int id) => Locked(() =>
    {
        if (!_m.Panels.Remove(id)) throw Missing("Panneau", id);
        _m.MeshSizes.Remove(id);
        Invalidate();
    });

    // --- Affectations ------------------------------------------------------------------------------

    public void AssignSection(IReadOnlyCollection<int> barIds, string sectionName) => Locked(() =>
    {
        if (!_m.Sections.ContainsKey(sectionName)) throw Missing("Section", sectionName);
        foreach (var id in barIds)
        {
            if (!_m.Bars.TryGetValue(id, out var b)) throw Missing("Barre", id);
            _m.Bars[id] = b with { Section = sectionName };
        }
        Invalidate();
    });

    public void AssignMaterial(ElementKind kind, IReadOnlyCollection<int> ids, string materialName) => Locked(() =>
    {
        if (kind != ElementKind.Bar) throw new RobotMcpException(ErrorCodes.ValidationFailed, "Affectation directe de matériau : barres uniquement.");
        if (!_m.Materials.ContainsKey(materialName)) throw Missing("Matériau", materialName);
        foreach (var id in ids)
        {
            if (!_m.Bars.TryGetValue(id, out var b)) throw Missing("Barre", id);
            _m.Bars[id] = b with { Material = materialName };
        }
        Invalidate();
    });

    public void AssignSupport(IReadOnlyCollection<int> nodeIds, string supportName) => Locked(() =>
    {
        if (!_m.Supports.TryGetValue(supportName, out var s)) throw Missing("Appui", supportName);
        foreach (var id in nodeIds) if (!_m.Nodes.ContainsKey(id)) throw Missing("Nœud", id);
        foreach (var other in _m.Supports.Values.ToList())
            _m.Supports[other.Name] = other with { Nodes = other.Nodes.Except(nodeIds).ToList() };
        s = _m.Supports[supportName];
        _m.Supports[supportName] = s with { Nodes = s.Nodes.Union(nodeIds).OrderBy(n => n).ToList() };
        Invalidate();
    });

    public void RemoveSupport(IReadOnlyCollection<int> nodeIds) => Locked(() =>
    {
        foreach (var s in _m.Supports.Values.ToList())
            _m.Supports[s.Name] = s with { Nodes = s.Nodes.Except(nodeIds).ToList() };
        Invalidate();
    });

    public void AssignRelease(IReadOnlyCollection<int> barIds, string releaseName) => Locked(() =>
    {
        if (!_m.Releases.ContainsKey(releaseName)) throw Missing("Relâchement", releaseName);
        foreach (var id in barIds) if (!_m.Bars.ContainsKey(id)) throw Missing("Barre", id);
        foreach (var r in _m.Releases.Values.ToList())
            _m.Releases[r.Name] = r with { Bars = r.Bars.Except(barIds).ToList() };
        var rel = _m.Releases[releaseName];
        _m.Releases[releaseName] = rel with { Bars = rel.Bars.Union(barIds).OrderBy(b => b).ToList() };
        Invalidate();
    });

    public void AssignThickness(IReadOnlyCollection<int> panelIds, string thicknessName) => Locked(() =>
    {
        if (!_m.Thicknesses.ContainsKey(thicknessName)) throw Missing("Épaisseur", thicknessName);
        foreach (var id in panelIds)
        {
            if (!_m.Panels.TryGetValue(id, out var p)) throw Missing("Panneau", id);
            _m.Panels[id] = p with { Thickness = thicknessName };
        }
        Invalidate();
    });

    // --- Matériaux, sections, épaisseurs -------------------------------------------------------------

    public IReadOnlyList<MaterialData> GetMaterials() => Locked(() => (IReadOnlyList<MaterialData>)_m.Materials.Values.ToList());

    /// <summary>Petite base de matériaux pour la simulation (valeurs nominales EN 1992-1-1 / EN 1993-1-1).</summary>
    private static readonly Dictionary<string, MaterialData> SimDatabase = new(StringComparer.OrdinalIgnoreCase)
    {
        ["C25/30"] = new("C25/30", "concrete", 31e9, 0.2, 31e9 / 2.4, 25e3, 1e-5, null, null),
        ["C30/37"] = new("C30/37", "concrete", 33e9, 0.2, 33e9 / 2.4, 25e3, 1e-5, null, null),
        ["C35/45"] = new("C35/45", "concrete", 34e9, 0.2, 34e9 / 2.4, 25e3, 1e-5, null, null),
        ["S235"] = new("S235", "steel", 210e9, 0.3, 81e9, 77e3, 1.2e-5, 235e6, 360e6),
        ["S355"] = new("S355", "steel", 210e9, 0.3, 81e9, 77e3, 1.2e-5, 355e6, 490e6),
    };

    public void UpsertMaterial(MaterialDefinition def) => Locked(() =>
    {
        MaterialData baseData = _m.Materials.TryGetValue(def.Name, out var existing)
            ? existing
            : new MaterialData(def.Name, def.Type, 0, 0, 0, 0, 0, null, null);
        if (def.DatabaseName is not null)
        {
            if (!SimDatabase.TryGetValue(def.DatabaseName, out var db))
                throw new RobotMcpException(ErrorCodes.NotFound, $"Matériau « {def.DatabaseName} » absent de la base simulée.");
            baseData = db with { Name = def.Name };
        }
        var e = def.E ?? baseData.E;
        var nu = def.Nu ?? baseData.Nu;
        _m.Materials[def.Name] = baseData with
        {
            Type = def.Type,
            E = e,
            Nu = nu,
            G = def.G ?? (def.E is not null || def.Nu is not null ? e / (2 * (1 + nu)) : baseData.G),
            UnitWeight = def.UnitWeight ?? baseData.UnitWeight,
            ThermalExpansion = def.ThermalExpansion ?? baseData.ThermalExpansion,
            YieldStrength = def.YieldStrength ?? baseData.YieldStrength,
        };
    });

    public IReadOnlyList<SectionData> GetSections() => Locked(() => (IReadOnlyList<SectionData>)_m.Sections.Values.ToList());

    public void UpsertSection(SectionDefinition def) => Locked(() =>
    {
        var dims = new Dictionary<string, double>();
        var props = new Dictionary<string, double>();
        bool concrete = def.Shape is SectionShape.ConcreteBeamRect or SectionShape.ConcreteColumnRect or SectionShape.ConcreteColumnCircular;
        switch (def.Shape)
        {
            case SectionShape.ConcreteBeamRect or SectionShape.ConcreteColumnRect:
            {
                double b = def.B!.Value, h = def.H!.Value;
                dims["b"] = b; dims["h"] = h;
                props["AX"] = b * h; props["IY"] = b * h * h * h / 12; props["IZ"] = h * b * b * b / 12;
                break;
            }
            case SectionShape.ConcreteColumnCircular:
            {
                double d = def.D!.Value;
                dims["d"] = d;
                props["AX"] = Math.PI * d * d / 4; props["IY"] = props["IZ"] = Math.PI * Math.Pow(d, 4) / 64;
                break;
            }
            case SectionShape.Tube:
            {
                double d = def.D!.Value, t = def.T!.Value, di = d - 2 * t;
                dims["d"] = d; dims["t"] = t;
                props["AX"] = Math.PI * (d * d - di * di) / 4; props["IY"] = props["IZ"] = Math.PI * (Math.Pow(d, 4) - Math.Pow(di, 4)) / 64;
                break;
            }
            case SectionShape.RectTube:
            {
                double b = def.B!.Value, h = def.H!.Value, t = def.T!.Value;
                dims["b"] = b; dims["h"] = h; dims["t"] = t;
                props["AX"] = b * h - (b - 2 * t) * (h - 2 * t);
                props["IY"] = (b * h * h * h - (b - 2 * t) * Math.Pow(h - 2 * t, 3)) / 12;
                props["IZ"] = (h * b * b * b - (h - 2 * t) * Math.Pow(b - 2 * t, 3)) / 12;
                break;
            }
            case SectionShape.SteelDatabase:
                dims["profile"] = 0;
                break;
        }
        var shape = def.Shape == SectionShape.SteelDatabase ? $"database:{def.DatabaseProfile}" : def.Shape.ToString();
        _m.Sections[def.Name] = new SectionData(def.Name, shape, def.Material, concrete, dims, props);
    });

    public IReadOnlyList<ThicknessData> GetThicknesses() => Locked(() => (IReadOnlyList<ThicknessData>)_m.Thicknesses.Values.ToList());

    public void UpsertThickness(ThicknessData def) => Locked(() => { _m.Thicknesses[def.Name] = def; });

    // --- Appuis / relâchements ------------------------------------------------------------------------

    public IReadOnlyList<SupportData> GetSupports() => Locked(() => (IReadOnlyList<SupportData>)_m.Supports.Values.ToList());

    public void UpsertSupport(SupportData def) => Locked(() =>
    {
        var nodes = _m.Supports.TryGetValue(def.Name, out var s) ? s.Nodes : Array.Empty<int>();
        _m.Supports[def.Name] = def with { Nodes = nodes.ToList() };
    });

    public void DeleteSupport(string name) => Locked(() =>
    {
        if (!_m.Supports.Remove(name)) throw Missing("Appui", name);
    });

    public IReadOnlyList<ReleaseData> GetReleases() => Locked(() => (IReadOnlyList<ReleaseData>)_m.Releases.Values.ToList());

    public void UpsertRelease(ReleaseData def) => Locked(() =>
    {
        var bars = _m.Releases.TryGetValue(def.Name, out var r) ? r.Bars : Array.Empty<int>();
        _m.Releases[def.Name] = def with { Bars = bars.ToList() };
    });

    // --- Cas / charges / combinaisons --------------------------------------------------------------------

    public IReadOnlyList<LoadCaseData> GetLoadCases() => Locked(() =>
        (IReadOnlyList<LoadCaseData>)_m.Cases.Values.Select(c => c with { RecordCount = _m.Loads.TryGetValue(c.Id, out var l) ? l.Count : 0 })
            .Concat(_m.Combinations.Values.Select(c => new LoadCaseData(c.Id, c.Name, "permanent", "combination", null, 0)))
            .OrderBy(c => c.Id).ToList());

    public bool CaseExists(int id) => Locked(() => _m.Cases.ContainsKey(id) || _m.Combinations.ContainsKey(id));

    public int NextCaseId() => Locked(() => _m.Cases.Keys.Concat(_m.Combinations.Keys).DefaultIfEmpty(0).Max() + 1);

    public void CreateLoadCase(int id, string name, CaseNature nature, AnalysisKind analysis, int? modalModes = null) => Locked(() =>
    {
        if (_m.Cases.ContainsKey(id) || _m.Combinations.ContainsKey(id)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Cas {id} déjà existant.");
        _m.Cases[id] = new LoadCaseData(id, name, nature.ToString().ToLowerInvariant(), "simple", Com.RobotComGateway.ApiName(analysis), 0);
        Results.Available = false;
    });

    public void DeleteCase(int id) => Locked(() =>
    {
        if (!_m.Cases.Remove(id) && !_m.Combinations.Remove(id)) throw Missing("Cas", id);
        _m.Loads.Remove(id);
        Results.Available = false;
    });

    public IReadOnlyList<LoadRecordData> GetLoads(int? caseId = null) => Locked(() =>
    {
        if (caseId is { } c && !_m.Cases.ContainsKey(c)) throw Missing("Cas", c);
        return (IReadOnlyList<LoadRecordData>)_m.Loads.Where(kv => caseId is null || kv.Key == caseId).SelectMany(kv => kv.Value).ToList();
    });

    public int AddLoad(int caseId, LoadDefinition load) => Locked(() =>
    {
        if (!_m.Cases.ContainsKey(caseId)) throw Missing("Cas", caseId);
        if (!_m.Loads.TryGetValue(caseId, out var list)) _m.Loads[caseId] = list = new List<LoadRecordData>();
        var values = new Dictionary<string, double>();
        switch (load.Kind)
        {
            case LoadKind.SelfWeight:
                values["Z"] = -load.Factor;
                values["ENTIRE_STRUCTURE"] = load.Objects.Count == 0 ? 1 : 0;
                break;
            case LoadKind.NodalForce:
                values["FX"] = load.FX; values["FY"] = load.FY; values["FZ"] = load.FZ;
                values["CX"] = load.MX; values["CY"] = load.MY; values["CZ"] = load.MZ;
                break;
            case LoadKind.BarUniform or LoadKind.PanelUniform:
                values["PX"] = load.FX; values["PY"] = load.FY; values["PZ"] = load.FZ;
                values["LOCAL"] = load.Local ? 1 : 0;
                break;
            case LoadKind.BarPointForce:
                values["FX"] = load.FX; values["FY"] = load.FY; values["FZ"] = load.FZ;
                values["X"] = load.Position ?? 0.5; values["REL"] = load.Relative ? 1 : 0;
                break;
            case LoadKind.BarTemperature:
                values["TX"] = load.Temperature;
                break;
        }
        var kind = load.Kind switch
        {
            LoadKind.SelfWeight => "self_weight", LoadKind.NodalForce => "nodal_force", LoadKind.BarUniform => "bar_uniform",
            LoadKind.BarPointForce => "bar_point_force", LoadKind.PanelUniform => "panel_uniform", _ => "bar_temperature",
        };
        list.Add(new LoadRecordData(caseId, list.Count + 1, kind, string.Join(" ", load.Objects), values));
        Results.Available = false;
        return list.Count;
    });

    public void DeleteLoad(int caseId, int recordIndex) => Locked(() =>
    {
        if (!_m.Loads.TryGetValue(caseId, out var list) || recordIndex < 1 || recordIndex > list.Count)
            throw new RobotMcpException(ErrorCodes.NotFound, $"Charge n°{recordIndex} du cas {caseId} inexistante.");
        list.RemoveAt(recordIndex - 1);
        for (int i = 0; i < list.Count; i++) list[i] = list[i] with { Index = i + 1 };
        Results.Available = false;
    });

    public IReadOnlyList<CombinationData> GetCombinations() => Locked(() => (IReadOnlyList<CombinationData>)_m.Combinations.Values.ToList());

    public void CreateCombination(int id, string name, CombinationType type, IReadOnlyList<CaseFactor> factors) => Locked(() =>
    {
        if (_m.Cases.ContainsKey(id) || _m.Combinations.ContainsKey(id)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Cas {id} déjà existant.");
        var t = type switch { CombinationType.Uls => "ULS", CombinationType.Sls => "SLS", _ => "ACC" };
        _m.Combinations[id] = new CombinationData(id, name, t, factors.ToList());
    });

    public IReadOnlyList<GroupData> GetGroups() => Locked(() => (IReadOnlyList<GroupData>)Array.Empty<GroupData>());

    // --- Maillage -----------------------------------------------------------------------------------------

    public IReadOnlyList<MeshSettingsData> GetMeshSettings(IReadOnlyCollection<int>? panelIds = null) => Locked(() =>
        (IReadOnlyList<MeshSettingsData>)(panelIds is { Count: > 0 } ? panelIds : _m.Panels.Keys)
            .Select(id => new MeshSettingsData(id, _m.MeshSizes.TryGetValue(id, out var s) ? s : null, "simulation", "I_MGT_ELEMENT_SIZE")).ToList());

    public void SetMeshSettings(IReadOnlyCollection<int> panelIds, double elementSize) => Locked(() =>
    {
        foreach (var id in panelIds)
        {
            if (!_m.Panels.ContainsKey(id)) throw Missing("Panneau", id);
            _m.MeshSizes[id] = elementSize;
        }
        _m.MeshGenerated = false;
    });

    public void GenerateMesh() => Locked(() => { _m.MeshGenerated = true; });

    public MeshStatistics GetMeshStatistics() => Locked(() =>
    {
        var panels = _m.Panels.Values.ToList();
        var fe = _m.MeshGenerated ? panels.Where(p => p.Meshed).Sum(EstimateElements) : 0;
        return new MeshStatistics(fe, _m.Nodes.Count, panels.Count, _m.MeshGenerated ? panels.Count(p => p.Meshed) : 0);
    });

    // --- Calcul / résultats ---------------------------------------------------------------------------------

    public AnalysisRunResult RunAnalysis() => Locked<AnalysisRunResult>(() =>
        throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation,
            "Le mode simulation ne contient aucun solveur : le calcul n'est possible qu'avec Robot (Robot:Mode=Com)."));

    public bool ResultsAvailable() => Locked(() => Results.Available);

    private void EnsureResults()
    {
        if (!Results.Available) throw new RobotMcpException(ErrorCodes.ResultsUnavailable, "Aucun résultat disponible (simulation).");
    }

    public NodeDisplacement GetNodeDisplacement(int node, int caseId) => Locked(() =>
    {
        EnsureResults();
        return Results.Displacements.TryGetValue((node, caseId), out var d) ? d : new NodeDisplacement(node, caseId, 0, 0, 0, 0, 0, 0);
    });

    public NodeReaction GetNodeReaction(int node, int caseId) => Locked(() =>
    {
        EnsureResults();
        return Results.Reactions.TryGetValue((node, caseId), out var r) ? r : new NodeReaction(node, caseId, 0, 0, 0, 0, 0, 0);
    });

    public BarForces GetBarForces(int bar, int caseId, double position) => Locked(() =>
    {
        EnsureResults();
        if (!Results.Forces.TryGetValue((bar, caseId), out var samples) || samples.Count == 0)
            return new BarForces(bar, caseId, position, 0, 0, 0, 0, 0, 0);
        var s = samples.OrderBy(f => Math.Abs(f.Position - position)).First();
        return s with { Position = position };
    });

    public BarDisplacement GetBarDisplacement(int bar, int caseId, double position) => Locked<BarDisplacement>(() =>
        throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation, "Déplacements de barres non simulés."));

    public BarDeflection GetBarDeflection(int bar, int caseId, double position) => Locked<BarDeflection>(() =>
        throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation, "Flèches non simulées."));

    public BarStress GetBarStress(int bar, int caseId, double position) => Locked<BarStress>(() =>
        throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation, "Contraintes non simulées."));

    public IReadOnlyList<PanelResultRow> GetPanelResults(int panel, int caseId) => Locked<IReadOnlyList<PanelResultRow>>(() =>
        throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation, "Résultats de panneaux non simulés."));

    public IReadOnlyList<SteelMemberCheck> RunSteelMemberVerification(IReadOnlyCollection<int> members, IReadOnlyCollection<int> cases) => Locked(() =>
    {
        EnsureResults();
        return (IReadOnlyList<SteelMemberCheck>)members.Select(m => Results.SteelRatios.TryGetValue(m, out var r)
            ? new SteelMemberCheck(m, _m.Bars.TryGetValue(m, out var b) ? b.Section : null, r, null, r <= 1 ? "ok" : "exceeded")
            : new SteelMemberCheck(m, null, null, null, "unavailable")).ToList();
    });

    public ApiVerificationReport VerifyApi() => throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation,
        "robot_verify_api nécessite une instance Robot réelle (mode Com).");

    public IReadOnlyList<string> DescribeApi(string interfaceName) => throw new RobotMcpException(ErrorCodes.NotSupportedInSimulation,
        "robot_describe_api nécessite une instance Robot réelle (mode Com).");
}
