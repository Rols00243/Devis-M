using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Tools.Infrastructure;
using static RobotStructuralMCP.Core.Units.UnitService;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>
/// Extraction des résultats Robot. Les extrêmes et enveloppes sont DÉRIVÉS des valeurs lues dans Robot
/// (max/min sur les cas et les points d'échantillonnage demandés) : ce ne sont pas des calculs de structure.
/// Unités de sortie : forces kN, moments kNm, déplacements mm, rotations rad, contraintes MPa.
/// </summary>
public sealed class ResultService
{
    public const int MaxRows = 20_000;
    private readonly IRobotGateway _g;

    public ResultService(IRobotGateway gateway) => _g = gateway;

    public static readonly object ForceUnits = Out.Units(("fx,fy,fz", "kN"), ("mx,my,mz", "kNm"), ("position", "relative 0..1"), ("x", "m"));
    public static readonly object DisplacementUnits = Out.Units(("ux,uy,uz,total", "mm"), ("rx,ry,rz", "rad"));
    public static readonly object ReactionUnits = Out.Units(("fx,fy,fz", "kN"), ("mx,my,mz", "kNm"));

    public static IReadOnlyList<double> Positions(int points)
    {
        if (points is < 1 or > 101) throw new ValidationException("points doit être compris entre 1 et 101.");
        if (points == 1) return new[] { 0.5 };
        return Enumerable.Range(0, points).Select(i => Math.Round((double)i / (points - 1), 6)).ToList();
    }

    public void EnsureResults()
    {
        if (!_g.ResultsAvailable())
            throw new RobotMcpException(ErrorCodes.ResultsUnavailable, "Aucun résultat disponible : lancez le calcul (run_analysis ou analyze_structure).");
    }

    public static void CheckSize(long rows)
    {
        if (rows > MaxRows)
            throw new ValidationException($"Requête trop volumineuse ({rows} lignes > {MaxRows}). Filtrez par éléments, cas ou groupe, réduisez « points », ou utilisez extremes_only=true.");
    }

    // ---------------------------------------------------------------- Barres

    public IReadOnlyList<BarForces> BarForces(IReadOnlyList<BarData> bars, IReadOnlyList<LoadCaseData> cases, IReadOnlyList<double> positions)
    {
        CheckSize((long)bars.Count * cases.Count * positions.Count);
        var list = new List<BarForces>();
        foreach (var b in bars)
            foreach (var c in cases)
                foreach (var p in positions)
                    list.Add(_g.GetBarForces(b.Id, c.Id, p));
        return list;
    }

    public static object ForceRow(BarForces f, BarData? bar) => new
    {
        bar = f.Bar, @case = f.Case, position = f.Position, x = bar is null ? (double?)null : Round(bar.Length * f.Position, 4),
        FX = Round(f.FX / Out.kN, 4), FY = Round(f.FY / Out.kN, 4), FZ = Round(f.FZ / Out.kN, 4),
        MX = Round(f.MX / Out.kN, 4), MY = Round(f.MY / Out.kN, 4), MZ = Round(f.MZ / Out.kN, 4),
    };

    public static double Component(BarForces f, ForceComponent c) => c switch
    {
        ForceComponent.FX => f.FX, ForceComponent.FY => f.FY, ForceComponent.FZ => f.FZ,
        ForceComponent.MX => f.MX, ForceComponent.MY => f.MY, _ => f.MZ,
    };

    public static double Scale(ForceComponent c) => Out.kN;

    public static string UnitOf(ForceComponent c) => c is ForceComponent.FX or ForceComponent.FY or ForceComponent.FZ ? "kN" : "kNm";

    /// <summary>Extrêmes (max, min, |max|) de chaque composante sur l'ensemble des valeurs.</summary>
    public static object Extremes(IReadOnlyList<BarForces> values, IReadOnlyDictionary<int, BarData> bars)
    {
        var result = new Dictionary<string, object>();
        foreach (var comp in Enum.GetValues<ForceComponent>())
        {
            if (values.Count == 0) break;
            var max = values.MaxBy(v => Component(v, comp))!;
            var min = values.MinBy(v => Component(v, comp))!;
            result[comp.ToString()] = new
            {
                unit = UnitOf(comp),
                max = new { value = Round(Component(max, comp) / Out.kN, 4), bar = max.Bar, @case = max.Case, position = max.Position, x = Round(bars[max.Bar].Length * max.Position, 4) },
                min = new { value = Round(Component(min, comp) / Out.kN, 4), bar = min.Bar, @case = min.Case, position = min.Position, x = Round(bars[min.Bar].Length * min.Position, 4) },
            };
        }
        return result;
    }

    /// <summary>Enveloppe par barre : max/min de chaque composante sur tous les cas et points.</summary>
    public static IReadOnlyList<object> Envelope(IReadOnlyList<BarForces> values) =>
        values.GroupBy(v => v.Bar).OrderBy(g => g.Key).Select(g => (object)new
        {
            bar = g.Key,
            envelope = Enum.GetValues<ForceComponent>().ToDictionary(c => c.ToString(), c =>
            {
                var mx = g.MaxBy(v => Component(v, c))!;
                var mn = g.MinBy(v => Component(v, c))!;
                return (object)new
                {
                    max = Round(Component(mx, c) / Out.kN, 4), max_case = mx.Case, max_position = mx.Position,
                    min = Round(Component(mn, c) / Out.kN, 4), min_case = mn.Case, min_position = mn.Position,
                };
            }),
        }).ToList();

    // ---------------------------------------------------------------- Nœuds

    public static object DisplacementRow(NodeDisplacement d) => new
    {
        node = d.Node, @case = d.Case,
        UX = Round(d.UX / Out.mm, 4), UY = Round(d.UY / Out.mm, 4), UZ = Round(d.UZ / Out.mm, 4),
        total = Round(Math.Sqrt(d.UX * d.UX + d.UY * d.UY + d.UZ * d.UZ) / Out.mm, 4),
        RX = Round(d.RX, 8), RY = Round(d.RY, 8), RZ = Round(d.RZ, 8),
    };

    public static object ReactionRow(NodeReaction r) => new
    {
        node = r.Node, @case = r.Case,
        FX = Round(r.FX / Out.kN, 4), FY = Round(r.FY / Out.kN, 4), FZ = Round(r.FZ / Out.kN, 4),
        MX = Round(r.MX / Out.kN, 4), MY = Round(r.MY / Out.kN, 4), MZ = Round(r.MZ / Out.kN, 4),
    };

    public static double Displacement(NodeDisplacement d, DisplacementComponent c) => c switch
    {
        Infrastructure.DisplacementComponent.UX => d.UX, Infrastructure.DisplacementComponent.UY => d.UY, Infrastructure.DisplacementComponent.UZ => d.UZ,
        _ => Math.Sqrt(d.UX * d.UX + d.UY * d.UY + d.UZ * d.UZ),
    };
}
