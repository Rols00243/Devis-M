using System.Globalization;
using System.Text.RegularExpressions;
using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.Core.Units;

/// <summary>
/// Service centralisé de conversion d'unités.
/// Convention interne : tout ce qui est envoyé à RobotOM est en SI (m, N, N·m, Pa, N/m, N/m², N/m³, rad, °C).
/// Aucune conversion implicite : une unité inconnue ou de mauvaise dimension lève une erreur UNIT_ERROR.
/// </summary>
public sealed partial class UnitService
{
    private sealed record UnitDef(Dimension Dimension, double ToSi);

    // Symboles acceptés (normalisés : sans espaces, '²'→'2', '³'→'3', '·'/'.'/'*' supprimés).
    private static readonly Dictionary<string, UnitDef> Units = new(StringComparer.Ordinal)
    {
        ["m"] = new(Dimension.Length, 1), ["cm"] = new(Dimension.Length, 1e-2), ["mm"] = new(Dimension.Length, 1e-3),
        ["N"] = new(Dimension.Force, 1), ["kN"] = new(Dimension.Force, 1e3), ["MN"] = new(Dimension.Force, 1e6),
        ["Nm"] = new(Dimension.Moment, 1), ["kNm"] = new(Dimension.Moment, 1e3), ["MNm"] = new(Dimension.Moment, 1e6),
        ["N/m"] = new(Dimension.LinearLoad, 1), ["kN/m"] = new(Dimension.LinearLoad, 1e3), ["MN/m"] = new(Dimension.LinearLoad, 1e6),
        ["N/m2"] = new(Dimension.SurfaceLoad, 1), ["kN/m2"] = new(Dimension.SurfaceLoad, 1e3),
        ["Pa"] = new(Dimension.Stress, 1), ["kPa"] = new(Dimension.Stress, 1e3),
        ["MPa"] = new(Dimension.Stress, 1e6), ["GPa"] = new(Dimension.Stress, 1e9),
        ["N/mm2"] = new(Dimension.Stress, 1e6),
        ["N/m3"] = new(Dimension.UnitWeight, 1), ["kN/m3"] = new(Dimension.UnitWeight, 1e3),
        ["Nm/rad"] = new(Dimension.RotationalSpring, 1), ["kNm/rad"] = new(Dimension.RotationalSpring, 1e3),
        ["rad"] = new(Dimension.Angle, 1), ["deg"] = new(Dimension.Angle, Math.PI / 180), ["°"] = new(Dimension.Angle, Math.PI / 180),
        ["degC"] = new(Dimension.Temperature, 1), ["°C"] = new(Dimension.Temperature, 1),
        ["-"] = new(Dimension.Dimensionless, 1), ["%"] = new(Dimension.Dimensionless, 0.01),
    };

    /// <summary>Unités de sortie par défaut (lisibles par un ingénieur).</summary>
    public static readonly IReadOnlyDictionary<Dimension, string> DefaultOutputUnits = new Dictionary<Dimension, string>
    {
        [Dimension.Length] = "m",
        [Dimension.Force] = "kN",
        [Dimension.Moment] = "kNm",
        [Dimension.LinearLoad] = "kN/m",
        [Dimension.SurfaceLoad] = "kN/m2",
        [Dimension.Stress] = "MPa",
        [Dimension.UnitWeight] = "kN/m3",
        [Dimension.Spring] = "kN/m",
        [Dimension.RotationalSpring] = "kNm/rad",
        [Dimension.Angle] = "deg",
        [Dimension.Temperature] = "degC",
    };

    public static string Normalize(string unit)
    {
        var u = unit.Trim()
            .Replace("²", "2").Replace("³", "3")
            .Replace("·", "").Replace("⋅", "").Replace("*", "").Replace(" ", "");
        // "kN.m" -> "kNm", mais pas "N/mm2".
        u = u.Replace(".m", "m");
        if (u is "kPa" or "Pa" or "MPa" or "GPa") return u;
        if (u.Equals("degc", StringComparison.OrdinalIgnoreCase) || u == "C") return "degC";
        return u;
    }

    public bool TryGetUnit(string unit, out Dimension dimension, out double toSi)
    {
        var key = Normalize(unit);
        if (Units.TryGetValue(key, out var def))
        {
            dimension = def.Dimension;
            toSi = def.ToSi;
            return true;
        }
        dimension = default;
        toSi = 0;
        return false;
    }

    /// <summary>Convertit une valeur exprimée dans <paramref name="unit"/> vers le SI, en vérifiant la dimension.</summary>
    public double ToSi(double value, string unit, Dimension expected)
    {
        if (!double.IsFinite(value))
            throw new RobotMcpException(ErrorCodes.ValidationFailed, $"Valeur non finie ({value}) pour une grandeur {expected}.");
        var factor = Factor(unit, expected);
        return value * factor;
    }

    /// <summary>Convertit une valeur SI vers l'unité demandée.</summary>
    public double FromSi(double siValue, string unit, Dimension expected) => siValue / Factor(unit, expected);

    public double FromSi(double siValue, Dimension dimension) => FromSi(siValue, DefaultOutputUnits[dimension], dimension);

    public string OutputUnit(Dimension d) => DefaultOutputUnits[d];

    private double Factor(string unit, Dimension expected)
    {
        if (string.IsNullOrWhiteSpace(unit))
            throw new RobotMcpException(ErrorCodes.UnitError, $"Unité manquante pour une grandeur {expected}. Les unités doivent toujours être explicites.");
        if (!TryGetUnit(unit, out var dim, out var factor))
            throw new RobotMcpException(ErrorCodes.UnitError, $"Unité inconnue « {unit} ». Unités acceptées pour {expected} : {string.Join(", ", Accepted(expected))}.");
        // Pa et N/m² sont la même grandeur physique : on accepte Pa/kPa pour une charge surfacique et N/m2 pour une contrainte.
        if (dim != expected && !(IsPressure(dim) && IsPressure(expected)) && !(dim == Dimension.LinearLoad && expected == Dimension.Spring))
            throw new RobotMcpException(ErrorCodes.UnitError, $"Unité « {unit} » ({dim}) incompatible avec une grandeur {expected}. Unités acceptées : {string.Join(", ", Accepted(expected))}.");
        return factor;
    }

    private static bool IsPressure(Dimension d) => d is Dimension.Stress or Dimension.SurfaceLoad;

    public static IEnumerable<string> Accepted(Dimension d) =>
        Units.Where(kv => kv.Value.Dimension == d || (IsPressure(d) && IsPressure(kv.Value.Dimension)) || (d == Dimension.Spring && kv.Value.Dimension == Dimension.LinearLoad))
             .Select(kv => kv.Key);

    [GeneratedRegex(@"^\s*(?<v>[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?)\s*(?<u>[^\d\s.,+\-].*?)\s*$")]
    private static partial Regex QuantityRegex();

    /// <summary>Analyse une quantité textuelle, par ex. « 3,20 m », « 320 mm », « 2 kN/m² ».</summary>
    public (double Value, string Unit) ParseQuantity(string text)
    {
        var m = QuantityRegex().Match(text ?? "");
        if (!m.Success)
            throw new RobotMcpException(ErrorCodes.UnitError, $"Quantité illisible « {text} » : format attendu « <valeur> <unité> » (unité obligatoire).");
        var v = double.Parse(m.Groups["v"].Value.Replace(',', '.'), CultureInfo.InvariantCulture);
        return (v, m.Groups["u"].Value);
    }

    public double ParseToSi(string text, Dimension expected)
    {
        var (v, u) = ParseQuantity(text);
        return ToSi(v, u, expected);
    }

    // Surcharges typées (enums des schémas MCP).
    public double ToSi(double v, LengthUnit u) => ToSi(v, u.ToString(), Dimension.Length);
    public double ToSi(double v, ForceUnit u) => ToSi(v, u.ToString(), Dimension.Force);
    public double ToSi(double v, MomentUnit u) => ToSi(v, u.ToString(), Dimension.Moment);
    public double ToSi(double v, LinearLoadUnit u) => ToSi(v, Symbol(u), Dimension.LinearLoad);
    public double ToSi(double v, SurfaceLoadUnit u) => ToSi(v, Symbol(u), Dimension.SurfaceLoad);
    public double ToSi(double v, StressUnit u) => ToSi(v, u.ToString(), Dimension.Stress);
    public double ToSi(double v, UnitWeightUnit u) => ToSi(v, Symbol(u), Dimension.UnitWeight);
    public double ToSi(double v, SpringUnit u) => ToSi(v, Symbol(u), Dimension.Spring);
    public double ToSi(double v, AngleUnit u) => ToSi(v, u.ToString(), Dimension.Angle);

    public static string Symbol(LinearLoadUnit u) => u == LinearLoadUnit.kN_per_m ? "kN/m" : "N/m";
    public static string Symbol(SurfaceLoadUnit u) => u switch
    {
        SurfaceLoadUnit.kN_per_m2 => "kN/m2", SurfaceLoadUnit.N_per_m2 => "N/m2",
        SurfaceLoadUnit.kPa => "kPa", _ => "Pa",
    };
    public static string Symbol(UnitWeightUnit u) => u == UnitWeightUnit.kN_per_m3 ? "kN/m3" : "N/m3";
    public static string Symbol(SpringUnit u) => u switch
    {
        SpringUnit.kN_per_m => "kN/m", SpringUnit.MN_per_m => "MN/m", _ => "N/m",
    };

    /// <summary>Arrondi d'affichage (évite le bruit numérique 1e-17 dans le JSON).</summary>
    public static double Round(double v, int digits = 6) =>
        double.IsFinite(v) ? Math.Round(v, digits, MidpointRounding.AwayFromZero) : v;
}
