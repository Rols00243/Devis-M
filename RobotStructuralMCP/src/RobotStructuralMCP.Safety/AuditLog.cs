using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace RobotStructuralMCP.Safety;

public sealed record AuditEntry(
    DateTimeOffset Timestamp,
    string Tool,
    string Level,
    JsonNode? Parameters,
    string? Project,
    bool Success,
    string? ResultSummary,
    IReadOnlyList<string> Errors,
    long DurationMs,
    IReadOnlyList<string> ModifiedElements,
    string? CheckpointId);

public interface IAuditLog
{
    void Write(AuditEntry entry);
    IReadOnlyList<AuditEntry> Recent(int count);
}

/// <summary>
/// Journal d'audit en JSON Lines (un fichier par jour) + mémoire tampon des dernières entrées.
/// Les paramètres sont expurgés de tout secret (clés contenant password, secret, token, apikey, authorization…),
/// sauf les jetons de confirmation qui ne sont pas des secrets (usage unique, liés aux paramètres).
/// </summary>
public sealed partial class JsonlAuditLog : IAuditLog
{
    private readonly string _directory;
    private readonly ILogger<JsonlAuditLog> _logger;
    private readonly object _lock = new();
    private readonly LinkedList<AuditEntry> _recent = new();
    private const int RecentCapacity = 200;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        WriteIndented = false,
    };

    public JsonlAuditLog(IOptions<SafetyOptions> options, ILogger<JsonlAuditLog> logger)
    {
        _directory = options.Value.AuditLogDirectory;
        _logger = logger;
    }

    [GeneratedRegex("(pass(word)?|secret|api[_-]?key|authorization|bearer|credential|^token$|access[_-]?token)", RegexOptions.IgnoreCase)]
    private static partial Regex SecretKey();

    /// <summary>Copie expurgée des paramètres (récursif).</summary>
    public static JsonNode? Redact(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                var copy = new JsonObject();
                foreach (var (key, value) in obj)
                    copy[key] = SecretKey().IsMatch(key) && key != "confirmation_token" ? JsonValue.Create("***") : Redact(value?.DeepClone());
                return copy;
            case JsonArray arr:
                var a = new JsonArray();
                // Les gros batchs sont tronqués dans le journal (on garde le nombre d'éléments).
                foreach (var item in arr.Take(50)) a.Add(Redact(item?.DeepClone()));
                if (arr.Count > 50) a.Add(JsonValue.Create($"… {arr.Count - 50} élément(s) supplémentaire(s)"));
                return a;
            default:
                return node?.DeepClone();
        }
    }

    public void Write(AuditEntry entry)
    {
        entry = entry with { Parameters = Redact(entry.Parameters) };
        lock (_lock)
        {
            _recent.AddLast(entry);
            if (_recent.Count > RecentCapacity) _recent.RemoveFirst();
            try
            {
                Directory.CreateDirectory(_directory);
                var file = Path.Combine(_directory, $"audit-{entry.Timestamp:yyyyMMdd}.jsonl");
                File.AppendAllText(file, JsonSerializer.Serialize(entry, Json) + Environment.NewLine);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Écriture du journal d'audit impossible");
            }
        }
        _logger.LogInformation("tool={Tool} success={Success} duration_ms={Duration} modified={Modified} errors={Errors}",
            entry.Tool, entry.Success, entry.DurationMs, entry.ModifiedElements.Count, string.Join("; ", entry.Errors));
    }

    public IReadOnlyList<AuditEntry> Recent(int count)
    {
        lock (_lock) return _recent.Reverse().Take(count).ToList();
    }
}
