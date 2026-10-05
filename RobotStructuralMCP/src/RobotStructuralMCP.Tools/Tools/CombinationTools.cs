using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class CombinationTools(ToolRunner runner, IRobotGateway gateway, CombinationService combos, ConfirmationService confirm)
{
    [McpServerTool(Name = "get_combinations", ReadOnly = true, Idempotent = true)]
    [Description("Combinaisons de charges : type (ULS/SLS/ACC) et coefficients par cas.")]
    public Task<CallToolResult> GetCombinations() =>
        runner.RunAsync("get_combinations", SafetyLevel.Read, null, _ => gateway.GetCombinations());

    [McpServerTool(Name = "create_combination")]
    [Description("Crée une combinaison manuelle : type ULS, SLS ou ACC et liste {case_id, factor}.")]
    public Task<CallToolResult> CreateCombination(string name, CombinationType type, CaseFactorInput[] factors, int? id = null) =>
        runner.RunAsync("create_combination", SafetyLevel.Write, new { name, type, factors, id }, ctx =>
            combos.Create(id, name, type, factors.Select(f => new CaseFactor(f.CaseId, f.Factor)).ToList(), ctx));

    [McpServerTool(Name = "update_combination")]
    [Description("Remplace la définition d'une combinaison existante (même numéro).")]
    public Task<CallToolResult> UpdateCombination(int id, CaseFactorInput[] factors, string? name = null, CombinationType? type = null) =>
        runner.RunAsync("update_combination", SafetyLevel.Write, new { id, factors, name, type }, ctx =>
        {
            var existing = gateway.GetCombinations().FirstOrDefault(c => c.Id == id)
                           ?? throw new RobotMcpException(ErrorCodes.NotFound, $"Combinaison {id} inexistante.");
            var newType = type ?? existing.Type switch { "SLS" => CombinationType.Sls, "ACC" => CombinationType.Accidental, _ => CombinationType.Uls };
            var list = factors.Select(f => new CaseFactor(f.CaseId, f.Factor)).ToList();
            combos.Validate(list, id);
            // RobotOM ne permet pas de vider proprement les facteurs d'une combinaison : suppression puis recréation au même numéro.
            gateway.DeleteCase(id);
            return combos.Create(id, name ?? existing.Name, newType, list, ctx);
        });

    [McpServerTool(Name = "delete_combination", Destructive = true)]
    [Description("Supprime une ou plusieurs combinaisons (au-delà du seuil de suppression massive : confirmation requise).")]
    public Task<CallToolResult> DeleteCombination(int[] ids, string? confirmation_token = null) =>
        runner.RunAsync("delete_combination", ids.Length > runner.Safety.MassDeletionThreshold ? SafetyLevel.Destructive : SafetyLevel.Write,
            new { ids, confirmation_token }, ctx =>
            {
                var existing = gateway.GetCombinations().Select(c => c.Id).ToHashSet();
                var missing = ids.Where(i => !existing.Contains(i)).ToList();
                if (missing.Count > 0) throw new RobotMcpException(ErrorCodes.NotFound, $"Combinaison(s) inexistante(s) : {SelectionParser.Format(missing)}.");
                if (ids.Length > runner.Safety.MassDeletionThreshold)
                    confirm.Require("delete_combination", SelectionParser.Format(ids.OrderBy(i => i)), confirmation_token, $"{ids.Length} combinaisons seront supprimées.");
                foreach (var id in ids) gateway.DeleteCase(id);
                ctx.Touch("case", ids);
                return new { deleted = SelectionParser.Format(ids) };
            });

    [McpServerTool(Name = "generate_combinations")]
    [Description("Génère des combinaisons ELU/ELS. La norme n'est JAMAIS supposée : norm=EN1990 (explicite) ou norm=from_project (lue dans Robot ; refus si non lisible ou non gérée). " +
                 "Les cas permanents et variables ainsi que les ψ0 (et ψ1/ψ2 pour les ELS fréquentes/quasi permanentes) doivent être fournis. " +
                 "γG,sup=1.35, γG,inf=1.0, γQ=1.5 par défaut (valeurs recommandées EN 1990 tableau A1.2(B) — à confirmer selon l'annexe nationale). dry_run=true pour seulement prévisualiser.")]
    public Task<CallToolResult> GenerateCombinations(
        [Description("EN1990 ou from_project.")] string norm,
        [Description("Cas permanents (G).")] int[] permanent_cases,
        [Description("Actions variables avec leurs ψ explicites.")] VariableActionInput[] variable_cases,
        bool uls = true, bool sls_characteristic = true, bool sls_frequent = false, bool sls_quasi_permanent = false,
        [Description("Ajouter les combinaisons ELU avec permanentes favorables (γG,inf).")] bool favourable_permanent = false,
        double gamma_g_sup = 1.35, double gamma_g_inf = 1.0, double gamma_q = 1.5,
        [Description("Prévisualiser sans créer.")] bool dry_run = false) =>
        runner.RunAsync("generate_combinations", SafetyLevel.Write,
            new { norm, permanent_cases, variable_cases, uls, sls_characteristic, sls_frequent, sls_quasi_permanent, favourable_permanent, gamma_g_sup, gamma_g_inf, gamma_q, dry_run },
            ctx => combos.Generate(norm, permanent_cases, variable_cases, uls, sls_characteristic, sls_frequent, sls_quasi_permanent,
                favourable_permanent, new CombinationGenerator.En1990Factors(gamma_g_sup, gamma_g_inf, gamma_q), dry_run, ctx));
}
