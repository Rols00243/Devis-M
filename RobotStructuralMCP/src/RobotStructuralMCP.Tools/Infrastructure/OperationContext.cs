using RobotStructuralMCP.Core.Responses;
using RobotStructuralMCP.Safety;

namespace RobotStructuralMCP.Tools.Infrastructure;

/// <summary>Contexte d'exécution d'un tool : avertissements, éléments modifiés, checkpoint éventuel.</summary>
public sealed class OperationContext
{
    private readonly List<McpWarning> _warnings = new();
    private readonly List<string> _modified = new();

    public OperationContext(string operation) => Operation = operation;

    public string Operation { get; }
    public string? CheckpointId { get; internal set; }
    public IReadOnlyList<McpWarning> Warnings => _warnings;
    public IReadOnlyList<string> ModifiedElements => _modified;

    public void Warn(string code, string message, string? elementId = null) => _warnings.Add(new McpWarning(code, message, elementId));

    public void Touch(string kind, IEnumerable<int> ids) => _modified.AddRange(ids.Select(i => $"{kind}:{i}"));

    public void Touch(string kind, string id) => _modified.Add($"{kind}:{id}");
}

/// <summary>Options d'exécution d'un tool.</summary>
public sealed record RunOptions
{
    /// <summary>Opération complexe : checkpoint automatique avant exécution (si Safety:AutoCheckpoint).</summary>
    public bool Checkpoint { get; init; }
    /// <summary>Ne pas attendre le verrou global (lectures d'état pendant un calcul).</summary>
    public bool BypassLock { get; init; }
}
