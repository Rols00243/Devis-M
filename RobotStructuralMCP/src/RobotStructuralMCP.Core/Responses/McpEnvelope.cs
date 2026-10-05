using System.Text.Json.Serialization;

namespace RobotStructuralMCP.Core.Responses;

/// <summary>Erreur structurée renvoyée au client MCP.</summary>
public sealed record McpError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("details")] object? Details = null);

/// <summary>Avertissement structuré (non bloquant).</summary>
public sealed record McpWarning(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("element_id")] string? ElementId = null);

/// <summary>
/// Enveloppe standard de toutes les réponses des tools :
/// { success, operation, data, warnings, errors }.
/// </summary>
public sealed class McpEnvelope
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("operation")] public string Operation { get; init; } = "";
    [JsonPropertyName("data")] public object? Data { get; init; }
    [JsonPropertyName("warnings")] public IReadOnlyList<McpWarning> Warnings { get; init; } = Array.Empty<McpWarning>();
    [JsonPropertyName("errors")] public IReadOnlyList<McpError> Errors { get; init; } = Array.Empty<McpError>();
    [JsonPropertyName("modified_elements")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<string>? ModifiedElements { get; init; }
    [JsonPropertyName("duration_ms")] public long DurationMs { get; init; }

    public static McpEnvelope Ok(string operation, object? data, IReadOnlyList<McpWarning>? warnings = null) =>
        new() { Success = true, Operation = operation, Data = data, Warnings = warnings ?? Array.Empty<McpWarning>() };

    public static McpEnvelope Fail(string operation, IReadOnlyList<McpError> errors, IReadOnlyList<McpWarning>? warnings = null, object? data = null) =>
        new() { Success = false, Operation = operation, Data = data, Errors = errors, Warnings = warnings ?? Array.Empty<McpWarning>() };
}
