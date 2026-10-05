using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.RobotAPI;
using RobotStructuralMCP.RobotAPI.Com;
using RobotStructuralMCP.RobotAPI.Simulation;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Server;
using RobotStructuralMCP.Tools;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Tools;

var stdio = args.Contains("--stdio");
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args.Where(a => a != "--stdio").ToArray(),
    ContentRootPath = AppContext.BaseDirectory,
});
builder.Configuration.AddEnvironmentVariables("ROBOTMCP_");

// En stdio, stdout est réservé au protocole MCP : tous les journaux vont sur stderr.
builder.Logging.ClearProviders();
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);

builder.Services.Configure<RobotOptions>(builder.Configuration.GetSection(RobotOptions.SectionName));
builder.Services.Configure<SafetyOptions>(builder.Configuration.GetSection(SafetyOptions.SectionName));
builder.Services.PostConfigure<SafetyOptions>(o =>
{
    // Chemins relatifs résolus par rapport au dossier de l'exécutable.
    if (!Path.IsPathRooted(o.CheckpointDirectory)) o.CheckpointDirectory = Path.Combine(AppContext.BaseDirectory, o.CheckpointDirectory);
    if (!Path.IsPathRooted(o.AuditLogDirectory)) o.AuditLogDirectory = Path.Combine(AppContext.BaseDirectory, o.AuditLogDirectory);
});
var serverOptions = builder.Configuration.GetSection(ServerOptions.SectionName).Get<ServerOptions>() ?? new ServerOptions();

var mode = builder.Configuration["Robot:Mode"] ?? "Com";
if (string.Equals(mode, "Simulation", StringComparison.OrdinalIgnoreCase))
    builder.Services.AddSingleton<IRobotGateway, SimulationGateway>();
else
    builder.Services.AddSingleton<IRobotGateway, RobotComGateway>();
builder.Services.AddRobotMcpServices();

var mcp = builder.Services.AddMcpServer(o =>
{
    o.ServerInfo = new Implementation { Name = "robot-structural-mcp", Title = "Autodesk Robot Structural Analysis (MCP)", Version = "0.1.0" };
    o.ServerInstructions = ServerInstructions.Text;
});
mcp.WithToolsFromAssembly(typeof(ConnectionTools).Assembly, JsonDefaults.Input)
   .WithResourcesFromAssembly(typeof(ConnectionTools).Assembly);

if (stdio)
{
    mcp.WithStdioServerTransport();
    var host = builder.Build();
    LogStartup(host, mode, "stdio");
    await host.RunAsync();
    return;
}

mcp.WithHttpTransport();
builder.WebHost.UseUrls(serverOptions.Urls);
var app = builder.Build();

var mcpPath = "/" + serverOptions.McpPath.Trim('/');
if (!string.IsNullOrWhiteSpace(serverOptions.PathSecret)) mcpPath += "/" + serverOptions.PathSecret.Trim('/');

// Authentification optionnelle par clé d'API (comparaison à temps constant).
if (!string.IsNullOrWhiteSpace(serverOptions.ApiKey))
{
    var expected = System.Text.Encoding.UTF8.GetBytes(serverOptions.ApiKey);
    app.Use(async (ctx, next) =>
    {
        if (ctx.Request.Path.StartsWithSegments(mcpPath))
        {
            var header = ctx.Request.Headers.Authorization.ToString();
            var provided = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..] : ctx.Request.Headers["X-Api-Key"].ToString();
            var bytes = System.Text.Encoding.UTF8.GetBytes(provided);
            if (bytes.Length != expected.Length || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(bytes, expected))
            {
                ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
        }
        await next();
    });
}

app.MapGet("/health", (IRobotGateway g) => Results.Ok(new { status = "ok", backend = g.BackendName }));
app.MapMcp(mcpPath);
LogStartup(app, mode, $"Streamable HTTP {serverOptions.Urls}{(string.IsNullOrWhiteSpace(serverOptions.PathSecret) ? mcpPath : serverOptions.McpPath + "/<secret>")}");
await app.RunAsync();

static void LogStartup(IHost host, string mode, string transport)
{
    var logger = host.Services.GetRequiredService<ILoggerFactory>().CreateLogger("RobotStructuralMCP");
    var safety = host.Services.GetRequiredService<IOptions<SafetyOptions>>().Value;
    logger.LogInformation("RobotStructuralMCP démarré — mode Robot : {Mode}, transport : {Transport}, niveau max : {Level}, OS : {Os}",
        mode, transport, safety.MaxLevel, System.Runtime.InteropServices.RuntimeInformation.OSDescription);
}

public partial class Program;
