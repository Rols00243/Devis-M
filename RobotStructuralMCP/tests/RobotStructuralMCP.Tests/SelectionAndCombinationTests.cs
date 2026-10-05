using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Tools.Services;
using Xunit;

namespace RobotStructuralMCP.Tests;

public class SelectionParserTests
{
    [Theory]
    [InlineData("1 2 3", new[] { 1, 2, 3 })]
    [InlineData("1to4", new[] { 1, 2, 3, 4 })]
    [InlineData("1 to 4", new[] { 1, 2, 3, 4 })]
    [InlineData("10to20by5 3", new[] { 3, 10, 15, 20 })]
    [InlineData("12, 16, 24", new[] { 12, 16, 24 })]
    public void Parses_robot_selection_syntax(string text, int[] expected) => Assert.Equal(expected, SelectionParser.Parse(text));

    [Fact]
    public void Rejects_invalid_tokens() => Assert.Throws<ValidationException>(() => SelectionParser.Parse("1 abc"));

    [Fact]
    public void Rejects_reversed_ranges() => Assert.Throws<ValidationException>(() => SelectionParser.Parse("10to2"));
}

public class CombinationGeneratorTests
{
    private static readonly CombinationGenerator.En1990Factors F = new(1.35, 1.0, 1.5);

    [Fact]
    public void Uls_6_10_with_two_variable_actions()
    {
        var combos = CombinationGenerator.En1990(new[] { 1 }, new[] { new VariableAction(2, 0.7, 0.5, 0.3), new VariableAction(3, 0.5, 0.2, 0) },
            F, uls: true, slsCharacteristic: false, slsFrequent: false, slsQuasiPermanent: false, favourablePermanent: false);
        Assert.Equal(2, combos.Count);
        var leadQ2 = combos[0].Factors.ToDictionary(f => f.CaseId, f => f.Factor);
        Assert.Equal(1.35, leadQ2[1]);
        Assert.Equal(1.5, leadQ2[2]);
        Assert.Equal(0.75, leadQ2[3], 9); // 1.5 × ψ0 = 1.5 × 0.5
        var leadQ3 = combos[1].Factors.ToDictionary(f => f.CaseId, f => f.Factor);
        Assert.Equal(1.05, leadQ3[2], 9); // 1.5 × 0.7
        Assert.All(combos, c => Assert.Equal(CombinationType.Uls, c.Type));
    }

    [Fact]
    public void Sls_quasi_permanent_drops_zero_factors()
    {
        var combos = CombinationGenerator.En1990(new[] { 1 }, new[] { new VariableAction(2, 0.7, 0.5, 0.3), new VariableAction(3, 0.5, 0.2, 0) },
            F, false, false, false, true, false);
        var qp = Assert.Single(combos);
        Assert.Equal(new[] { 1, 2 }, qp.Factors.Select(f => f.CaseId).OrderBy(i => i));
        Assert.Equal(0.3, qp.Factors.Single(f => f.CaseId == 2).Factor, 9);
    }

    [Fact]
    public void Favourable_permanent_doubles_uls_set()
    {
        var combos = CombinationGenerator.En1990(new[] { 1 }, new[] { new VariableAction(2, 0.7, null, null) }, F, true, false, false, false, true);
        Assert.Equal(2, combos.Count);
        Assert.Contains(combos, c => c.Factors.Any(f => f.CaseId == 1 && f.Factor == 1.0));
    }
}
