using System.Text.Json.Serialization;
using RobotStructuralMCP.Core.Geometry;

namespace RobotStructuralMCP.Core.Models;

// ------------------------------------------------------------------------------------------
// Types échangés entre les tools et la passerelle Robot (IRobotGateway).
// CONVENTION : toutes les valeurs numériques de ces types sont en unités SI
// (m, N, N·m, Pa, N/m, N/m², N/m³, rad, °C). La conversion pour l'affichage est faite
// par les tools via UnitService.
// ------------------------------------------------------------------------------------------

public enum ElementKind { Node, Bar, Panel }

[JsonConverter(typeof(JsonStringEnumConverter<DofState>))]
public enum DofState
{
    [JsonStringEnumMemberName("free")] Free,
    [JsonStringEnumMemberName("fixed")] Fixed,
    [JsonStringEnumMemberName("spring")] Spring,
}

[JsonConverter(typeof(JsonStringEnumConverter<CaseNature>))]
public enum CaseNature
{
    [JsonStringEnumMemberName("permanent")] Permanent,
    [JsonStringEnumMemberName("live")] Live,
    [JsonStringEnumMemberName("wind")] Wind,
    [JsonStringEnumMemberName("snow")] Snow,
    [JsonStringEnumMemberName("temperature")] Temperature,
    [JsonStringEnumMemberName("accidental")] Accidental,
    [JsonStringEnumMemberName("seismic")] Seismic,
}

[JsonConverter(typeof(JsonStringEnumConverter<AnalysisKind>))]
public enum AnalysisKind
{
    [JsonStringEnumMemberName("static_linear")] StaticLinear,
    [JsonStringEnumMemberName("static_nonlinear")] StaticNonlinear,
    [JsonStringEnumMemberName("modal")] Modal,
    [JsonStringEnumMemberName("buckling")] Buckling,
}

[JsonConverter(typeof(JsonStringEnumConverter<CombinationType>))]
public enum CombinationType
{
    [JsonStringEnumMemberName("ULS")] Uls,
    [JsonStringEnumMemberName("SLS")] Sls,
    [JsonStringEnumMemberName("ACC")] Accidental,
}

[JsonConverter(typeof(JsonStringEnumConverter<SectionShape>))]
public enum SectionShape
{
    /// <summary>Poutre béton rectangulaire (b × h).</summary>
    [JsonStringEnumMemberName("concrete_beam_rect")] ConcreteBeamRect,
    /// <summary>Poteau béton rectangulaire ou carré (b × h).</summary>
    [JsonStringEnumMemberName("concrete_column_rect")] ConcreteColumnRect,
    /// <summary>Poteau béton circulaire (diamètre d).</summary>
    [JsonStringEnumMemberName("concrete_column_circular")] ConcreteColumnCircular,
    /// <summary>Profil acier lu dans la base de profilés Robot (ex. « HEA 200 », « IPE 300 »).</summary>
    [JsonStringEnumMemberName("steel_database")] SteelDatabase,
    /// <summary>Tube circulaire paramétré (diamètre d, épaisseur t).</summary>
    [JsonStringEnumMemberName("tube")] Tube,
    /// <summary>Tube rectangulaire paramétré (b × h, épaisseur t).</summary>
    [JsonStringEnumMemberName("rect_tube")] RectTube,
}

[JsonConverter(typeof(JsonStringEnumConverter<LoadKind>))]
public enum LoadKind
{
    [JsonStringEnumMemberName("self_weight")] SelfWeight,
    [JsonStringEnumMemberName("nodal_force")] NodalForce,
    [JsonStringEnumMemberName("bar_uniform")] BarUniform,
    [JsonStringEnumMemberName("bar_point_force")] BarPointForce,
    [JsonStringEnumMemberName("panel_uniform")] PanelUniform,
    [JsonStringEnumMemberName("bar_temperature")] BarTemperature,
}

public sealed record NodeData(int Id, double X, double Y, double Z, string? Support)
{
    public Point3 Point => new(X, Y, Z);
}

public sealed record BarData(int Id, int StartNode, int EndNode, double Length, double GammaRad,
    string? Section, string? Material, string? Release);

public sealed record PanelData(int Id, IReadOnlyList<Point3> Contour, string? Thickness, string? Material,
    double? ThicknessValue, bool Meshed, int? FiniteElementCount = null);

public sealed record MaterialData(string Name, string Type, double E, double Nu, double G, double UnitWeight,
    double ThermalExpansion, double? YieldStrength, double? TensileStrength);

public sealed record MaterialDefinition(string Name, string Type, string? DatabaseName,
    double? E, double? Nu, double? G, double? UnitWeight, double? ThermalExpansion, double? YieldStrength);

public sealed record SectionData(string Name, string Shape, string? Material, bool IsConcrete,
    IReadOnlyDictionary<string, double> Dimensions, IReadOnlyDictionary<string, double> Properties);

public sealed record SectionDefinition(string Name, SectionShape Shape, double? B, double? H, double? D, double? T,
    string? DatabaseProfile, string? Material);

public sealed record ThicknessData(string Name, double Thickness, string? Material);

public sealed record DofDefinition(DofState State, double? Stiffness = null)
{
    public static readonly DofDefinition Fixed = new(DofState.Fixed);
    public static readonly DofDefinition Free = new(DofState.Free);
}

public sealed record SupportData(string Name, DofDefinition UX, DofDefinition UY, DofDefinition UZ,
    DofDefinition RX, DofDefinition RY, DofDefinition RZ, IReadOnlyList<int> Nodes)
{
    public IEnumerable<(string Dof, DofDefinition Def)> Dofs() => new[]
    {
        ("UX", UX), ("UY", UY), ("UZ", UZ), ("RX", RX), ("RY", RY), ("RZ", RZ),
    };
}

/// <summary>Relâchement d'une extrémité : true = degré de liberté relâché (libéré).</summary>
public sealed record EndRelease(bool UX, bool UY, bool UZ, bool RX, bool RY, bool RZ)
{
    public static readonly EndRelease None = new(false, false, false, false, false, false);
}

public sealed record ReleaseData(string Name, EndRelease Start, EndRelease End, IReadOnlyList<int> Bars);

public sealed record LoadCaseData(int Id, string Name, string Nature, string Kind, string? AnalysisType, int RecordCount);

public sealed record CaseFactor(int CaseId, double Factor);

public sealed record CombinationData(int Id, string Name, string Type, IReadOnlyList<CaseFactor> Factors);

/// <summary>
/// Définition d'une charge (SI). Signification des composantes selon <see cref="Kind"/> :
/// self_weight : Factor (coefficient, direction −Z) ;
/// nodal_force : FX..FZ (N), MX..MZ (N·m) ;
/// bar_uniform : FX..FZ = PX..PZ (N/m) ;
/// bar_point_force : FX..FZ (N), Position (relative 0..1 si Relative, sinon m) ;
/// panel_uniform : FX..FZ = PX..PZ (N/m²) ;
/// bar_temperature : Temperature (°C, variation uniforme), FY/FZ inutilisés.
/// </summary>
public sealed record LoadDefinition(LoadKind Kind, IReadOnlyList<int> Objects,
    double FX = 0, double FY = 0, double FZ = 0, double MX = 0, double MY = 0, double MZ = 0,
    double? Position = null, bool Relative = true, bool Local = false, double Factor = 1, double Temperature = 0);

public sealed record LoadRecordData(int CaseId, int Index, string Kind, string Objects, IReadOnlyDictionary<string, double> Values);

public sealed record GroupData(string ObjectType, string Name, string Selection);

public sealed record MeshSettingsData(int? PanelId, double? ElementSize, string? Method, string? GenerationType);

public sealed record MeshStatistics(int FiniteElementCount, int NodeCount, int PanelCount, int MeshedPanelCount);

public sealed record AnalysisRunResult(bool Success, int? ReturnCode, bool ResultsAvailable, IReadOnlyList<string> Messages);

public sealed record NodeDisplacement(int Node, int Case, double UX, double UY, double UZ, double RX, double RY, double RZ);

public sealed record NodeReaction(int Node, int Case, double FX, double FY, double FZ, double MX, double MY, double MZ);

public sealed record BarForces(int Bar, int Case, double Position, double FX, double FY, double FZ, double MX, double MY, double MZ);

public sealed record BarDisplacement(int Bar, int Case, double Position, double UX, double UY, double UZ, double RX, double RY, double RZ);

public sealed record BarDeflection(int Bar, int Case, double Position, double UX, double UY, double UZ);

public sealed record BarStress(int Bar, int Case, double Position, IReadOnlyDictionary<string, double> Values);

public sealed record PanelResultRow(int Panel, int Case, int? Element, int? Node, IReadOnlyDictionary<string, double> Values);

public sealed record SteelMemberCheck(int Member, string? Section, double? Ratio, string? GoverningCase, string Status,
    IReadOnlyDictionary<string, string>? Extra = null);

public sealed record ProjectInfo(string Name, string? FilePath, string ProjectType, bool IsActive, bool ResultsAvailable,
    string? RobotVersion, IReadOnlyDictionary<string, string> Codes, IReadOnlyList<string> Notes);

public sealed record RobotStatus(string Backend, bool PlatformSupported, bool ProcessRunning, int? ProcessId, bool Connected,
    bool HasActiveProject, string? RobotVersion, string? ProjectName, string? ProjectPath, string Message);

public sealed record ApiMemberCheck(string Interface, string Member, bool Found, string? Signature = null);

public sealed record ApiVerificationReport(string Source, int Checked, int MissingCount,
    IReadOnlyList<ApiMemberCheck> Missing, IReadOnlyList<ApiMemberCheck> Found, IReadOnlyList<string> MissingEnumValues);
