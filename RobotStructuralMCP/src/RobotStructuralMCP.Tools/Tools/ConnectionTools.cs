using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;

namespace RobotStructuralMCP.Tools.Tools;

[McpServerToolType]
public sealed class ConnectionTools(ToolRunner runner, IRobotGateway gateway, ConfirmationService confirm)
{
    [McpServerTool(Name = "robot_get_status", ReadOnly = true, Idempotent = true)]
    [Description("État de Robot Structural Analysis : processus ouvert, connexion du serveur, projet actif, version. N'établit aucune connexion.")]
    public Task<CallToolResult> GetStatus() =>
        runner.RunAsync("robot_get_status", SafetyLevel.Read, null, _ => gateway.GetStatus(), new RunOptions { BypassLock = true });

    [McpServerTool(Name = "robot_connect", Idempotent = true)]
    [Description("Se connecte à l'instance Robot ouverte sur ce poste (et charge la bibliothèque de types RobotOM installée). " +
                 "Ne lance Robot que si launch_if_not_running=true ET si la configuration Robot:LaunchIfNotRunning l'autorise.")]
    public Task<CallToolResult> Connect(
        [Description("Lancer Robot s'il n'est pas ouvert (nécessite aussi Robot:LaunchIfNotRunning=true côté serveur).")] bool launch_if_not_running = false) =>
        runner.RunAsync("robot_connect", SafetyLevel.Read, new { launch_if_not_running }, _ => gateway.Connect(launch_if_not_running));

    [McpServerTool(Name = "robot_disconnect", Idempotent = true)]
    [Description("Libère la connexion COM à Robot (Robot reste ouvert).")]
    public Task<CallToolResult> Disconnect() =>
        runner.RunAsync("robot_disconnect", SafetyLevel.Read, null, _ =>
        {
            gateway.Disconnect();
            return new { disconnected = true };
        });

    [McpServerTool(Name = "robot_get_project_info", ReadOnly = true, Idempotent = true)]
    [Description("Nom, chemin, type du projet Robot actif, disponibilité des résultats et normes actives (si lisibles via l'API).")]
    public Task<CallToolResult> GetProjectInfo() =>
        runner.RunAsync("robot_get_project_info", SafetyLevel.Read, null, _ => gateway.GetProjectInfo());

    [McpServerTool(Name = "robot_save_project")]
    [Description("Enregistre le projet dans son fichier .rtd (le fichier utilisateur, même après un checkpoint).")]
    public Task<CallToolResult> Save() =>
        runner.RunAsync("robot_save_project", SafetyLevel.Write, null, _ =>
        {
            gateway.SaveProject();
            return new { saved = true, path = gateway.CurrentProjectPath };
        });

    [McpServerTool(Name = "robot_save_project_as", Destructive = true)]
    [Description("Enregistre le projet sous un nouveau chemin .rtd. Écraser un fichier existant est DESTRUCTIF et demande une confirmation (confirmation_token).")]
    public Task<CallToolResult> SaveAs(
        [Description("Chemin complet du fichier .rtd (ex. C:\\Projets\\Batiment.rtd).")] string path,
        [Description("Jeton renvoyé par un premier appel, après accord explicite de l'utilisateur pour écraser le fichier.")] string? confirmation_token = null) =>
        runner.RunAsync("robot_save_project_as", File.Exists(path) ? SafetyLevel.Destructive : SafetyLevel.Write, new { path, confirmation_token }, _ =>
        {
            if (string.IsNullOrWhiteSpace(path) || !path.EndsWith(".rtd", StringComparison.OrdinalIgnoreCase))
                throw new ValidationException("Le chemin doit se terminer par .rtd.");
            if (File.Exists(path))
                confirm.Require("robot_save_project_as", path.ToLowerInvariant(), confirmation_token, $"le fichier existant « {path} » sera écrasé.");
            gateway.SaveProjectAs(path);
            return new { saved = true, path };
        });

    [McpServerTool(Name = "robot_verify_api", ReadOnly = true, Idempotent = true)]
    [Description("Vérifie que chaque interface/membre/valeur d'énumération RobotOM utilisé par ce serveur existe dans la version de Robot installée (lecture de la bibliothèque de types COM).")]
    public Task<CallToolResult> VerifyApi() =>
        runner.RunAsync("robot_verify_api", SafetyLevel.Read, null, _ => gateway.VerifyApi());

    [McpServerTool(Name = "robot_describe_api", ReadOnly = true, Idempotent = true)]
    [Description("Liste les membres d'une interface RobotOM (ou les valeurs d'une énumération) telle qu'installée, ex. « IRobotBarSectionData », « IRobotLoadRecordType ».")]
    public Task<CallToolResult> DescribeApi([Description("Nom exact ou partiel de l'interface ou de l'énumération RobotOM.")] string name) =>
        runner.RunAsync("robot_describe_api", SafetyLevel.Read, new { name }, _ => new { name, members = gateway.DescribeApi(name) });
}
