using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Units;
using Xunit;

namespace RobotStructuralMCP.Tests;

public class UnitServiceTests
{
    private readonly UnitService _u = new();

    [Theory]
    [InlineData(320, "mm", 0.32)]
    [InlineData(30, "cm", 0.30)]
    [InlineData(3.2, "m", 3.2)]
    public void Length_conversions(double v, string unit, double expected) =>
        Assert.Equal(expected, _u.ToSi(v, unit, Dimension.Length), 9);

    [Fact]
    public void Surface_load_kN_per_m2_to_SI() => Assert.Equal(2000, _u.ToSi(2, "kN/m²", Dimension.SurfaceLoad), 9);

    [Fact]
    public void Pascal_is_accepted_for_surface_loads_and_N_per_mm2_for_stresses()
    {
        Assert.Equal(1500, _u.ToSi(1.5, "kPa", Dimension.SurfaceLoad), 9);
        Assert.Equal(235e6, _u.ToSi(235, "N/mm2", Dimension.Stress), 3);
    }

    [Fact]
    public void Moment_units_with_separators() => Assert.Equal(12000, _u.ToSi(12, "kN.m", Dimension.Moment), 9);

    [Fact]
    public void Gigapascal_to_SI() => Assert.Equal(33e9, _u.ToSi(33, StressUnit.GPa), 3);

    [Fact]
    public void Unknown_unit_is_rejected()
    {
        var ex = Assert.Throws<RobotMcpException>(() => _u.ToSi(1, "furlong", Dimension.Length));
        Assert.Equal(ErrorCodes.UnitError, ex.Code);
    }

    [Fact]
    public void Dimension_mismatch_is_never_silent()
    {
        var ex = Assert.Throws<RobotMcpException>(() => _u.ToSi(10, "kN", Dimension.LinearLoad));
        Assert.Equal(ErrorCodes.UnitError, ex.Code);
    }

    [Fact]
    public void Missing_unit_is_rejected() =>
        Assert.Equal(ErrorCodes.UnitError, Assert.Throws<RobotMcpException>(() => _u.ToSi(1, "", Dimension.Force)).Code);

    [Fact]
    public void Parses_french_decimal_quantities()
    {
        Assert.Equal(3.2, _u.ParseToSi("3,20 m", Dimension.Length), 9);
        Assert.Equal(-2000, _u.ParseToSi("-2 kN/m2", Dimension.SurfaceLoad), 9);
        Assert.Throws<RobotMcpException>(() => _u.ParseQuantity("3.2"));
    }

    [Fact]
    public void Round_trip_from_SI() => Assert.Equal(25, _u.FromSi(25000, "kN/m3", Dimension.UnitWeight), 9);
}
