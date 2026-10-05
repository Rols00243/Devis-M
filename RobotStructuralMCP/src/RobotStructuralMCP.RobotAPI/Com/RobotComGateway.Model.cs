using Microsoft.Extensions.Logging;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.RobotAPI.Com;

public sealed partial class RobotComGateway
{
    private const string LT = "IRobotLabelType";
    private const string OT = "IRobotObjectType";

    private string? LabelName(dynamic obj, string labelType)
    {
        if (!_typeLib.TryEnumValue(LT, labelType, out var lt)) return null;
        try
        {
            if (!B(obj.HasLabel(lt))) return null;
            var n = S(obj.GetLabelName(lt));
            return string.IsNullOrEmpty(n) ? null : n;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Itère une IRobotCollection (indices 1..Count).</summary>
    private static IEnumerable<dynamic> Items(dynamic collection)
    {
        int count = I(collection.Count);
        for (int i = 1; i <= count; i++) yield return collection.Get(i);
    }

    // ---------------------------- Nœuds ----------------------------------------------------

    private NodeData ReadNode(dynamic n) =>
        new(I(n.Number), D(n.X), D(n.Y), D(n.Z), LabelName(n, "I_LT_SUPPORT"));

    public IReadOnlyList<NodeData> GetNodes(IReadOnlyCollection<int>? ids = null) => Call("get_nodes", () =>
    {
        dynamic nodes = Structure.Nodes;
        var list = new List<NodeData>();
        if (ids is { Count: > 0 })
        {
            foreach (var id in ids)
                if (B(nodes.Exist(id))) list.Add(ReadNode(nodes.Get(id)));
        }
        else
        {
            foreach (var n in Items(nodes.GetAll())) list.Add(ReadNode(n));
        }
        return (IReadOnlyList<NodeData>)list.OrderBy(n => n.Id).ToList();
    });

    public bool NodeExists(int id) => Call("node_exists", () => B(Structure.Nodes.Exist(id)));

    public int NextNodeId() => Call("next_node_id", () => I(Structure.Nodes.FreeNumber));

    public void CreateNode(int id, double x, double y, double z) => Call("create_node", () => { Structure.Nodes.Create(id, x, y, z); });

    public void MoveNode(int id, double x, double y, double z) => Call("move_node", () =>
    {
        dynamic n = Structure.Nodes.Get(id);
        n.X = x;
        n.Y = y;
        n.Z = z;
    });

    public void DeleteNode(int id) => Call("delete_node", () => { Structure.Nodes.Delete(id); });

    // ---------------------------- Barres ---------------------------------------------------

    private BarData ReadBar(dynamic b) =>
        new(I(b.Number), I(b.StartNode), I(b.EndNode), D(b.Length), Try<double>(() => D(b.Gamma)),
            LabelName(b, "I_LT_BAR_SECTION"), LabelName(b, "I_LT_MATERIAL"), LabelName(b, "I_LT_BAR_RELEASE"));

    public IReadOnlyList<BarData> GetBars(IReadOnlyCollection<int>? ids = null) => Call("get_bars", () =>
    {
        dynamic bars = Structure.Bars;
        var list = new List<BarData>();
        if (ids is { Count: > 0 })
        {
            foreach (var id in ids)
                if (B(bars.Exist(id))) list.Add(ReadBar(bars.Get(id)));
        }
        else
        {
            foreach (var b in Items(bars.GetAll())) list.Add(ReadBar(b));
        }
        return (IReadOnlyList<BarData>)list.OrderBy(b => b.Id).ToList();
    });

    public bool BarExists(int id) => Call("bar_exists", () => B(Structure.Bars.Exist(id)));

    public int NextBarId() => Call("next_bar_id", () => I(Structure.Bars.FreeNumber));

    public void CreateBar(int id, int startNode, int endNode) => Call("create_bar", () => { Structure.Bars.Create(id, startNode, endNode); });

    public void SetBarNodes(int id, int startNode, int endNode) => Call("update_bar", () =>
    {
        dynamic b = Structure.Bars.Get(id);
        b.StartNode = startNode;
        b.EndNode = endNode;
    });

    public void SetBarGamma(int id, double gammaRad) => Call("update_bar", () =>
    {
        dynamic b = Structure.Bars.Get(id);
        b.Gamma = gammaRad;
    });

    public void DeleteBar(int id) => Call("delete_bar", () => { Structure.Bars.Delete(id); });

    // ---------------------------- Panneaux -------------------------------------------------

    private IReadOnlyList<int> AllPanelNumbers()
    {
        dynamic sel = Structure.Selections.CreateFull(E(OT, "I_OT_PANEL"));
        int count = I(sel.Count);
        var ids = new List<int>(count);
        for (int i = 1; i <= count; i++) ids.Add(I(sel.Get(i)));
        return ids;
    }

    private IReadOnlyList<Point3> ReadContour(dynamic obj)
    {
        // Géométrie du contour : IRobotObjObject.Main.Geometry (IRobotGeoContour) → Segments → P1.
        var pts = new List<Point3>();
        try
        {
            dynamic geo = obj.Main.Geometry;
            dynamic segs = geo.Segments;
            int count = I(segs.Count);
            for (int i = 1; i <= count; i++)
            {
                dynamic seg = segs.Get(i);
                dynamic p = seg.P1;
                pts.Add(new Point3(D(p.X), D(p.Y), D(p.Z)));
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Lecture du contour impossible pour le panneau");
        }
        return pts;
    }

    private PanelData ReadPanel(int id)
    {
        dynamic obj = Structure.Objects.Get(id);
        var thick = LabelName(obj, "I_LT_PANEL_THICKNESS");
        double? thickness = null;
        string? material = null;
        if (thick is not null)
        {
            var t = ReadThickness(thick);
            thickness = t?.Thickness;
            material = t?.Material;
        }
        bool meshed = Try<bool>(() => B(obj.Main.Attribs.Meshed));
        return new PanelData(id, ReadContour(obj), thick, material, thickness, meshed);
    }

    public IReadOnlyList<PanelData> GetPanels(IReadOnlyCollection<int>? ids = null) => Call("get_panels", () =>
    {
        var numbers = ids is { Count: > 0 } ? ids.Where(i => B(Structure.Objects.Exist(i))).ToList() : AllPanelNumbers();
        return (IReadOnlyList<PanelData>)numbers.OrderBy(i => i).Select(ReadPanel).ToList();
    });

    public bool PanelExists(int id) => Call("panel_exists", () => AllPanelNumbers().Contains(id));

    public int NextPanelId() => Call("next_panel_id", () => I(Structure.Objects.FreeNumber));

    public void CreatePanel(int id, IReadOnlyList<Point3> contour, string thicknessLabel) => Call("create_panel", () =>
    {
        // Séquence de l'exemple officiel RobotOM : points → CreateContour → Meshed=1 → épaisseur → Initialize/Update.
        dynamic pts = App.CmpntFactory.Create(E("IRobotComponentType", "I_CT_POINTS_ARRAY"));
        pts.SetSize(contour.Count);
        for (int i = 0; i < contour.Count; i++) pts.Set(i + 1, contour[i].X, contour[i].Y, contour[i].Z);
        Structure.Objects.CreateContour(id, pts);
        dynamic obj = Structure.Objects.Get(id);
        obj.Main.Attribs.Meshed = 1;
        obj.SetLabel(E(LT, "I_LT_PANEL_THICKNESS"), thicknessLabel);
        obj.Initialize();
        Try(() => { obj.Update(); return true; });
    });

    public void DeletePanel(int id) => Call("delete_panel", () => { Structure.Objects.Delete(id); });

    // ---------------------------- Affectations ------------------------------------------------

    private void SetLabelOn(dynamic server, IReadOnlyCollection<int> ids, string labelType, string name)
    {
        var lt = E(LT, labelType);
        if (!B(Structure.Labels.Exist(lt, name)))
            throw new RobotMcpException(ErrorCodes.NotFound, $"Étiquette {labelType} « {name} » inexistante dans le projet.");
        foreach (var id in ids)
        {
            dynamic o = server.Get(id);
            o.SetLabel(lt, name);
        }
    }

    public void AssignSection(IReadOnlyCollection<int> barIds, string sectionName) =>
        Call("assign_section", () => SetLabelOn(Structure.Bars, barIds, "I_LT_BAR_SECTION", sectionName));

    public void AssignMaterial(ElementKind kind, IReadOnlyCollection<int> ids, string materialName) => Call("assign_material", () =>
    {
        if (kind != ElementKind.Bar)
            throw new RobotMcpException(ErrorCodes.ValidationFailed, "Affectation directe de matériau supportée uniquement pour les barres (les panneaux passent par leur épaisseur).");
        SetLabelOn(Structure.Bars, ids, "I_LT_MATERIAL", materialName);
    });

    public void AssignSupport(IReadOnlyCollection<int> nodeIds, string supportName) =>
        Call("assign_support", () => SetLabelOn(Structure.Nodes, nodeIds, "I_LT_SUPPORT", supportName));

    public void RemoveSupport(IReadOnlyCollection<int> nodeIds) => Call("remove_support", () =>
    {
        var lt = E(LT, "I_LT_SUPPORT");
        foreach (var id in nodeIds)
        {
            dynamic n = Structure.Nodes.Get(id);
            n.RemoveLabel(lt);
        }
    });

    public void AssignRelease(IReadOnlyCollection<int> barIds, string releaseName) =>
        Call("assign_bar_release", () => SetLabelOn(Structure.Bars, barIds, "I_LT_BAR_RELEASE", releaseName));

    public void AssignThickness(IReadOnlyCollection<int> panelIds, string thicknessName) => Call("assign_thickness", () =>
    {
        var lt = E(LT, "I_LT_PANEL_THICKNESS");
        foreach (var id in panelIds)
        {
            dynamic o = Structure.Objects.Get(id);
            o.SetLabel(lt, thicknessName);
            Try(() => { o.Update(); return true; });
        }
    });

    // ---------------------------- Étiquettes : utilitaires ------------------------------------

    private IReadOnlyList<string> LabelNames(string labelType)
    {
        dynamic names = Structure.Labels.GetAvailableNames(E(LT, labelType));
        int count = I(names.Count);
        var list = new List<string>(count);
        for (int i = 1; i <= count; i++) list.Add(S(names.Get(i)));
        return list;
    }

    private dynamic GetOrCreateLabel(string labelType, string name)
    {
        var lt = E(LT, labelType);
        dynamic labels = Structure.Labels;
        return B(labels.Exist(lt, name)) ? labels.Get(lt, name) : labels.Create(lt, name);
    }

    // ---------------------------- Matériaux ----------------------------------------------------

    private static readonly (string Robot, string Api)[] MaterialTypes =
    {
        ("I_MT_STEEL", "steel"), ("I_MT_CONCRETE", "concrete"), ("I_MT_ALUMINIUM", "aluminium"),
        ("I_MT_TIMBER", "timber"), ("I_MT_OTHER", "other"),
    };

    public IReadOnlyList<MaterialData> GetMaterials() => Call("get_materials", () =>
    {
        var list = new List<MaterialData>();
        foreach (var name in LabelNames("I_LT_MATERIAL"))
        {
            dynamic data = Structure.Labels.Get(E(LT, "I_LT_MATERIAL"), name).Data;
            var typeName = _typeLib.EnumName("IRobotMaterialType", Try<int>(() => I(data.Type)));
            var apiType = MaterialTypes.FirstOrDefault(t => t.Robot == typeName).Api ?? typeName;
            list.Add(new MaterialData(name, apiType, Try<double>(() => D(data.E)), Try<double>(() => D(data.NU)), Try<double>(() => D(data.Kirchoff)),
                Try<double>(() => D(data.RO)), Try<double>(() => D(data.LX)), Try(() => (double?)D(data.RE)), Try(() => (double?)D(data.RT))));
        }
        return (IReadOnlyList<MaterialData>)list;
    });

    public void UpsertMaterial(MaterialDefinition def) => Call("upsert_material", () =>
    {
        dynamic label = GetOrCreateLabel("I_LT_MATERIAL", def.Name);
        dynamic data = label.Data;
        if (!string.IsNullOrWhiteSpace(def.DatabaseName))
        {
            bool ok = B(data.LoadFromDBase(def.DatabaseName));
            if (!ok)
                throw new RobotMcpException(ErrorCodes.NotFound, $"Matériau « {def.DatabaseName} » introuvable dans la base de matériaux active de Robot.");
        }
        var robotType = MaterialTypes.FirstOrDefault(t => t.Api == def.Type).Robot;
        if (robotType is not null && _typeLib.TryEnumValue("IRobotMaterialType", robotType, out var mt)) data.Type = mt;
        if (def.E is { } e) data.E = e;
        if (def.Nu is { } nu) data.NU = nu;
        if (def.G is { } g) data.Kirchoff = g;
        else if (def.E is { } e2 && def.Nu is { } nu2) data.Kirchoff = e2 / (2 * (1 + nu2));
        if (def.UnitWeight is { } ro) data.RO = ro;
        if (def.ThermalExpansion is { } lx) data.LX = lx;
        if (def.YieldStrength is { } re) data.RE = re;
        Structure.Labels.Store(label);
    });

    // ---------------------------- Sections ------------------------------------------------------

    private static readonly string[] SectionProps = { "AX", "AY", "AZ", "IX", "IY", "IZ", "VY", "VPY", "VZ", "VPZ" };

    public IReadOnlyList<SectionData> GetSections() => Call("get_sections", () =>
    {
        var list = new List<SectionData>();
        foreach (var name in LabelNames("I_LT_BAR_SECTION"))
        {
            dynamic data = Structure.Labels.Get(E(LT, "I_LT_BAR_SECTION"), name).Data;
            var shape = _typeLib.EnumName("IRobotBarSectionShapeType", Try<int>(() => I(data.ShapeType)));
            var props = new Dictionary<string, double>();
            foreach (var p in SectionProps)
                if (_typeLib.TryEnumValue("IRobotBarSectionDataValue", "I_BSDV_" + p, out var v))
                {
                    var value = Try(() => (double?)D(data.GetValue(v)));
                    if (value is not null) props[p] = value.Value;
                }
            var dims = new Dictionary<string, double>();
            bool concrete = Try<bool>(() => B(data.IsConcrete)) || shape.Contains("CONCR", StringComparison.OrdinalIgnoreCase);
            if (concrete)
            {
                foreach (var (key, member) in new[] { ("b", "I_BSCDV_BEAM_B"), ("h", "I_BSCDV_BEAM_H"), ("b", "I_BSCDV_COL_B"), ("h", "I_BSCDV_COL_H"), ("d", "I_BSCDV_COL_DE") })
                {
                    if (dims.ContainsKey(key) || !_typeLib.TryEnumValue("IRobotBarSectionConcreteDataValue", member, out var cv)) continue;
                    var value = Try(() => (double?)D(data.Concrete.GetValue(cv)));
                    if (value is > 0) dims[key] = value.Value;
                }
            }
            list.Add(new SectionData(name, shape, NullIfEmpty(Try<string>(() => S(data.MaterialName))), concrete, dims, props));
        }
        return (IReadOnlyList<SectionData>)list;
    });

    public void UpsertSection(SectionDefinition def) => Call("upsert_section", () =>
    {
        dynamic label = GetOrCreateLabel("I_LT_BAR_SECTION", def.Name);
        dynamic data = label.Data;
        const string shapeEnum = "IRobotBarSectionShapeType";
        const string concEnum = "IRobotBarSectionConcreteDataValue";
        const string nsEnum = "IRobotBarSectionNonstdDataValue";
        switch (def.Shape)
        {
            case SectionShape.ConcreteBeamRect:
                data.ShapeType = E(shapeEnum, "I_BSST_CONCR_BEAM_RECT");
                data.Concrete.SetValue(E(concEnum, "I_BSCDV_BEAM_B"), def.B!.Value);
                data.Concrete.SetValue(E(concEnum, "I_BSCDV_BEAM_H"), def.H!.Value);
                data.CalcNonstdGeometry();
                break;
            case SectionShape.ConcreteColumnRect:
                data.ShapeType = E(shapeEnum, "I_BSST_CONCR_COL_R");
                data.Concrete.SetValue(E(concEnum, "I_BSCDV_COL_B"), def.B!.Value);
                data.Concrete.SetValue(E(concEnum, "I_BSCDV_COL_H"), def.H!.Value);
                data.CalcNonstdGeometry();
                break;
            case SectionShape.ConcreteColumnCircular:
                data.ShapeType = E(shapeEnum, "I_BSST_CONCR_COL_C");
                data.Concrete.SetValue(E(concEnum, "I_BSCDV_COL_DE"), def.D!.Value);
                data.CalcNonstdGeometry();
                break;
            case SectionShape.SteelDatabase:
                if (!B(data.LoadFromDBase(def.DatabaseProfile)))
                    throw new RobotMcpException(ErrorCodes.NotFound,
                        $"Profil « {def.DatabaseProfile} » introuvable dans les bases de profilés actives de Robot (Outils > Préférences du projet > Profilés).");
                break;
            case SectionShape.Tube:
            {
                data.Type = E("IRobotBarSectionType", "I_BST_NS_TUBE");
                data.ShapeType = E(shapeEnum, "I_BSST_TUBE");
                dynamic ns = data.CreateNonstd(0);
                ns.SetValue(E(nsEnum, "I_BSNDV_TUBE_D"), def.D!.Value);
                ns.SetValue(E(nsEnum, "I_BSNDV_TUBE_T"), def.T!.Value);
                data.CalcNonstdGeometry();
                break;
            }
            case SectionShape.RectTube:
            {
                data.Type = E("IRobotBarSectionType", "I_BST_NS_RECT");
                data.ShapeType = E(shapeEnum, "I_BSST_RECT");
                dynamic ns = data.CreateNonstd(0);
                ns.SetValue(E(nsEnum, "I_BSNDV_RECT_B"), def.B!.Value);
                ns.SetValue(E(nsEnum, "I_BSNDV_RECT_H"), def.H!.Value);
                ns.SetValue(E(nsEnum, "I_BSNDV_RECT_T"), def.T!.Value);
                data.CalcNonstdGeometry();
                break;
            }
        }
        if (!string.IsNullOrWhiteSpace(def.Material)) data.MaterialName = def.Material;
        Structure.Labels.Store(label);
    });

    // ---------------------------- Épaisseurs -----------------------------------------------------

    private ThicknessData? ReadThickness(string name)
    {
        try
        {
            dynamic data = Structure.Labels.Get(E(LT, "I_LT_PANEL_THICKNESS"), name).Data;
            double t = Try<double>(() => D(data.Data.ThickConst));
            return new ThicknessData(name, t, NullIfEmpty(Try<string>(() => S(data.MaterialName))));
        }
        catch
        {
            return null;
        }
    }

    public IReadOnlyList<ThicknessData> GetThicknesses() => Call("get_thicknesses", () =>
        (IReadOnlyList<ThicknessData>)LabelNames("I_LT_PANEL_THICKNESS").Select(ReadThickness).Where(t => t is not null).Cast<ThicknessData>().ToList());

    public void UpsertThickness(ThicknessData def) => Call("upsert_thickness", () =>
    {
        dynamic label = GetOrCreateLabel("I_LT_PANEL_THICKNESS", def.Name);
        dynamic data = label.Data;
        data.ThicknessType = E("IRobotThicknessType", "I_TT_HOMOGENEOUS");
        dynamic homo = data.Data;
        homo.ThickConst = def.Thickness;
        if (!string.IsNullOrWhiteSpace(def.Material)) data.MaterialName = def.Material;
        Structure.Labels.Store(label);
    });

    // ---------------------------- Appuis ------------------------------------------------------------

    private static DofDefinition ReadDof(int fixedFlag, double stiffness) =>
        fixedFlag != 0 ? DofDefinition.Fixed : stiffness > 0 ? new DofDefinition(DofState.Spring, stiffness) : DofDefinition.Free;

    public IReadOnlyList<SupportData> GetSupports() => Call("get_supports", () =>
    {
        var byLabel = new Dictionary<string, List<int>>();
        foreach (var n in Items(Structure.Nodes.GetAll()))
        {
            string? s = LabelName(n, "I_LT_SUPPORT");
            if (s is null) continue;
            if (!byLabel.TryGetValue(s, out var l)) byLabel[s] = l = new List<int>();
            l.Add(I(n.Number));
        }
        var list = new List<SupportData>();
        foreach (var name in LabelNames("I_LT_SUPPORT"))
        {
            dynamic d = Structure.Labels.Get(E(LT, "I_LT_SUPPORT"), name).Data;
            list.Add(new SupportData(name,
                ReadDof(I(d.UX), Try<double>(() => D(d.KX))), ReadDof(I(d.UY), Try<double>(() => D(d.KY))), ReadDof(I(d.UZ), Try<double>(() => D(d.KZ))),
                ReadDof(I(d.RX), Try<double>(() => D(d.HX))), ReadDof(I(d.RY), Try<double>(() => D(d.HY))), ReadDof(I(d.RZ), Try<double>(() => D(d.HZ))),
                byLabel.TryGetValue(name, out var nodes) ? nodes : new List<int>()));
        }
        return (IReadOnlyList<SupportData>)list;
    });

    public void UpsertSupport(SupportData def) => Call("upsert_support", () =>
    {
        dynamic label = GetOrCreateLabel("I_LT_SUPPORT", def.Name);
        dynamic d = label.Data;
        d.UX = def.UX.State == DofState.Fixed ? 1 : 0;
        d.UY = def.UY.State == DofState.Fixed ? 1 : 0;
        d.UZ = def.UZ.State == DofState.Fixed ? 1 : 0;
        d.RX = def.RX.State == DofState.Fixed ? 1 : 0;
        d.RY = def.RY.State == DofState.Fixed ? 1 : 0;
        d.RZ = def.RZ.State == DofState.Fixed ? 1 : 0;
        if (def.UX.State == DofState.Spring) d.KX = def.UX.Stiffness!.Value;
        if (def.UY.State == DofState.Spring) d.KY = def.UY.Stiffness!.Value;
        if (def.UZ.State == DofState.Spring) d.KZ = def.UZ.Stiffness!.Value;
        if (def.RX.State == DofState.Spring) d.HX = def.RX.Stiffness!.Value;
        if (def.RY.State == DofState.Spring) d.HY = def.RY.Stiffness!.Value;
        if (def.RZ.State == DofState.Spring) d.HZ = def.RZ.Stiffness!.Value;
        Structure.Labels.Store(label);
    });

    public void DeleteSupport(string name) => Call("delete_support", () =>
    {
        var lt = E(LT, "I_LT_SUPPORT");
        if (!B(Structure.Labels.Exist(lt, name)))
            throw new RobotMcpException(ErrorCodes.NotFound, $"Appui « {name} » inexistant.");
        Structure.Labels.Delete(lt, name);
    });

    // ---------------------------- Relâchements ---------------------------------------------------

    private EndRelease ReadEnd(dynamic end)
    {
        var released = _typeLib.EnumValue("IRobotBarEndReleaseValue", _options.ReleaseReleasedValue);
        bool R(Func<object> f) => Try<int?>(() => I(f())) == released;
        return new EndRelease(R(() => end.UX), R(() => end.UY), R(() => end.UZ), R(() => end.RX), R(() => end.RY), R(() => end.RZ));
    }

    private void WriteEnd(dynamic end, EndRelease r)
    {
        var released = E("IRobotBarEndReleaseValue", _options.ReleaseReleasedValue);
        var connected = E("IRobotBarEndReleaseValue", _options.ReleaseConnectedValue);
        end.UX = r.UX ? released : connected;
        end.UY = r.UY ? released : connected;
        end.UZ = r.UZ ? released : connected;
        end.RX = r.RX ? released : connected;
        end.RY = r.RY ? released : connected;
        end.RZ = r.RZ ? released : connected;
    }

    public IReadOnlyList<ReleaseData> GetReleases() => Call("get_releases", () =>
    {
        var byLabel = new Dictionary<string, List<int>>();
        foreach (var b in Items(Structure.Bars.GetAll()))
        {
            string? r = LabelName(b, "I_LT_BAR_RELEASE");
            if (r is null) continue;
            if (!byLabel.TryGetValue(r, out var l)) byLabel[r] = l = new List<int>();
            l.Add(I(b.Number));
        }
        var list = new List<ReleaseData>();
        foreach (var name in LabelNames("I_LT_BAR_RELEASE"))
        {
            dynamic d = Structure.Labels.Get(E(LT, "I_LT_BAR_RELEASE"), name).Data;
            list.Add(new ReleaseData(name, ReadEnd(d.StartNode), ReadEnd(d.EndNode),
                byLabel.TryGetValue(name, out var bars) ? bars : new List<int>()));
        }
        return (IReadOnlyList<ReleaseData>)list;
    });

    public void UpsertRelease(ReleaseData def) => Call("upsert_release", () =>
    {
        dynamic label = GetOrCreateLabel("I_LT_BAR_RELEASE", def.Name);
        dynamic d = label.Data;
        WriteEnd(d.StartNode, def.Start);
        WriteEnd(d.EndNode, def.End);
        Structure.Labels.Store(label);
    });

    // ---------------------------- Groupes ---------------------------------------------------------

    public IReadOnlyList<GroupData> GetGroups() => Call("get_groups", () =>
    {
        var list = new List<GroupData>();
        foreach (var (ot, label) in new[] { ("I_OT_NODE", "node"), ("I_OT_BAR", "bar"), ("I_OT_PANEL", "panel") })
        {
            var type = E(OT, ot);
            int count = Try<int>(() => I(Structure.Groups.GetCount(type)));
            for (int i = 1; i <= count; i++)
            {
                dynamic g = Structure.Groups.Get(type, i);
                list.Add(new GroupData(label, S(g.Name), S(g.SelList)));
            }
        }
        return (IReadOnlyList<GroupData>)list;
    });
}
