using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace RobotStructuralMCP.Tests;

/// <summary>Le serveur complet (Streamable HTTP) répond au protocole MCP.</summary>
public class HttpIntegrationTests : IClassFixture<HttpIntegrationTests.Factory>
{
    public sealed class Factory : WebApplicationFactory<Program>
    {
        public Factory()
        {
            Environment.SetEnvironmentVariable("Robot__Mode", "Simulation");
            Environment.SetEnvironmentVariable("Safety__CheckpointDirectory", Path.Combine(Path.GetTempPath(), "robotmcp-it", "cp"));
            Environment.SetEnvironmentVariable("Safety__AuditLogDirectory", Path.Combine(Path.GetTempPath(), "robotmcp-it", "logs"));
        }
    }

    private readonly Factory _factory;

    public HttpIntegrationTests(Factory factory) => _factory = factory;

    private async Task<JsonElement> Rpc(HttpClient client, string method, object @params)
    {
        var body = JsonSerializer.Serialize(new { jsonrpc = "2.0", id = 1, method, @params });
        using var req = new HttpRequestMessage(HttpMethod.Post, "/mcp") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        var res = await client.SendAsync(req);
        res.EnsureSuccessStatusCode();
        if (res.Headers.TryGetValues("Mcp-Session-Id", out var sid)) client.DefaultRequestHeaders.TryAddWithoutValidation("Mcp-Session-Id", sid.First());
        var text = await res.Content.ReadAsStringAsync();
        var json = text.Split('\n').Select(l => l.Trim()).Where(l => l.StartsWith("data:")).Select(l => l[5..].Trim()).LastOrDefault() ?? text;
        return JsonDocument.Parse(json).RootElement;
    }

    [Fact]
    public async Task Initialize_list_tools_and_call_status()
    {
        var client = _factory.CreateClient();
        var init = await Rpc(client, "initialize", new { protocolVersion = "2025-06-18", capabilities = new { }, clientInfo = new { name = "test", version = "1" } });
        Assert.Equal("robot-structural-mcp", init.GetProperty("result").GetProperty("serverInfo").GetProperty("name").GetString());

        var tools = await Rpc(client, "tools/list", new { });
        var names = tools.GetProperty("result").GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToHashSet();
        foreach (var required in new[]
                 {
                     "robot_get_status", "robot_connect", "robot_get_project_info", "robot_save_project", "robot_save_project_as",
                     "get_nodes", "get_node", "get_bars", "get_bar", "get_panels", "get_sections", "get_materials", "get_supports",
                     "get_load_cases", "get_loads", "get_combinations", "get_model_summary",
                     "create_node", "create_nodes", "move_node", "delete_node", "create_bar", "create_bars", "update_bar", "delete_bar",
                     "create_panel", "delete_panel", "copy_elements", "move_elements", "divide_bar",
                     "get_material", "create_material", "update_material", "assign_material",
                     "get_section", "create_section", "update_section", "assign_section",
                     "create_support", "assign_support", "update_support", "delete_support", "create_bar_release", "assign_bar_release",
                     "create_load_case", "delete_load_case", "add_self_weight", "add_nodal_load", "add_bar_uniform_load", "add_bar_point_load",
                     "add_panel_load", "add_surface_load", "add_temperature_load", "delete_load",
                     "create_combination", "update_combination", "delete_combination", "generate_combinations",
                     "get_mesh_settings", "set_mesh_settings", "generate_mesh", "refine_mesh", "get_mesh_statistics", "check_model",
                     "run_analysis", "cancel_analysis", "get_analysis_status", "get_analysis_messages",
                     "get_node_displacements", "get_support_reactions", "get_bar_forces", "get_bar_displacements", "get_bar_stresses",
                     "get_bar_extremes", "get_panel_results", "get_result_envelope",
                     "check_steel_member", "design_steel_member", "check_rc_beam", "design_rc_beam", "check_rc_column", "design_rc_column",
                     "design_rc_slab", "design_foundation",
                     "create_3d_frame", "create_rc_building", "create_grid_structure", "apply_standard_building_loads", "analyze_structure",
                     "find_overstressed_members", "find_max_displacement", "find_max_reaction", "optimize_sections", "generate_structural_summary",
                     "begin_transaction", "commit_transaction", "rollback_transaction", "create_checkpoint", "restore_checkpoint",
                     "assign_sections", "apply_loads",
                 })
            Assert.Contains(required, names);

        var call = await Rpc(client, "tools/call", new { name = "robot_get_status", arguments = new { } });
        var structured = call.GetProperty("result").GetProperty("structuredContent");
        Assert.True(structured.GetProperty("success").GetBoolean());
        Assert.Equal("robot_get_status", structured.GetProperty("operation").GetString());

        var resources = await Rpc(client, "resources/list", new { });
        var uris = resources.GetProperty("result").GetProperty("resources").EnumerateArray().Select(r => r.GetProperty("uri").GetString()).ToList();
        foreach (var uri in new[] { "project://summary", "project://nodes", "project://bars", "project://sections", "project://materials", "project://load-cases", "project://combinations", "project://analysis-status" })
            Assert.Contains(uri, uris);
    }
}
