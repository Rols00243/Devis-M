using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class MeshTools(ToolRunner runner, IRobotGateway gateway, ModelService model, UnitService units)
{
    [McpServerTool(Name = "get_mesh_settings", ReadOnly = true, Idempotent = true)]
    [Description("Paramètres de maillage des panneaux (taille d'élément en m, méthode, type de génération).")]
    public Task<CallToolResult> GetMeshSettings(int[]? panel_ids = null) =>
        runner.RunAsync("get_mesh_settings", SafetyLevel.Read, new { panel_ids }, _ => new { settings = gateway.GetMeshSettings(panel_ids), units = new { element_size = "m" } });

    [McpServerTool(Name = "set_mesh_settings")]
    [Description("Définit la taille d'élément fini des panneaux (tous si panel_ids vide). Le maillage est à régénérer ensuite (generate_mesh).")]
    public Task<CallToolResult> SetMeshSettings(double element_size, LengthUnit length_unit, int[]? panel_ids = null) =>
        runner.RunAsync("set_mesh_settings", SafetyLevel.Write, new { element_size, length_unit, panel_ids }, ctx =>
        {
            var size = units.ToSi(element_size, length_unit);
            new Validator().Range(size, 0.01, 10, "element_size", "m").ThrowIfAny();
            var ids = panel_ids is { Length: > 0 } ? panel_ids : gateway.GetPanels().Select(p => p.Id).ToArray();
            if (ids.Length == 0) throw new RobotMcpException(ErrorCodes.NotFound, "Aucun panneau dans le modèle.");
            model.RequirePanels(ids);
            if (size > 2) ctx.Warn("COARSE_MESH", $"Maille de {size} m grossière : précision des efforts dans les panneaux limitée.");
            gateway.SetMeshSettings(ids, size);
            ctx.Touch("panel", ids);
            return new { panels = SelectionParser.Format(ids), element_size_m = size };
        });

    [McpServerTool(Name = "generate_mesh")]
    [Description("Génère (ou régénère) le modèle de calcul et le maillage des panneaux (CalcEngine.GenerateModel).")]
    public Task<CallToolResult> GenerateMesh() =>
        runner.RunAsync("generate_mesh", SafetyLevel.Write, null, _ =>
        {
            gateway.GenerateMesh();
            return gateway.GetMeshStatistics();
        });

    [McpServerTool(Name = "refine_mesh")]
    [Description("Raffinement local : impose une taille d'élément plus fine sur certains panneaux puis régénère le maillage. (RobotOM n'expose pas de raffinement autour d'un point : le raffinement se fait par panneau.)")]
    public Task<CallToolResult> RefineMesh(int[] panel_ids, double element_size, LengthUnit length_unit) =>
        runner.RunAsync("refine_mesh", SafetyLevel.Write, new { panel_ids, element_size, length_unit }, ctx =>
        {
            var size = units.ToSi(element_size, length_unit);
            new Validator().NotEmpty(panel_ids, "panel_ids").Range(size, 0.01, 10, "element_size", "m").ThrowIfAny();
            model.RequirePanels(panel_ids);
            var before = gateway.GetMeshStatistics();
            gateway.SetMeshSettings(panel_ids, size);
            gateway.GenerateMesh();
            ctx.Touch("panel", panel_ids);
            return new { before, after = gateway.GetMeshStatistics(), element_size_m = size };
        });

    [McpServerTool(Name = "get_mesh_statistics", ReadOnly = true, Idempotent = true)]
    [Description("Statistiques de maillage : éléments finis, nœuds, panneaux maillés.")]
    public Task<CallToolResult> GetMeshStatistics() =>
        runner.RunAsync("get_mesh_statistics", SafetyLevel.Read, null, _ => gateway.GetMeshStatistics());
}

[McpServerToolType]
public sealed class AnalysisTools(ToolRunner runner, IRobotGateway gateway, ModelChecker checker, AnalysisTracker tracker)
{
    [McpServerTool(Name = "check_model", ReadOnly = true, Idempotent = true)]
    [Description("Vérifie le modèle avant calcul : nœuds isolés/coïncidents, barres sans section ou matériau, absence d'appuis, instabilités globales évidentes, panneaux sans épaisseur ou non maillés, charges invalides, combinaisons incohérentes. Renvoie severity, element_id, category, message, recommended_action.")]
    public Task<CallToolResult> CheckModel() =>
        runner.RunAsync("check_model", SafetyLevel.Read, null, _ => CheckModelData(checker));

    internal static object CheckModelData(ModelChecker checker)
    {
        var issues = checker.Check();
        return new
        {
            ready_for_analysis = issues.All(i => i.Severity != "error"),
            errors = issues.Count(i => i.Severity == "error"),
            warnings = issues.Count(i => i.Severity == "warning"),
            infos = issues.Count(i => i.Severity == "info"),
            issues = issues.Take(300),
            truncated = issues.Count > 300,
            scope = "Contrôles du serveur MCP sur les données lues dans Robot. La vérification interne de Robot (Analyse > Vérifier la structure) n'est pas exposée par RobotOM et reste recommandée.",
        };
    }

    [McpServerTool(Name = "run_analysis")]
    [Description("Lance le calcul Robot (tous les cas). Attend au plus wait_seconds ; au-delà, renvoie l'état « running » (suivi par get_analysis_status). Le calcul n'est déclaré réussi que si Robot rend des résultats ; les messages du solveur disponibles sont toujours renvoyés.")]
    public Task<CallToolResult> RunAnalysis([Description("Attente maximale (1..1800 s).")] int wait_seconds = 600) =>
        runner.RunAsync("run_analysis", SafetyLevel.Write, new { wait_seconds }, async ctx =>
        {
            var snap = await tracker.RunAsync(gateway, TimeSpan.FromSeconds(Math.Clamp(wait_seconds, 1, 1800)));
            return Interpret(snap, ctx);
        });

    internal static object Interpret(AnalysisTracker.Snapshot snap, OperationContext ctx)
    {
        switch (snap.State)
        {
            case "running":
                ctx.Warn("ANALYSIS_STILL_RUNNING", "Le calcul est toujours en cours ; appelez get_analysis_status.");
                return snap;
            case "failed":
            {
                var code = ErrorCodes.AnalysisFailed;
                var message = snap.Error ?? "Le calcul a échoué.";
                var sep = message.IndexOf(": ", StringComparison.Ordinal);
                if (sep > 0 && message[..sep].All(ch => char.IsUpper(ch) || ch == '_'))
                {
                    code = message[..sep];
                    message = message[(sep + 2)..];
                }
                throw new RobotMcpException(code, message, new { messages = snap.Messages, return_code = snap.ReturnCode });
            }
            default:
                return snap;
        }
    }

    [McpServerTool(Name = "get_analysis_status", ReadOnly = true)]
    [Description("État du dernier calcul : idle, running, succeeded, failed ; durée, disponibilité des résultats, code retour.")]
    public Task<CallToolResult> GetAnalysisStatus() =>
        runner.RunAsync("get_analysis_status", SafetyLevel.Read, null, _ => tracker.Current, new RunOptions { BypassLock = true });

    [McpServerTool(Name = "get_analysis_messages", ReadOnly = true)]
    [Description("Messages du solveur disponibles pour le dernier calcul (code retour de CalcEngine.Calculate, disponibilité des résultats, erreurs COM).")]
    public Task<CallToolResult> GetAnalysisMessages() =>
        runner.RunAsync("get_analysis_messages", SafetyLevel.Read, null, _ => new { tracker.Current.State, tracker.Current.Messages, tracker.Current.Error },
            new RunOptions { BypassLock = true });

    [McpServerTool(Name = "cancel_analysis")]
    [Description("Demande l'annulation du calcul. Limitation : RobotOM n'expose aucune méthode d'annulation pour CalcEngine.Calculate() (appel synchrone).")]
    public Task<CallToolResult> CancelAnalysis() =>
        runner.RunAsync("cancel_analysis", SafetyLevel.Write, null, _ =>
            throw new LimitationException(
                "Annulation impossible via l'API : CalcEngine.Calculate() est synchrone et RobotOM ne fournit pas de méthode d'arrêt. " +
                "Utilisez le bouton « Arrêter » de la fenêtre de calcul de Robot.",
                new { current = tracker.Current }), new RunOptions { BypassLock = true });
}
