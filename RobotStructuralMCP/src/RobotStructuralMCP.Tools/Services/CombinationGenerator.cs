using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.Tools.Services;

public sealed record GeneratedCombination(string Name, CombinationType Type, string Rule, IReadOnlyList<CaseFactor> Factors);

public sealed record VariableAction(int CaseId, double Psi0, double? Psi1, double? Psi2);

/// <summary>
/// Génération de combinaisons selon l'EN 1990 (combinaison fondamentale 6.10, ELS caractéristique 6.14b,
/// fréquente 6.15b, quasi permanente 6.16b). La norme n'est JAMAIS supposée : elle doit être demandée explicitement
/// ou lue dans les paramètres du projet. Les coefficients partiels et ψ sont des entrées explicites, renvoyées dans la réponse.
/// </summary>
public static class CombinationGenerator
{
    public sealed record En1990Factors(double GammaGSup, double GammaGInf, double GammaQ);

    public static IReadOnlyList<GeneratedCombination> En1990(IReadOnlyList<int> permanent, IReadOnlyList<VariableAction> variables,
        En1990Factors f, bool uls, bool slsCharacteristic, bool slsFrequent, bool slsQuasiPermanent, bool favourablePermanent)
    {
        var list = new List<GeneratedCombination>();
        IEnumerable<CaseFactor> G(double gamma) => permanent.Select(c => new CaseFactor(c, gamma));

        if (uls)
        {
            var gammas = favourablePermanent ? new[] { f.GammaGSup, f.GammaGInf } : new[] { f.GammaGSup };
            foreach (var gG in gammas.Distinct())
            {
                if (variables.Count == 0)
                    list.Add(new("ELU " + Fmt(gG) + "G", CombinationType.Uls, "EN 1990 éq. 6.10", G(gG).ToList()));
                foreach (var lead in variables)
                {
                    var factors = G(gG).Append(new CaseFactor(lead.CaseId, f.GammaQ))
                        .Concat(variables.Where(v => v != lead).Select(v => new CaseFactor(v.CaseId, f.GammaQ * v.Psi0)));
                    list.Add(new($"ELU {Fmt(gG)}G + {Fmt(f.GammaQ)}Q{lead.CaseId}" + (variables.Count > 1 ? " (+ψ0 autres)" : ""),
                        CombinationType.Uls, "EN 1990 éq. 6.10", Merge(factors)));
                }
            }
        }
        if (slsCharacteristic)
        {
            if (variables.Count == 0) list.Add(new("ELS car. G", CombinationType.Sls, "EN 1990 éq. 6.14b", G(1).ToList()));
            foreach (var lead in variables)
                list.Add(new($"ELS car. G + Q{lead.CaseId}", CombinationType.Sls, "EN 1990 éq. 6.14b",
                    Merge(G(1).Append(new CaseFactor(lead.CaseId, 1)).Concat(variables.Where(v => v != lead).Select(v => new CaseFactor(v.CaseId, v.Psi0))))));
        }
        if (slsFrequent)
            foreach (var lead in variables.Where(v => v.Psi1 is not null))
                list.Add(new($"ELS fréq. G + ψ1Q{lead.CaseId}", CombinationType.Sls, "EN 1990 éq. 6.15b",
                    Merge(G(1).Append(new CaseFactor(lead.CaseId, lead.Psi1!.Value))
                        .Concat(variables.Where(v => v != lead && v.Psi2 is not null).Select(v => new CaseFactor(v.CaseId, v.Psi2!.Value))))));
        if (slsQuasiPermanent && variables.All(v => v.Psi2 is not null))
            list.Add(new("ELS q.perm. G + ψ2Q", CombinationType.Sls, "EN 1990 éq. 6.16b",
                Merge(G(1).Concat(variables.Select(v => new CaseFactor(v.CaseId, v.Psi2!.Value))))));
        return list;
    }

    private static List<CaseFactor> Merge(IEnumerable<CaseFactor> factors) =>
        factors.Where(f => Math.Abs(f.Factor) > 1e-12).GroupBy(f => f.CaseId).Select(g => new CaseFactor(g.Key, Math.Round(g.Sum(x => x.Factor), 6))).ToList();

    private static string Fmt(double v) => v.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);
}
