using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Core.Geometry;
using static RobotStructuralMCP.Core.Units.UnitService;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>Mise en forme des données pour ChatGPT : compacte, arrondie, unités explicites.</summary>
public static class Out
{
    public const double kN = 1e3;
    public const double MPa = 1e6;
    public const double mm = 1e-3;

    public static object Units(params (string Key, string Unit)[] units) => units.ToDictionary(u => u.Key, u => u.Unit);

    public static object Node(NodeData n) => new { id = n.Id, x = Round(n.X, 4), y = Round(n.Y, 4), z = Round(n.Z, 4), support = n.Support };

    public static object Bar(BarData b, IReadOnlyDictionary<int, NodeData>? nodes = null)
    {
        string? role = null;
        if (nodes is not null && nodes.TryGetValue(b.StartNode, out var a) && nodes.TryGetValue(b.EndNode, out var e))
            role = GeometryMath.BarRole(a.Point, e.Point);
        return new
        {
            id = b.Id, start_node = b.StartNode, end_node = b.EndNode, length = Round(b.Length, 4),
            gamma_deg = Round(b.GammaRad * 180 / Math.PI, 3), section = b.Section, material = b.Material, release = b.Release, role,
        };
    }

    public static object Panel(PanelData p) => new
    {
        id = p.Id,
        kind = p.Contour.Count >= 3 ? GeometryMath.Orientation(p.Contour) switch
        {
            "horizontal" => "slab", "vertical" => "wall", var o => o,
        } : "unknown",
        thickness_label = p.Thickness,
        thickness = p.ThicknessValue is { } t ? Round(t, 4) : (double?)null,
        material = p.Material,
        area = p.Contour.Count >= 3 ? Round(GeometryMath.Area(p.Contour), 3) : (double?)null,
        meshed = p.Meshed,
        finite_elements = p.FiniteElementCount,
        contour = p.Contour.Select(c => new[] { Round(c.X, 4), Round(c.Y, 4), Round(c.Z, 4) }),
    };

    public static object Material(MaterialData m) => new
    {
        name = m.Name, type = m.Type,
        e_mpa = Round(m.E / MPa, 1), nu = Round(m.Nu, 4), g_mpa = Round(m.G / MPa, 1),
        unit_weight_kn_m3 = Round(m.UnitWeight / kN, 3), thermal_expansion_per_degc = m.ThermalExpansion,
        yield_strength_mpa = m.YieldStrength is { } fy ? Round(fy / MPa, 1) : (double?)null,
        tensile_strength_mpa = m.TensileStrength is { } ft ? Round(ft / MPa, 1) : (double?)null,
    };

    public static object Section(SectionData s) => new
    {
        name = s.Name, shape = s.Shape, material = s.Material, is_concrete = s.IsConcrete,
        dimensions_m = s.Dimensions.ToDictionary(k => k.Key, k => Round(k.Value, 4)),
        properties_si = s.Properties.ToDictionary(k => k.Key, k => Round(k.Value, 10)),
    };

    public static object Dof(DofDefinition d) => d.State switch
    {
        DofState.Spring => new { state = "spring", stiffness = d.Stiffness },
        DofState.Fixed => "fixed",
        _ => (object)"free",
    };

    public static object Support(SupportData s) => new
    {
        name = s.Name, ux = Dof(s.UX), uy = Dof(s.UY), uz = Dof(s.UZ), rx = Dof(s.RX), ry = Dof(s.RY), rz = Dof(s.RZ),
        nodes = SelectionParser.Format(s.Nodes), node_count = s.Nodes.Count,
        spring_units = "translations: N/m ; rotations: Nm/rad",
    };

    public static object Release(ReleaseData r) => new
    {
        name = r.Name,
        start_released = Released(r.Start), end_released = Released(r.End),
        bars = SelectionParser.Format(r.Bars),
    };

    private static string[] Released(EndRelease e) => new[] { ("UX", e.UX), ("UY", e.UY), ("UZ", e.UZ), ("RX", e.RX), ("RY", e.RY), ("RZ", e.RZ) }
        .Where(x => x.Item2).Select(x => x.Item1).ToArray();

    public static object Load(LoadRecordData l) => new
    {
        case_id = l.CaseId, index = l.Index, kind = l.Kind, objects = l.Objects,
        values_si = l.Values.ToDictionary(k => k.Key, k => Round(k.Value, 6)),
        units_si = l.Kind switch
        {
            "nodal_force" => "FX..FZ: N ; CX..CZ: Nm",
            "bar_uniform" => "PX..PZ: N/m",
            "bar_point_force" => "FX..FZ: N ; X: relatif (REL=1) ou m",
            "panel_uniform" => "PX..PZ: N/m2",
            "bar_temperature" => "TX: degC",
            "self_weight" => "Z: coefficient (−1 = poids propre vers −Z)",
            _ => "SI",
        },
    };
}
