using System.Text.Json;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Tools;
using Xunit;

namespace RobotStructuralMCP.Tests;

public class ModelToolTests : IDisposable
{
    private readonly TestHost _h = new();

    public void Dispose() => _h.Dispose();

    private async Task BuildPortal()
    {
        var mat = _h.Tool<MaterialTools>();
        var sec = _h.Tool<SectionTools>();
        var geo = _h.Tool<GeometryTools>();
        (await Envelope.Of(mat.CreateMaterial("C30/37", "concrete", database_name: "C30/37"))).AssertSuccess();
        (await Envelope.Of(sec.CreateSection("POT 30x30", SectionShape.ConcreteColumnRect, LengthUnit.cm, b: 30, h: 30, material: "C30/37"))).AssertSuccess();
        (await Envelope.Of(sec.CreateSection("POU 25x50", SectionShape.ConcreteBeamRect, LengthUnit.cm, b: 25, h: 50, material: "C30/37"))).AssertSuccess();
        var nodes = new[]
        {
            new NodeInput { X = 0, Y = 0, Z = 0 }, new NodeInput { X = 500, Y = 0, Z = 0 }, new NodeInput { X = 500, Y = 400, Z = 0 }, new NodeInput { X = 0, Y = 400, Z = 0 },
            new NodeInput { X = 0, Y = 0, Z = 320 }, new NodeInput { X = 500, Y = 0, Z = 320 }, new NodeInput { X = 500, Y = 400, Z = 320 }, new NodeInput { X = 0, Y = 400, Z = 320 },
        };
        (await Envelope.Of(geo.CreateNodes(nodes, LengthUnit.cm))).AssertSuccess();
        var bars = Enumerable.Range(1, 4).Select(i => new BarInput { StartNode = i, EndNode = i + 4, Section = "POT 30x30", Material = "C30/37" })
            .Concat(new[] { (5, 6), (6, 7), (7, 8), (8, 5) }.Select(p => new BarInput { StartNode = p.Item1, EndNode = p.Item2, Section = "POU 25x50" }))
            .ToArray();
        (await Envelope.Of(geo.CreateBars(bars))).AssertSuccess();
    }

    [Fact]
    public async Task Creates_columns_in_centimetres_converted_to_metres()
    {
        await BuildPortal();
        var nodes = _h.Gateway.GetNodes();
        Assert.Equal(3.2, nodes.Single(n => n.Id == 5).Z, 9);
        var bar = _h.Gateway.GetBars(new[] { 1 })[0];
        Assert.Equal(3.2, bar.Length, 9);
        Assert.Equal("POT 30x30", bar.Section);
        var section = _h.Gateway.GetSections().Single(s => s.Name == "POT 30x30");
        Assert.Equal(0.09, section.Properties["AX"], 9);
    }

    [Fact]
    public async Task Slab_5x4_has_area_20_m2_and_derived_thickness()
    {
        await BuildPortal();
        var geo = _h.Tool<GeometryTools>();
        var contour = new[] { new PointInput { X = 0, Y = 0, Z = 3.2 }, new PointInput { X = 5, Y = 0, Z = 3.2 }, new PointInput { X = 5, Y = 4, Z = 3.2 }, new PointInput { X = 0, Y = 4, Z = 3.2 } };
        var env = (await Envelope.Of(geo.CreateSlab(contour, LengthUnit.m, 15, LengthUnit.cm, "C30/37"))).AssertSuccess();
        var panel = env.Data.GetProperty("panel");
        Assert.Equal(20, panel.GetProperty("area").GetDouble(), 6);
        Assert.Equal("slab", panel.GetProperty("kind").GetString());
        Assert.Equal(0.15, panel.GetProperty("thickness").GetDouble(), 9);
    }

    [Fact]
    public async Task Slab_must_be_horizontal_and_planar()
    {
        var geo = _h.Tool<GeometryTools>();
        (await Envelope.Of(_h.Tool<MaterialTools>().CreateMaterial("C30/37", "concrete", database_name: "C30/37"))).AssertSuccess();
        var vertical = new[] { new PointInput { X = 0, Y = 0, Z = 0 }, new PointInput { X = 5, Y = 0, Z = 0 }, new PointInput { X = 5, Y = 0, Z = 3 }, new PointInput { X = 0, Y = 0, Z = 3 } };
        var env = await Envelope.Of(geo.CreateSlab(vertical, LengthUnit.m, 20, LengthUnit.cm, "C30/37"));
        Assert.False(env.Success);
        Assert.Equal("VALIDATION_FAILED", env.FirstErrorCode);
        var warped = new[] { new PointInput { X = 0, Y = 0, Z = 0 }, new PointInput { X = 5, Y = 0, Z = 0 }, new PointInput { X = 5, Y = 4, Z = 0.2 }, new PointInput { X = 0, Y = 4, Z = 0 } };
        Assert.False((await Envelope.Of(geo.CreatePanel(warped, LengthUnit.m, 20, LengthUnit.cm, "C30/37"))).Success);
    }

    [Fact]
    public async Task Bar_validation_reports_all_errors_before_writing()
    {
        await BuildPortal();
        var before = _h.Gateway.GetBars().Count;
        var env = await Envelope.Of(_h.Tool<GeometryTools>().CreateBars(new[]
        {
            new BarInput { StartNode = 1, EndNode = 999 },
            new BarInput { StartNode = 2, EndNode = 2 },
            new BarInput { StartNode = 1, EndNode = 6, Section = "INCONNUE" },
        }));
        Assert.False(env.Success);
        Assert.True(env.Root.GetProperty("errors").GetArrayLength() >= 2, env.ToString());
        Assert.Equal(before, _h.Gateway.GetBars().Count);
    }

    [Fact]
    public async Task Coincident_nodes_are_reused_or_reported()
    {
        var geo = _h.Tool<GeometryTools>();
        (await Envelope.Of(geo.CreateNode(1, 1, 0, LengthUnit.m))).AssertSuccess();
        var warn = (await Envelope.Of(geo.CreateNodes(new[] { new NodeInput { X = 1000.4, Y = 1000, Z = 0 } }, LengthUnit.mm))).AssertSuccess();
        Assert.Contains("COINCIDENT_NODE", warn.WarningCodes);
        var reuse = (await Envelope.Of(geo.CreateNodes(new[] { new NodeInput { X = 1, Y = 1, Z = 0 } }, LengthUnit.m, reuse_coincident: true))).AssertSuccess();
        Assert.Equal(1, reuse.Data.GetProperty("nodes")[0].GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task Divide_bar_keeps_number_and_section()
    {
        await BuildPortal();
        var env = (await Envelope.Of(_h.Tool<GeometryTools>().DivideBar(5, parts: 2))).AssertSuccess();
        var bars = _h.Gateway.GetBars();
        Assert.Equal(9, bars.Count);
        Assert.Equal(2.5, bars.Single(b => b.Id == 5).Length, 9);
        Assert.All(bars.Where(b => b.Id >= 9), b => Assert.Equal("POU 25x50", b.Section));
    }

    [Fact]
    public async Task Copy_storey_upwards_copies_bars_and_labels()
    {
        await BuildPortal();
        var env = (await Envelope.Of(_h.Tool<GeometryTools>().CopyElements(0, 0, 3.2, LengthUnit.m, bar_ids: Enumerable.Range(1, 8).ToArray()))).AssertSuccess();
        Assert.Equal(16, _h.Gateway.GetBars().Count);
        Assert.Equal(12, _h.Gateway.GetNodes().Count); // les 4 nœuds à 3,20 m sont réutilisés
        Assert.Equal(8, _h.Gateway.GetBars().Count(b => b.Section is not null && b.Id > 8));
    }

    [Fact]
    public async Task Units_are_mandatory_and_typed_in_load_inputs()
    {
        await BuildPortal();
        var loads = _h.Tool<LoadTools>();
        (await Envelope.Of(loads.CreateLoadCase("Q", CaseNature.Live))).AssertSuccess();
        var env = await Envelope.Of(loads.ApplyLoads(new[] { new LoadInput { Kind = LoadKind.BarUniform, CaseId = 1, Objects = new[] { 5 }, Z = -10, Unit = "kN" } }));
        Assert.False(env.Success);
        Assert.Equal("UNIT_ERROR", env.FirstErrorCode);
        (await Envelope.Of(loads.AddBarUniformLoad(1, new[] { 5, 6 }, LinearLoadUnit.kN_per_m, pz: -10))).AssertSuccess();
        var stored = _h.Gateway.GetLoads(1).Single();
        Assert.Equal(-10000, stored.Values["PZ"], 9);
    }

    [Fact]
    public async Task Load_on_missing_bar_is_rejected()
    {
        await BuildPortal();
        var loads = _h.Tool<LoadTools>();
        (await Envelope.Of(loads.CreateLoadCase("G", CaseNature.Permanent))).AssertSuccess();
        var env = await Envelope.Of(loads.AddBarUniformLoad(1, new[] { 404 }, LinearLoadUnit.kN_per_m, pz: -5));
        Assert.Equal("NOT_FOUND", env.FirstErrorCode);
    }
}
