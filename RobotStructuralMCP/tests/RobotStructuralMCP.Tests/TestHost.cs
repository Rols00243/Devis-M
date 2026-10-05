using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Protocol;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.RobotAPI.Simulation;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools;

namespace RobotStructuralMCP.Tests;

/// <summary>Conteneur de test : passerelle de simulation + tous les services, dossiers temporaires isolés.</summary>
public sealed class TestHost : IDisposable
{
    public ServiceProvider Services { get; }
    public SimulationGateway Gateway { get; }
    public string Root { get; }

    public TestHost(Action<SafetyOptions>? configure = null)
    {
        Root = Path.Combine(Path.GetTempPath(), "robotmcp-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
        var services = new ServiceCollection();
        services.AddLogging(b => b.SetMinimumLevel(LogLevel.Warning));
        services.Configure<SafetyOptions>(o =>
        {
            o.CheckpointDirectory = Path.Combine(Root, "checkpoints");
            o.AuditLogDirectory = Path.Combine(Root, "logs");
            configure?.Invoke(o);
        });
        services.AddSingleton<SimulationGateway>();
        services.AddSingleton<IRobotGateway>(sp => sp.GetRequiredService<SimulationGateway>());
        services.AddRobotMcpServices();
        Services = services.BuildServiceProvider();
        Gateway = Services.GetRequiredService<SimulationGateway>();
        Gateway.Connect(false);
    }

    public T Tool<T>() where T : class => ActivatorUtilities.CreateInstance<T>(Services);

    public void Dispose()
    {
        Services.Dispose();
        try
        {
            Directory.Delete(Root, true);
        }
        catch
        {
            // best effort
        }
    }
}

/// <summary>Lecture de l'enveloppe standard renvoyée par un tool.</summary>
public sealed class Envelope
{
    public JsonElement Root { get; }

    public Envelope(CallToolResult result)
    {
        Root = result.StructuredContent!.Value;
        IsError = result.IsError == true;
    }

    public bool IsError { get; }
    public bool Success => Root.GetProperty("success").GetBoolean();
    public JsonElement Data => Root.GetProperty("data");
    public string? FirstErrorCode => Root.GetProperty("errors").EnumerateArray().Select(e => e.GetProperty("code").GetString()).FirstOrDefault();
    public IEnumerable<string> WarningCodes => Root.GetProperty("warnings").EnumerateArray().Select(e => e.GetProperty("code").GetString()!);
    public override string ToString() => Root.GetRawText();

    public Envelope AssertSuccess()
    {
        Xunit.Assert.True(Success, ToString());
        Xunit.Assert.False(IsError);
        return this;
    }

    public static async Task<Envelope> Of(Task<CallToolResult> call) => new(await call);
}
