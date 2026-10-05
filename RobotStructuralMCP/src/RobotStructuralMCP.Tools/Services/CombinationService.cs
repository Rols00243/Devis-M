using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Tools.Infrastructure;

namespace RobotStructuralMCP.Tools.Services;

public sealed class CombinationService(IRobotGateway gateway)
{
    public void Validate(IReadOnlyList<CaseFactor> factors, int? selfId = null)
    {
        var v = new Validator().NotEmpty(factors, "factors");
        var cases = gateway.GetLoadCases().ToDictionary(c => c.Id);
        foreach (var f in factors)
        {
            v.Finite(f.Factor, $"factor(cas {f.CaseId})");
            if (!cases.TryGetValue(f.CaseId, out var c)) v.Error($"Cas {f.CaseId} inexistant.", ErrorCodes.NotFound);
            else if (c.Kind != "simple" && f.CaseId != selfId) v.Error($"Le cas {f.CaseId} est déjà une combinaison (imbrication non gérée).");
            if (Math.Abs(f.Factor) > 10) v.Error($"Coefficient {f.Factor} du cas {f.CaseId} manifestement incohérent (|γ| > 10).");
        }
        if (factors.GroupBy(f => f.CaseId).Any(g => g.Count() > 1)) v.Error("Un même cas apparaît plusieurs fois dans la combinaison.");
        v.ThrowIfAny();
    }

    public CombinationData Create(int? id, string name, CombinationType type, IReadOnlyList<CaseFactor> factors, OperationContext ctx)
    {
        new Validator().NotEmpty(name, "name").Id(id, "id").ThrowIfAny();
        Validate(factors);
        int cid = id ?? gateway.NextCaseId();
        if (gateway.CaseExists(cid)) throw new RobotMcpException(ErrorCodes.AlreadyExists, $"Le numéro de cas {cid} est déjà utilisé.");
        gateway.CreateCombination(cid, name, type, factors);
        ctx.Touch("case", new[] { cid });
        return gateway.GetCombinations().First(c => c.Id == cid);
    }

    public object Generate(string norm, int[] permanent, VariableActionInput[] variables, bool uls, bool slsC, bool slsF, bool slsQp,
        bool favourable, CombinationGenerator.En1990Factors factors, bool dryRun, OperationContext ctx)
    {
        string normUsed;
        if (string.Equals(norm, "EN1990", StringComparison.OrdinalIgnoreCase))
        {
            normUsed = "EN 1990 (demandée explicitement)";
        }
        else if (string.Equals(norm, "from_project", StringComparison.OrdinalIgnoreCase))
        {
            var codes = gateway.GetProjectInfo().Codes;
            var code = codes.TryGetValue("I_CT_CODE_COMBINATIONS", out var c) ? c : null;
            if (code is null)
                throw new RobotMcpException(ErrorCodes.ValidationFailed,
                    "La norme de combinaisons du projet n'est pas lisible via l'API : précisez explicitement norm=EN1990 (ou créez les combinaisons avec create_combination).");
            if (!(code.Contains("1990", StringComparison.Ordinal) || code.Contains("Eurocode", StringComparison.OrdinalIgnoreCase)))
                throw new RobotMcpException(ErrorCodes.NotSupportedByApi,
                    $"Norme de combinaisons du projet : « {code} ». Ce générateur ne gère que l'EN 1990 ; la génération automatique de Robot pour cette norme n'est pas exposée par une API vérifiée. " +
                    "Créez les combinaisons avec create_combination ou utilisez la génération automatique de Robot (Chargements > Combinaisons automatiques).");
            normUsed = $"EN 1990 (norme du projet : {code})";
        }
        else
        {
            throw new ValidationException("norm doit valoir « EN1990 » ou « from_project ».");
        }

        var v = new Validator().NotEmpty(permanent, "permanent_cases");
        v.Range(factors.GammaGSup, 1, 2, "gamma_g_sup", "-").Range(factors.GammaGInf, 0, 1.5, "gamma_g_inf", "-").Range(factors.GammaQ, 1, 2, "gamma_q", "-");
        foreach (var x in variables)
        {
            v.Range(x.Psi0, 0, 1, $"psi0(cas {x.CaseId})", "-");
            if (x.Psi1 is { } p1) v.Range(p1, 0, 1, $"psi1(cas {x.CaseId})", "-");
            if (x.Psi2 is { } p2) v.Range(p2, 0, 1, $"psi2(cas {x.CaseId})", "-");
        }
        if (slsF) v.Require(variables.Any(x => x.Psi1 is not null), "sls_frequent : fournir psi1 pour au moins une action variable.");
        if (slsQp) v.Require(variables.All(x => x.Psi2 is not null), "sls_quasi_permanent : fournir psi2 pour toutes les actions variables.");
        var cases = gateway.GetLoadCases().ToDictionary(c => c.Id);
        foreach (var id in permanent.Concat(variables.Select(x => x.CaseId)))
            if (!cases.TryGetValue(id, out var cs) || cs.Kind != "simple") v.Error($"Cas simple {id} inexistant.", ErrorCodes.NotFound);
        if (permanent.Intersect(variables.Select(x => x.CaseId)).Any()) v.Error("Un cas ne peut pas être à la fois permanent et variable.");
        v.ThrowIfAny();
        foreach (var id in permanent.Where(id => cases[id].Nature != "permanent"))
            ctx.Warn("NATURE_MISMATCH", $"Le cas {id} est déclaré permanent mais sa nature Robot est « {cases[id].Nature} ».");
        foreach (var x in variables.Where(x => cases[x.CaseId].Nature == "permanent"))
            ctx.Warn("NATURE_MISMATCH", $"Le cas {x.CaseId} est déclaré variable mais sa nature Robot est « permanent ».");
        ctx.Warn("PARTIAL_FACTORS", $"Coefficients utilisés : γG,sup={factors.GammaGSup}, γG,inf={factors.GammaGInf}, γQ={factors.GammaQ} — vérifiez l'annexe nationale applicable.");

        var generated = CombinationGenerator.En1990(permanent, variables.Select(x => new VariableAction(x.CaseId, x.Psi0, x.Psi1, x.Psi2)).ToList(),
            factors, uls, slsC, slsF, slsQp, favourable);
        var created = new List<object>();
        if (!dryRun)
        {
            int next = gateway.NextCaseId();
            foreach (var g in generated)
            {
                while (gateway.CaseExists(next)) next++;
                gateway.CreateCombination(next, g.Name, g.Type, g.Factors);
                ctx.Touch("case", new[] { next });
                created.Add(new { id = next, g.Name, type = g.Type, rule = g.Rule, factors = g.Factors });
                next++;
            }
        }
        return new
        {
            norm = normUsed,
            dry_run = dryRun,
            count = generated.Count,
            combinations = dryRun ? generated.Select(g => (object)new { g.Name, type = g.Type, rule = g.Rule, factors = g.Factors }).ToList() : created,
        };
    }
}
