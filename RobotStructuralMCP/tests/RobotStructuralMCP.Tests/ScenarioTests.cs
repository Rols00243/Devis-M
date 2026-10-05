using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Tools;
using Xunit;

namespace RobotStructuralMCP.Tests;

/// <summary>Scénarios de haut niveau, en simulation (résultats injectés : la simulation n'a pas de solveur).</summary>
public class ScenarioTests : IDisposable
{
    private readonly TestHost _h = new();

    public void Dispose() => _h.Dispose();

    [Fact]
    public async Task Rc_building_with_standard_loads_and_combinations()
    {
        var hl = _h.Tool<HighLevelTools>();
        (await Envelope.Of(hl.CreateRcBuilding(new double[] { 5, 5 }, new double[] { 4 }, new double[] { 3.2, 3.2 }, LengthUnit.m, "C30/37",
            30, 30, 25, 50, LengthUnit.cm, 15, LengthUnit.cm))).AssertSuccess();
        Assert.Equal(18, _h.Gateway.GetNodes().Count);               // 3 × 2 × 3 niveaux
        Assert.Equal(12 + 2 * (4 + 3), _h.Gateway.GetBars().Count);  // 12 poteaux + 7 poutres par niveau
        Assert.Equal(4, _h.Gateway.GetPanels().Count);               // 2 travées × 2 niveaux

        var loads = (await Envelope.Of(hl.ApplyStandardBuildingLoads(2, SurfaceLoadUnit.kN_per_m2, superimposed_dead_load: 1.5))).AssertSuccess();
        var cases = _h.Gateway.GetLoadCases();
        Assert.Equal(3, cases.Count);
        var q = _h.Gateway.GetLoads(cases.Single(c => c.Nature == "live").Id).Single();
        Assert.Equal(-2000, q.Values["PZ"], 9);

        var combos = _h.Tool<CombinationTools>();
        var g = cases.Where(c => c.Nature == "permanent").Select(c => c.Id).ToArray();
        var gen = (await Envelope.Of(combos.GenerateCombinations("EN1990", g, new[] { new VariableActionInput { CaseId = cases.Single(c => c.Nature == "live").Id, Psi0 = 0.7 } }))).AssertSuccess();
        Assert.Equal(2, gen.Data.GetProperty("count").GetInt32());

        var check = (await Envelope.Of(_h.Tool<AnalysisTools>().CheckModel())).AssertSuccess();
        Assert.True(check.Data.GetProperty("ready_for_analysis").GetBoolean(), check.ToString());
    }

    [Fact]
    public async Task Norm_is_never_assumed()
    {
        var env = await Envelope.Of(_h.Tool<CombinationTools>().GenerateCombinations("from_project", new[] { 1 }, Array.Empty<VariableActionInput>()));
        Assert.False(env.Success);
        var env2 = await Envelope.Of(_h.Tool<CombinationTools>().GenerateCombinations("BAEL", new[] { 1 }, Array.Empty<VariableActionInput>()));
        Assert.Equal("VALIDATION_FAILED", env2.FirstErrorCode);
    }

    [Fact]
    public async Task Check_model_flags_missing_supports_and_sections()
    {
        var geo = _h.Tool<GeometryTools>();
        (await Envelope.Of(geo.CreateNodes(new[] { new NodeInput { X = 0, Y = 0, Z = 0 }, new NodeInput { X = 5, Y = 0, Z = 0 }, new NodeInput { X = 9, Y = 9, Z = 9 } }, LengthUnit.m))).AssertSuccess();
        (await Envelope.Of(geo.CreateBar(1, 2))).AssertSuccess();
        var env = (await Envelope.Of(_h.Tool<AnalysisTools>().CheckModel())).AssertSuccess();
        Assert.False(env.Data.GetProperty("ready_for_analysis").GetBoolean());
        var categories = env.Data.GetProperty("issues").EnumerateArray().Select(i => i.GetProperty("category").GetString()).ToList();
        Assert.Contains("supports", categories);
        Assert.Contains("section", categories);
        Assert.Contains("connectivity", categories);
        var issue = env.Data.GetProperty("issues")[0];
        foreach (var field in new[] { "severity", "element_id", "category", "message", "recommended_action" })
            Assert.True(issue.TryGetProperty(field, out _) || field == "element_id", field);
    }

    [Fact]
    public async Task Analysis_is_never_reported_as_successful_without_solver()
    {
        var env = await Envelope.Of(_h.Tool<AnalysisTools>().RunAnalysis(5));
        Assert.False(env.Success);
        Assert.True(env.IsError);
        Assert.Equal("NOT_SUPPORTED_IN_SIMULATION", env.FirstErrorCode);
        var status = (await Envelope.Of(_h.Tool<AnalysisTools>().GetAnalysisStatus())).AssertSuccess();
        Assert.Equal("failed", status.Data.GetProperty("state").GetString());
    }

    private async Task<int> SeededFrame()
    {
        var hl = _h.Tool<HighLevelTools>();
        var sec = _h.Tool<SectionTools>();
        (await Envelope.Of(_h.Tool<MaterialTools>().CreateMaterial("S355", "steel", database_name: "S355"))).AssertSuccess();
        (await Envelope.Of(sec.CreateSection("T200", SectionShape.Tube, LengthUnit.mm, d: 200, t: 8, material: "S355"))).AssertSuccess();
        (await Envelope.Of(sec.CreateSection("T250", SectionShape.Tube, LengthUnit.mm, d: 250, t: 10, material: "S355"))).AssertSuccess();
        (await Envelope.Of(sec.CreateSection("T300", SectionShape.Tube, LengthUnit.mm, d: 300, t: 12, material: "S355"))).AssertSuccess();
        (await Envelope.Of(hl.Create3DFrame(new double[] { 6, 6 }, new double[] { 5 }, new double[] { 3.5 }, LengthUnit.m, "T200", "T200"))).AssertSuccess();
        (await Envelope.Of(_h.Tool<LoadTools>().CreateLoadCase("G", CaseNature.Permanent))).AssertSuccess();
        var r = _h.Gateway.Results;
        r.Available = true;
        foreach (var b in _h.Gateway.GetBars())
        {
            r.Forces[(b.Id, 1)] = new() { new BarForces(b.Id, 1, 0.5, 10e3, 0, 0, 0, b.Id * 1e3, 0) };
            r.SteelRatios[b.Id] = b.Id switch { 1 => 1.25, 2 => 0.95, _ => 0.4 };
        }
        return _h.Gateway.GetBars().Count;
    }

    [Fact]
    public async Task Finds_bar_with_maximum_bending_moment()
    {
        var count = await SeededFrame();
        var env = (await Envelope.Of(_h.Tool<HighLevelTools>().FindMaxBarForce(ForceComponent.MY, BarRoleFilter.Beam, top: 1))).AssertSuccess();
        var best = env.Data.GetProperty("ranking")[0];
        Assert.Equal(count, best.GetProperty("bar").GetInt32()); // le moment injecté croît avec le numéro, la dernière barre est une poutre
        Assert.Equal("kNm", env.Data.GetProperty("unit").GetString());
    }

    [Fact]
    public async Task Overstressed_members_proposal_then_partial_application()
    {
        await SeededFrame();
        var hl = _h.Tool<HighLevelTools>();
        var over = (await Envelope.Of(hl.FindOverstressedMembers(0.9))).AssertSuccess();
        var ids = over.Data.GetProperty("overstressed").EnumerateArray().Select(e => e.GetProperty("member").GetInt32()).ToList();
        Assert.Equal(new[] { 1, 2 }, ids);

        var prop = (await Envelope.Of(hl.OptimizeSections(new[] { "T200", "T250", "T300" }, 0.9, bar_ids: new[] { 1, 2, 3 }))).AssertSuccess();
        Assert.False(prop.Data.GetProperty("applied").GetBoolean());
        Assert.Equal("T200", _h.Gateway.GetBars(new[] { 1 })[0].Section); // rien n'est appliqué
        var proposalId = prop.Data.GetProperty("proposal_id").GetString()!;
        var proposed = prop.Data.GetProperty("proposals").EnumerateArray().Select(p => p.GetProperty("bar").GetInt32()).ToList();
        Assert.Contains(1, proposed);
        Assert.Contains(2, proposed);

        (await Envelope.Of(hl.ApplySectionProposals(proposalId, new[] { 1 }))).AssertSuccess();
        Assert.NotEqual("T200", _h.Gateway.GetBars(new[] { 1 })[0].Section);
        Assert.Equal("T200", _h.Gateway.GetBars(new[] { 2 })[0].Section);
    }

    [Fact]
    public async Task Rc_design_returns_explicit_limitation_with_available_data()
    {
        await SeededFrame();
        var env = await Envelope.Of(_h.Tool<DesignTools>().CheckRcColumn(new[] { 1 }));
        Assert.False(env.Success);
        Assert.Equal("NOT_SUPPORTED_BY_ROBOT_API", env.FirstErrorCode);
        Assert.True(env.Data.TryGetProperty("available_data", out _));
        Assert.True(env.Data.TryGetProperty("external_module_proposal", out _));
    }

    [Fact]
    public async Task Bar_force_results_are_in_kN_and_filterable()
    {
        await SeededFrame();
        var env = (await Envelope.Of(_h.Tool<ResultTools>().GetBarForces(bar_ids: new[] { 3 }, points: 3))).AssertSuccess();
        var rows = env.Data.GetProperty("rows").EnumerateArray().ToList();
        Assert.Equal(3, rows.Count);
        Assert.Equal(3, rows[0].GetProperty("my").GetDouble(), 9);
        Assert.Equal(10, rows[0].GetProperty("fx").GetDouble(), 9);
    }

    [Fact]
    public async Task Results_require_an_analysis()
    {
        var env = await Envelope.Of(_h.Tool<ResultTools>().GetBarForces());
        Assert.Equal("RESULTS_UNAVAILABLE", env.FirstErrorCode);
    }
}
