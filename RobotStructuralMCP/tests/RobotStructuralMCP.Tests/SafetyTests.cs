using System.Text.Json.Nodes;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Tools;
using Xunit;

namespace RobotStructuralMCP.Tests;

public class SafetyTests
{
    private static async Task CreateNodes(TestHost h, int count)
    {
        var nodes = Enumerable.Range(0, count).Select(i => new NodeInput { X = i, Y = 0, Z = 0 }).ToArray();
        (await Envelope.Of(h.Tool<GeometryTools>().CreateNodes(nodes, LengthUnit.m))).AssertSuccess();
    }

    [Fact]
    public async Task Mass_deletion_requires_explicit_two_step_confirmation()
    {
        using var h = new TestHost(o => o.MassDeletionThreshold = 3);
        await CreateNodes(h, 5);
        var geo = h.Tool<GeometryTools>();
        var ids = new[] { 1, 2, 3, 4, 5 };
        var first = await Envelope.Of(geo.DeleteNodes(ids));
        Assert.Equal("CONFIRMATION_REQUIRED", first.FirstErrorCode);
        Assert.Equal(5, h.Gateway.GetNodes().Count);
        var token = first.Data.GetProperty("confirmation_token").GetString();

        // Le jeton est lié aux paramètres : il ne permet pas de supprimer autre chose.
        var other = await Envelope.Of(geo.DeleteNodes(new[] { 1, 2, 3, 4 }, token));
        Assert.True(other.FirstErrorCode == "CONFIRMATION_INVALID", other.ToString());

        var again = await Envelope.Of(geo.DeleteNodes(ids));
        var token2 = again.Data.GetProperty("confirmation_token").GetString();
        (await Envelope.Of(geo.DeleteNodes(ids, token2))).AssertSuccess();
        Assert.Empty(h.Gateway.GetNodes());

        // Usage unique : même après recréation des nœuds, le jeton consommé est refusé.
        await CreateNodes(h, 5);
        Assert.Equal("CONFIRMATION_INVALID", (await Envelope.Of(geo.DeleteNodes(ids, token2))).FirstErrorCode);
    }

    [Fact]
    public async Task Read_only_policy_blocks_writes()
    {
        using var h = new TestHost(o => o.MaxLevel = SafetyLevel.Read);
        var env = await Envelope.Of(h.Tool<GeometryTools>().CreateNode(0, 0, 0, LengthUnit.m));
        Assert.Equal("SAFETY_LEVEL_FORBIDDEN", env.FirstErrorCode);
        (await Envelope.Of(h.Tool<ModelReadTools>().GetNodes())).AssertSuccess();
    }

    [Fact]
    public async Task Transaction_rollback_restores_model()
    {
        using var h = new TestHost();
        await CreateNodes(h, 2);
        var safety = h.Tool<SafetyTools>();
        (await Envelope.Of(safety.Begin("essai"))).AssertSuccess();
        await CreateNodes(h, 3);
        Assert.Equal(5, h.Gateway.GetNodes().Count);
        var ask = await Envelope.Of(safety.Rollback());
        Assert.Equal("CONFIRMATION_REQUIRED", ask.FirstErrorCode);
        (await Envelope.Of(safety.Rollback(ask.Data.GetProperty("confirmation_token").GetString()))).AssertSuccess();
        Assert.Equal(2, h.Gateway.GetNodes().Count);
    }

    [Fact]
    public async Task Complex_operations_create_automatic_checkpoint()
    {
        using var h = new TestHost();
        var env = (await Envelope.Of(h.Tool<HighLevelTools>().Create3DFrame(new double[] { 5 }, new double[] { 4 }, new double[] { 3 }, LengthUnit.m))).AssertSuccess();
        Assert.Contains("CHECKPOINT_CREATED", env.WarningCodes);
        Assert.Single(h.Services.GetService(typeof(CheckpointService)) is CheckpointService cs ? cs.List() : throw new Exception());
    }

    [Fact]
    public void Audit_log_redacts_secrets()
    {
        var p = JsonNode.Parse("""{"path":"a.rtd","api_key":"xyz","nested":{"Password":"p"},"confirmation_token":"confirm-1"}""");
        var r = JsonlAuditLog.Redact(p)!;
        Assert.Equal("***", r["api_key"]!.GetValue<string>());
        Assert.Equal("***", r["nested"]!["Password"]!.GetValue<string>());
        Assert.Equal("a.rtd", r["path"]!.GetValue<string>());
        Assert.Equal("confirm-1", r["confirmation_token"]!.GetValue<string>());
    }

    [Fact]
    public async Task Audit_entries_are_written_with_duration_and_modified_elements()
    {
        using var h = new TestHost();
        await CreateNodes(h, 2);
        var audit = (IAuditLog)h.Services.GetService(typeof(IAuditLog))!;
        var last = audit.Recent(1).Single();
        Assert.Equal("create_nodes", last.Tool);
        Assert.True(last.Success);
        Assert.Equal(2, last.ModifiedElements.Count);
        Assert.True(Directory.GetFiles(Path.Combine(h.Root, "logs"), "audit-*.jsonl").Length == 1);
    }
}
