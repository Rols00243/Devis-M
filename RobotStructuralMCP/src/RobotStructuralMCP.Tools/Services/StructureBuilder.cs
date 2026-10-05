using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Tools.Infrastructure;

namespace RobotStructuralMCP.Tools.Services;

public sealed record FrameResult(IReadOnlyList<int> Nodes, IReadOnlyList<int> Columns, IReadOnlyList<int> BeamsX, IReadOnlyList<int> BeamsY,
    IReadOnlyList<int> BaseNodes, IReadOnlyList<double> LevelsZ, IReadOnlyList<double> XCoords, IReadOnlyList<double> YCoords);

/// <summary>Génération paramétrique de structures (portiques 3D, grilles, bâtiments BA). Toutes les longueurs en m.</summary>
public sealed class StructureBuilder(IRobotGateway gateway, ModelService model)
{
    public static IReadOnlyList<double> Cumulative(double origin, IReadOnlyList<double> spans)
    {
        var list = new List<double> { origin };
        foreach (var s in spans) list.Add(list[^1] + s);
        return list;
    }

    public static void ValidateSpans(Validator v, IReadOnlyList<double> spans, string name, bool allowEmpty = false)
    {
        if (!allowEmpty) v.NotEmpty(spans, name);
        foreach (var s in spans) v.Range(s, 0.1, 200, name, "m");
        v.Require(spans.Count <= 100, $"{name} : 100 travées maximum.");
    }

    /// <summary>Appui standard : « fixed » (encastrement) ou « pinned » (rotule), créé si absent ; sinon nom d'un appui existant.</summary>
    public string EnsureSupport(string support, OperationContext ctx)
    {
        var existing = gateway.GetSupports();
        if (existing.Any(s => string.Equals(s.Name, support, StringComparison.OrdinalIgnoreCase))) return support;
        SupportData def = support.ToLowerInvariant() switch
        {
            "fixed" => new SupportData("MCP_Encastrement", DofDefinition.Fixed, DofDefinition.Fixed, DofDefinition.Fixed, DofDefinition.Fixed, DofDefinition.Fixed, DofDefinition.Fixed, Array.Empty<int>()),
            "pinned" => new SupportData("MCP_Rotule", DofDefinition.Fixed, DofDefinition.Fixed, DofDefinition.Fixed, DofDefinition.Free, DofDefinition.Free, DofDefinition.Free, Array.Empty<int>()),
            _ => throw new RobotMcpException(ErrorCodes.NotFound, $"Appui « {support} » inexistant : utilisez « fixed », « pinned » ou un appui créé par create_support."),
        };
        if (!existing.Any(s => s.Name == def.Name))
        {
            gateway.UpsertSupport(def);
            ctx.Touch("support", def.Name);
        }
        return def.Name;
    }

    public FrameResult BuildFrame(Point3 origin, IReadOnlyList<double> xSpans, IReadOnlyList<double> ySpans, IReadOnlyList<double> storeyHeights,
        string? columnSection, string? beamSection, string support, bool beamsX, bool beamsY, OperationContext ctx, int maxBatch)
    {
        var v = new Validator();
        ValidateSpans(v, xSpans, "x_spans", allowEmpty: true);
        ValidateSpans(v, ySpans, "y_spans", allowEmpty: true);
        ValidateSpans(v, storeyHeights, "storey_heights");
        v.ThrowIfAny();
        var xs = Cumulative(origin.X, xSpans);
        var ys = Cumulative(origin.Y, ySpans);
        var zs = Cumulative(origin.Z, storeyHeights);
        long count = (long)xs.Count * ys.Count * zs.Count;
        if (count > maxBatch) throw new ValidationException($"Structure trop grande ({count} nœuds > {maxBatch}).");

        var supportName = EnsureSupport(support, ctx);
        var newNodes = new List<NewNode>();
        foreach (var z in zs) foreach (var y in ys) foreach (var x in xs) newNodes.Add(new NewNode(null, new Point3(x, y, z)));
        var nodes = model.CreateNodes(newNodes, ctx, maxBatch, reuseCoincident: true);
        int Id(int ix, int iy, int iz) => nodes[(iz * ys.Count + iy) * xs.Count + ix].Id;

        var columns = new List<NewBar>();
        var bx = new List<NewBar>();
        var by = new List<NewBar>();
        for (int iz = 0; iz < zs.Count; iz++)
            for (int iy = 0; iy < ys.Count; iy++)
                for (int ix = 0; ix < xs.Count; ix++)
                {
                    if (iz > 0) columns.Add(new NewBar(null, Id(ix, iy, iz - 1), Id(ix, iy, iz), columnSection));
                    if (iz == 0) continue;
                    if (beamsX && ix + 1 < xs.Count) bx.Add(new NewBar(null, Id(ix, iy, iz), Id(ix + 1, iy, iz), beamSection));
                    if (beamsY && iy + 1 < ys.Count) by.Add(new NewBar(null, Id(ix, iy, iz), Id(ix, iy + 1, iz), beamSection));
                }
        var createdCols = model.CreateBars(columns, ctx, maxBatch).Select(b => b.Id).ToList();
        var createdX = bx.Count > 0 ? model.CreateBars(bx, ctx, maxBatch).Select(b => b.Id).ToList() : new List<int>();
        var createdY = by.Count > 0 ? model.CreateBars(by, ctx, maxBatch).Select(b => b.Id).ToList() : new List<int>();
        var baseNodes = Enumerable.Range(0, ys.Count).SelectMany(iy => Enumerable.Range(0, xs.Count).Select(ix => Id(ix, iy, 0))).ToList();
        gateway.AssignSupport(baseNodes, supportName);
        return new FrameResult(nodes.Select(n => n.Id).Distinct().ToList(), createdCols, createdX, createdY, baseNodes, zs, xs, ys);
    }

    public IReadOnlyList<int> SlabsPerBay(FrameResult frame, string thickness, OperationContext ctx, bool skipBase = true)
    {
        var ids = new List<int>();
        foreach (var z in frame.LevelsZ.Skip(skipBase ? 1 : 0))
            for (int iy = 0; iy + 1 < frame.YCoords.Count; iy++)
                for (int ix = 0; ix + 1 < frame.XCoords.Count; ix++)
                {
                    double x0 = frame.XCoords[ix], x1 = frame.XCoords[ix + 1], y0 = frame.YCoords[iy], y1 = frame.YCoords[iy + 1];
                    var contour = new[] { new Point3(x0, y0, z), new Point3(x1, y0, z), new Point3(x1, y1, z), new Point3(x0, y1, z) };
                    ids.Add(model.CreatePanel(null, contour, thickness, "horizontal", ctx).Id);
                }
        return ids;
    }
}
