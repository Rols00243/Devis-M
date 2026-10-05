using System.ComponentModel;
using System.Text.Json.Serialization;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.Tools.Infrastructure;

// Types d'entrée des tools. Les coordonnées et dimensions sont exprimées dans l'unité passée
// explicitement par l'appelant (paramètre *_unit obligatoire du tool).

public sealed class NodeInput
{
    [Description("Numéro du nœud (entier > 0). Omis : numéro libre attribué par Robot.")]
    public int? Id { get; init; }
    [Description("Coordonnée X globale.")] public required double X { get; init; }
    [Description("Coordonnée Y globale.")] public required double Y { get; init; }
    [Description("Coordonnée Z globale (verticale).")] public required double Z { get; init; }
}

public sealed class BarInput
{
    [Description("Numéro de la barre (entier > 0). Omis : numéro libre.")]
    public int? Id { get; init; }
    [Description("Nœud origine (doit exister).")] public required int StartNode { get; init; }
    [Description("Nœud extrémité (doit exister, différent de l'origine).")] public required int EndNode { get; init; }
    [Description("Nom d'une section existante à affecter (optionnel).")] public string? Section { get; init; }
    [Description("Nom d'un matériau existant à affecter (optionnel).")] public string? Material { get; init; }
}

public sealed class PointInput
{
    [Description("X")] public required double X { get; init; }
    [Description("Y")] public required double Y { get; init; }
    [Description("Z")] public required double Z { get; init; }
}

public sealed class SectionAssignment
{
    [Description("Nom de la section existante.")] public required string Section { get; init; }
    [Description("Barres auxquelles affecter la section.")] public required int[] BarIds { get; init; }
}

[JsonConverter(typeof(JsonStringEnumConverter<DofInput>))]
public enum DofInput
{
    [JsonStringEnumMemberName("free")] Free,
    [JsonStringEnumMemberName("fixed")] Fixed,
    [JsonStringEnumMemberName("spring")] Spring,
}

[JsonConverter(typeof(JsonStringEnumConverter<ElementKindInput>))]
public enum ElementKindInput
{
    [JsonStringEnumMemberName("node")] Node,
    [JsonStringEnumMemberName("bar")] Bar,
    [JsonStringEnumMemberName("panel")] Panel,
}

[JsonConverter(typeof(JsonStringEnumConverter<BarRoleFilter>))]
public enum BarRoleFilter
{
    [JsonStringEnumMemberName("any")] Any,
    [JsonStringEnumMemberName("beam")] Beam,
    [JsonStringEnumMemberName("column")] Column,
    [JsonStringEnumMemberName("inclined")] Inclined,
}

[JsonConverter(typeof(JsonStringEnumConverter<ForceComponent>))]
public enum ForceComponent
{
    [JsonStringEnumMemberName("FX")] FX,
    [JsonStringEnumMemberName("FY")] FY,
    [JsonStringEnumMemberName("FZ")] FZ,
    [JsonStringEnumMemberName("MX")] MX,
    [JsonStringEnumMemberName("MY")] MY,
    [JsonStringEnumMemberName("MZ")] MZ,
}

[JsonConverter(typeof(JsonStringEnumConverter<DisplacementComponent>))]
public enum DisplacementComponent
{
    [JsonStringEnumMemberName("UX")] UX,
    [JsonStringEnumMemberName("UY")] UY,
    [JsonStringEnumMemberName("UZ")] UZ,
    [JsonStringEnumMemberName("total")] Total,
}

public sealed class LoadInput
{
    [Description("Type de charge.")] public required LoadKind Kind { get; init; }
    [Description("Numéro du cas de charge simple.")] public required int CaseId { get; init; }
    [Description("Éléments chargés (nœuds, barres ou panneaux selon le type). Vide pour un poids propre sur toute la structure.")]
    public int[] Objects { get; init; } = Array.Empty<int>();
    [Description("Composante X (force, charge linéique ou surfacique selon le type), dans l'unité « unit ».")] public double X { get; init; }
    [Description("Composante Y, dans l'unité « unit ».")] public double Y { get; init; }
    [Description("Composante Z (négative = vers le bas), dans l'unité « unit ».")] public double Z { get; init; }
    [Description("Unité OBLIGATOIRE des composantes : N|kN (nodal_force, bar_point_force), N/m|kN/m (bar_uniform), N/m2|kN/m2|Pa|kPa (panel_uniform), degC (bar_temperature), - (self_weight, coefficient).")]
    public required string Unit { get; init; }
    [Description("Moments nodaux MX, MY, MZ (nodal_force uniquement) dans l'unité moment_unit.")]
    public double MX { get; init; }
    public double MY { get; init; }
    public double MZ { get; init; }
    [Description("Unité des moments (Nm|kNm), requise si un moment est non nul.")] public string? MomentUnit { get; init; }
    [Description("bar_point_force : position le long de la barre (relative 0..1 si relative=true, sinon en m).")] public double? Position { get; init; }
    [Description("bar_point_force : position relative (true) ou absolue en m (false).")] public bool Relative { get; init; } = true;
    [Description("Charge exprimée dans le repère local de l'élément.")] public bool Local { get; init; }
    [Description("self_weight : coefficient multiplicateur (1 = poids propre).")] public double Factor { get; init; } = 1;
    [Description("bar_temperature : variation uniforme de température (°C).")] public double Temperature { get; init; }
}

public sealed class CaseFactorInput
{
    [Description("Numéro du cas simple.")] public required int CaseId { get; init; }
    [Description("Coefficient (ex. 1.35).")] public required double Factor { get; init; }
}

public sealed class VariableActionInput
{
    [Description("Numéro du cas de charge variable (exploitation, neige, vent…).")] public required int CaseId { get; init; }
    [Description("Coefficient ψ0 (valeur de combinaison) de cette action, fourni explicitement.")] public required double Psi0 { get; init; }
    [Description("Coefficient ψ1 (fréquent), optionnel.")] public double? Psi1 { get; init; }
    [Description("Coefficient ψ2 (quasi permanent), optionnel.")] public double? Psi2 { get; init; }
}
