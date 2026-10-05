using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Resources;

/// <summary>Ressources MCP en lecture seule (JSON), mêmes enveloppes que les tools.</summary>
[McpServerResourceType]
public sealed class ProjectResources(ToolRunner runner, IRobotGateway gateway, SummaryService summary, AnalysisTracker tracker)
{
    private async Task<string> Read(string name, Func<object?> body, bool bypass = false)
    {
        var env = await runner.ExecuteAsync("resource:" + name, SafetyLevel.Read, null, _ => Task.FromResult(body()), new RunOptions { BypassLock = bypass });
        return JsonSerializer.Serialize(env, JsonDefaults.Options);
    }

    [McpServerResource(UriTemplate = "project://summary", Name = "project_summary", MimeType = "application/json")]
    [Description("Résumé du modèle Robot actif.")]
    public Task<string> Summary() => Read("summary", () => summary.Build());

    [McpServerResource(UriTemplate = "project://nodes", Name = "project_nodes", MimeType = "application/json")]
    [Description("Tous les nœuds (m).")]
    public Task<string> Nodes() => Read("nodes", () => new { nodes = gateway.GetNodes().Select(Out.Node), units = new { coordinates = "m" } });

    [McpServerResource(UriTemplate = "project://bars", Name = "project_bars", MimeType = "application/json")]
    [Description("Toutes les barres.")]
    public Task<string> Bars() => Read("bars", () =>
    {
        var nodes = gateway.GetNodes().ToDictionary(n => n.Id);
        return new { bars = gateway.GetBars().Select(b => Out.Bar(b, nodes)), units = new { length = "m" } };
    });

    [McpServerResource(UriTemplate = "project://sections", Name = "project_sections", MimeType = "application/json")]
    [Description("Sections de barres.")]
    public Task<string> Sections() => Read("sections", () => gateway.GetSections().Select(Out.Section));

    [McpServerResource(UriTemplate = "project://materials", Name = "project_materials", MimeType = "application/json")]
    [Description("Matériaux.")]
    public Task<string> Materials() => Read("materials", () => gateway.GetMaterials().Select(Out.Material));

    [McpServerResource(UriTemplate = "project://load-cases", Name = "project_load_cases", MimeType = "application/json")]
    [Description("Cas de charges.")]
    public Task<string> LoadCases() => Read("load-cases", () => gateway.GetLoadCases());

    [McpServerResource(UriTemplate = "project://combinations", Name = "project_combinations", MimeType = "application/json")]
    [Description("Combinaisons.")]
    public Task<string> Combinations() => Read("combinations", () => gateway.GetCombinations());

    [McpServerResource(UriTemplate = "project://analysis-status", Name = "project_analysis_status", MimeType = "application/json")]
    [Description("État du calcul.")]
    public Task<string> AnalysisStatus() => Read("analysis-status", () => tracker.Current, bypass: true);
}
