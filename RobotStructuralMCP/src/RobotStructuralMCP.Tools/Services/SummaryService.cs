using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Geometry;
using static RobotStructuralMCP.Core.Units.UnitService;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>Résumé du modèle (get_model_summary et ressource project://summary).</summary>
public sealed class SummaryService(IRobotGateway gateway, AnalysisTracker tracker)
{
    public object Build()
    {
        var info = gateway.GetProjectInfo();
        var nodes = gateway.GetNodes();
        var bars = gateway.GetBars();
        var panels = gateway.GetPanels();
        var byId = nodes.ToDictionary(n => n.Id);
        var roles = bars.Where(b => byId.ContainsKey(b.StartNode) && byId.ContainsKey(b.EndNode))
            .GroupBy(b => GeometryMath.BarRole(byId[b.StartNode].Point, byId[b.EndNode].Point))
            .ToDictionary(g => g.Key, g => g.Count());
        var cases = gateway.GetLoadCases();
        var supports = gateway.GetSupports();
        object? extent = nodes.Count == 0 ? null : new
        {
            x = new[] { Round(nodes.Min(n => n.X), 3), Round(nodes.Max(n => n.X), 3) },
            y = new[] { Round(nodes.Min(n => n.Y), 3), Round(nodes.Max(n => n.Y), 3) },
            z = new[] { Round(nodes.Min(n => n.Z), 3), Round(nodes.Max(n => n.Z), 3) },
        };
        return new
        {
            project = new { info.Name, path = info.FilePath, type = info.ProjectType, robot_version = info.RobotVersion, codes = info.Codes, notes = info.Notes },
            counts = new
            {
                nodes = nodes.Count, bars = bars.Count, panels = panels.Count,
                columns = roles.GetValueOrDefault("column"), beams = roles.GetValueOrDefault("beam"), inclined = roles.GetValueOrDefault("inclined"),
                slabs = panels.Count(p => p.Contour.Count >= 3 && GeometryMath.Orientation(p.Contour) == "horizontal"),
                walls = panels.Count(p => p.Contour.Count >= 3 && GeometryMath.Orientation(p.Contour) == "vertical"),
                supported_nodes = supports.Sum(s => s.Nodes.Count),
                load_cases = cases.Count(c => c.Kind == "simple"), combinations = cases.Count(c => c.Kind == "combination"),
            },
            extent_m = extent,
            levels_z_m = nodes.Select(n => Round(n.Z, 3)).Distinct().OrderBy(z => z).Take(50),
            sections = bars.GroupBy(b => b.Section ?? "(aucune)").Select(g => new { section = g.Key, bars = g.Count() }),
            materials = gateway.GetMaterials().Select(m => new { m.Name, m.Type }),
            thicknesses = gateway.GetThicknesses().Select(t => new { t.Name, thickness_m = t.Thickness, t.Material }),
            supports = supports.Select(s => new { s.Name, nodes = s.Nodes.Count }),
            load_cases = cases.Select(c => new { id = c.Id, c.Name, c.Nature, c.Kind, records = c.RecordCount }),
            results_available = info.ResultsAvailable,
            analysis = tracker.Current.State,
            units = new { coordinates = "m", thickness = "m" },
        };
    }
}
