using System.Text.Json.Serialization;

namespace RobotStructuralMCP.Core.Units;

// Toutes les énumérations d'unités sont sérialisées par leur symbole (ex. "kN/m2"),
// ce qui produit un JSON Schema strict (enum) pour chaque paramètre d'unité.

[JsonConverter(typeof(JsonStringEnumConverter<LengthUnit>))]
public enum LengthUnit
{
    [JsonStringEnumMemberName("m")] m,
    [JsonStringEnumMemberName("cm")] cm,
    [JsonStringEnumMemberName("mm")] mm,
}

[JsonConverter(typeof(JsonStringEnumConverter<ForceUnit>))]
public enum ForceUnit
{
    [JsonStringEnumMemberName("N")] N,
    [JsonStringEnumMemberName("kN")] kN,
    [JsonStringEnumMemberName("MN")] MN,
}

[JsonConverter(typeof(JsonStringEnumConverter<MomentUnit>))]
public enum MomentUnit
{
    [JsonStringEnumMemberName("Nm")] Nm,
    [JsonStringEnumMemberName("kNm")] kNm,
    [JsonStringEnumMemberName("MNm")] MNm,
}

[JsonConverter(typeof(JsonStringEnumConverter<LinearLoadUnit>))]
public enum LinearLoadUnit
{
    [JsonStringEnumMemberName("N/m")] N_per_m,
    [JsonStringEnumMemberName("kN/m")] kN_per_m,
}

[JsonConverter(typeof(JsonStringEnumConverter<SurfaceLoadUnit>))]
public enum SurfaceLoadUnit
{
    [JsonStringEnumMemberName("N/m2")] N_per_m2,
    [JsonStringEnumMemberName("kN/m2")] kN_per_m2,
    [JsonStringEnumMemberName("Pa")] Pa,
    [JsonStringEnumMemberName("kPa")] kPa,
}

[JsonConverter(typeof(JsonStringEnumConverter<StressUnit>))]
public enum StressUnit
{
    [JsonStringEnumMemberName("Pa")] Pa,
    [JsonStringEnumMemberName("kPa")] kPa,
    [JsonStringEnumMemberName("MPa")] MPa,
    [JsonStringEnumMemberName("GPa")] GPa,
}

[JsonConverter(typeof(JsonStringEnumConverter<UnitWeightUnit>))]
public enum UnitWeightUnit
{
    [JsonStringEnumMemberName("N/m3")] N_per_m3,
    [JsonStringEnumMemberName("kN/m3")] kN_per_m3,
}

[JsonConverter(typeof(JsonStringEnumConverter<SpringUnit>))]
public enum SpringUnit
{
    [JsonStringEnumMemberName("N/m")] N_per_m,
    [JsonStringEnumMemberName("kN/m")] kN_per_m,
    [JsonStringEnumMemberName("MN/m")] MN_per_m,
}

[JsonConverter(typeof(JsonStringEnumConverter<AngleUnit>))]
public enum AngleUnit
{
    [JsonStringEnumMemberName("deg")] deg,
    [JsonStringEnumMemberName("rad")] rad,
}

/// <summary>Grandeurs physiques gérées par le <see cref="UnitService"/>.</summary>
public enum Dimension
{
    Length,
    Force,
    Moment,
    LinearLoad,
    SurfaceLoad,
    Stress,
    UnitWeight,
    Spring,
    RotationalSpring,
    Angle,
    Temperature,
    Dimensionless,
}
