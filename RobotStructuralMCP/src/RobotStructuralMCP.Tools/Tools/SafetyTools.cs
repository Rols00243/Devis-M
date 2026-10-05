using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class SafetyTools(ToolRunner runner, CheckpointService checkpoints, TransactionService transactions,
    ConfirmationService confirm, IAuditLog audit)
{
    [McpServerTool(Name = "create_checkpoint")]
    [Description("Crée un point de restauration complet du projet (copie .rtd ; RobotOM n'a pas de transaction native).")]
    public Task<CallToolResult> CreateCheckpoint([Description("Libellé du checkpoint.")] string label) =>
        runner.RunAsync("create_checkpoint", SafetyLevel.Write, new { label }, ctx =>
        {
            var cp = checkpoints.Create(label, "manual");
            ctx.Warn("CHECKPOINT_FILE", "En mode Robot, le projet est désormais ouvert depuis le fichier checkpoint ; robot_save_project ré-enregistre dans votre fichier d'origine.");
            return cp;
        });

    [McpServerTool(Name = "list_checkpoints", ReadOnly = true)]
    [Description("Liste les checkpoints disponibles (session courante).")]
    public Task<CallToolResult> ListCheckpoints() =>
        runner.RunAsync("list_checkpoints", SafetyLevel.Read, null, _ => checkpoints.List(), new RunOptions { BypassLock = true });

    [McpServerTool(Name = "restore_checkpoint", Destructive = true)]
    [Description("Recharge un checkpoint : TOUTES les modifications postérieures sont perdues. DESTRUCTIF : confirmation explicite requise (confirmation_token).")]
    public Task<CallToolResult> RestoreCheckpoint(
        [Description("Identifiant du checkpoint (list_checkpoints).")] string checkpoint_id,
        [Description("Jeton de confirmation obtenu au premier appel, après accord de l'utilisateur.")] string? confirmation_token = null) =>
        runner.RunAsync("restore_checkpoint", SafetyLevel.Destructive, new { checkpoint_id, confirmation_token }, _ =>
        {
            var cp = checkpoints.Get(checkpoint_id) ?? throw new Core.Errors.RobotMcpException(Core.Errors.ErrorCodes.NotFound, $"Checkpoint « {checkpoint_id} » inconnu.");
            confirm.Require("restore_checkpoint", checkpoint_id, confirmation_token,
                $"le modèle courant sera remplacé par le checkpoint « {cp.Label} » du {cp.CreatedAt:u} ; les modifications ultérieures seront perdues.");
            return checkpoints.Restore(checkpoint_id);
        });

    [McpServerTool(Name = "begin_transaction")]
    [Description("Démarre une transaction logique : un checkpoint est créé ; rollback_transaction y revient, commit_transaction valide.")]
    public Task<CallToolResult> Begin([Description("Libellé de la transaction.")] string label) =>
        runner.RunAsync("begin_transaction", SafetyLevel.Write, new { label }, _ => transactions.Begin(label));

    [McpServerTool(Name = "commit_transaction")]
    [Description("Valide la transaction active (le checkpoint associé est supprimé sauf keep_checkpoint=true).")]
    public Task<CallToolResult> Commit([Description("Conserver le checkpoint de début de transaction.")] bool keep_checkpoint = false) =>
        runner.RunAsync("commit_transaction", SafetyLevel.Write, new { keep_checkpoint }, _ => transactions.Commit(keep_checkpoint));

    [McpServerTool(Name = "rollback_transaction", Destructive = true)]
    [Description("Annule la transaction active en rechargeant son checkpoint. DESTRUCTIF : confirmation explicite requise.")]
    public Task<CallToolResult> Rollback([Description("Jeton de confirmation.")] string? confirmation_token = null) =>
        runner.RunAsync("rollback_transaction", SafetyLevel.Destructive, new { confirmation_token }, _ =>
        {
            var tx = transactions.Current ?? throw new Core.Errors.RobotMcpException(Core.Errors.ErrorCodes.TransactionError, "Aucune transaction active.");
            confirm.Require("rollback_transaction", tx.Id, confirmation_token,
                $"les {tx.Operations.Count} opération(s) de la transaction « {tx.Label} » seront annulées.", new { operations = tx.Operations });
            return transactions.Rollback();
        });

    [McpServerTool(Name = "get_transaction_status", ReadOnly = true)]
    [Description("Transaction active et opérations enregistrées.")]
    public Task<CallToolResult> Status() =>
        runner.RunAsync("get_transaction_status", SafetyLevel.Read, null, _ => (object?)transactions.Current ?? new { active = false },
            new RunOptions { BypassLock = true });

    [McpServerTool(Name = "get_audit_log", ReadOnly = true)]
    [Description("Dernières entrées du journal d'audit (tool, paramètres expurgés, résultat, durée, éléments modifiés).")]
    public Task<CallToolResult> AuditLog([Description("Nombre d'entrées (1..200).")] int count = 20) =>
        runner.RunAsync("get_audit_log", SafetyLevel.Read, new { count }, _ => audit.Recent(Math.Clamp(count, 1, 200)),
            new RunOptions { BypassLock = true });

    [McpServerTool(Name = "get_safety_policy", ReadOnly = true)]
    [Description("Politique de sécurité active : niveau maximal, seuil de suppression massive, checkpoints automatiques.")]
    public Task<CallToolResult> Policy() =>
        runner.RunAsync("get_safety_policy", SafetyLevel.Read, null, _ => new
        {
            max_level = runner.Safety.MaxLevel.ToString().ToUpperInvariant(),
            mass_deletion_threshold = runner.Safety.MassDeletionThreshold,
            auto_checkpoint = runner.Safety.AutoCheckpoint,
            max_batch_size = runner.Safety.MaxBatchSize,
            levels = new
            {
                READ = "consultation uniquement",
                WRITE = "création et modification",
                DESTRUCTIVE = "suppression massive, écrasement, restauration/rollback : confirmation en deux temps (confirmation_token)",
            },
        }, new RunOptions { BypassLock = true });
}
