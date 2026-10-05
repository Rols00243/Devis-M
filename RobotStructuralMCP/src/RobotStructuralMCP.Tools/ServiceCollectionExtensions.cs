using Microsoft.Extensions.DependencyInjection;
using RobotStructuralMCP.Core.Units;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools;

public static class ServiceCollectionExtensions
{
    /// <summary>Enregistre les services métier des tools (la passerelle IRobotGateway est enregistrée par l'hôte).</summary>
    public static IServiceCollection AddRobotMcpServices(this IServiceCollection services)
    {
        services.AddSingleton<UnitService>();
        services.AddSingleton<ConfirmationService>();
        services.AddSingleton<CheckpointService>();
        services.AddSingleton<TransactionService>();
        services.AddSingleton<IAuditLog, JsonlAuditLog>();
        services.AddSingleton<ToolRunner>();
        services.AddSingleton<AnalysisTracker>();
        services.AddSingleton<ProposalStore>();
        services.AddSingleton<ModelService>();
        services.AddSingleton<ModelChecker>();
        services.AddSingleton<ResultService>();
        services.AddSingleton<LoadService>();
        services.AddSingleton<CombinationService>();
        services.AddSingleton<StructureBuilder>();
        services.AddSingleton<SummaryService>();
        return services;
    }
}
