using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Responses;
using RobotStructuralMCP.Safety;

namespace RobotStructuralMCP.Tools.Infrastructure;

/// <summary>
/// Exécuteur commun à tous les tools :
/// contrôle du niveau de sécurité → verrou d'exécution → checkpoint automatique éventuel → exécution →
/// enveloppe standard { success, operation, data, warnings, errors } → journal d'audit.
/// </summary>
public sealed class ToolRunner
{
    private readonly IRobotGateway _gateway;
    private readonly SafetyOptions _safety;
    private readonly CheckpointService _checkpoints;
    private readonly TransactionService _transactions;
    private readonly IAuditLog _audit;
    private readonly ILogger<ToolRunner> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public ToolRunner(IRobotGateway gateway, IOptions<SafetyOptions> safety, CheckpointService checkpoints,
        TransactionService transactions, IAuditLog audit, ILogger<ToolRunner> logger)
    {
        _gateway = gateway;
        _safety = safety.Value;
        _checkpoints = checkpoints;
        _transactions = transactions;
        _audit = audit;
        _logger = logger;
    }

    public SafetyOptions Safety => _safety;

    public Task<CallToolResult> RunAsync(string operation, SafetyLevel level, object? parameters,
        Func<OperationContext, object?> body, RunOptions? options = null) =>
        RunAsync(operation, level, parameters, ctx => Task.FromResult(body(ctx)), options);

    public async Task<CallToolResult> RunAsync(string operation, SafetyLevel level, object? parameters,
        Func<OperationContext, Task<object?>> body, RunOptions? options = null)
    {
        var envelope = await ExecuteAsync(operation, level, parameters, body, options).ConfigureAwait(false);
        return ToResult(envelope);
    }

    /// <summary>Exécution brute (utilisée aussi par les ressources MCP et les tests).</summary>
    public async Task<McpEnvelope> ExecuteAsync(string operation, SafetyLevel level, object? parameters,
        Func<OperationContext, Task<object?>> body, RunOptions? options = null)
    {
        options ??= new RunOptions();
        var ctx = new OperationContext(operation);
        var sw = Stopwatch.StartNew();
        object? data = null;
        var errors = new List<McpError>();
        object? failureData = null;
        bool locked = false;
        try
        {
            if (level > _safety.MaxLevel)
                throw new RobotMcpException(ErrorCodes.SafetyLevelForbidden,
                    $"« {operation} » est de niveau {level.ToString().ToUpperInvariant()} alors que la configuration limite le serveur au niveau {_safety.MaxLevel.ToString().ToUpperInvariant()} (Safety:MaxLevel).");

            if (!options.BypassLock)
            {
                await _lock.WaitAsync().ConfigureAwait(false);
                locked = true;
            }

            if (options.Checkpoint && _safety.AutoCheckpoint && level >= SafetyLevel.Write)
            {
                try
                {
                    var cp = await Task.Run(() => _checkpoints.Create(operation, "auto")).ConfigureAwait(false);
                    ctx.CheckpointId = cp.Id;
                }
                catch (RobotMcpException ex)
                {
                    ctx.Warn(ErrorCodes.CheckpointFailed, $"Checkpoint automatique impossible ({ex.Message}). L'opération continue sans point de restauration.");
                }
            }

            // Les appels Robot sont bloquants (COM) : exécution hors du thread de la requête.
            data = await Task.Run(() => body(ctx)).ConfigureAwait(false);
            if (level >= SafetyLevel.Write) _transactions.Record(operation);
        }
        catch (ValidationException vex)
        {
            errors.AddRange(vex.Errors);
        }
        catch (LimitationException lex)
        {
            errors.Add(new McpError(lex.Code, lex.Message));
            failureData = lex.Details;
        }
        catch (ConfirmationRequiredException cex)
        {
            errors.Add(cex.ToError());
            failureData = cex.Details;
        }
        catch (RobotMcpException rex)
        {
            errors.Add(rex.ToError());
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erreur inattendue dans {Operation}", operation);
            errors.Add(new McpError(ErrorCodes.Internal, $"{ex.GetType().Name} : {ex.Message}"));
        }
        finally
        {
            if (locked) _lock.Release();
            sw.Stop();
        }

        var success = errors.Count == 0;
        var warnings = ctx.Warnings.ToList();
        if (ctx.CheckpointId is not null)
            warnings.Add(new McpWarning("CHECKPOINT_CREATED", $"Checkpoint automatique {ctx.CheckpointId} créé avant l'opération (restore_checkpoint pour revenir en arrière)."));

        var envelope = new McpEnvelope
        {
            Success = success,
            Operation = operation,
            Data = success ? data : failureData,
            Warnings = warnings,
            Errors = errors,
            ModifiedElements = ctx.ModifiedElements.Count > 0 ? ctx.ModifiedElements : null,
            DurationMs = sw.ElapsedMilliseconds,
        };

        Audit(operation, level, parameters, envelope, ctx);
        return envelope;
    }

    private void Audit(string operation, SafetyLevel level, object? parameters, McpEnvelope envelope, OperationContext ctx)
    {
        try
        {
            JsonNode? p = parameters is null ? null : JsonSerializer.SerializeToNode(parameters, JsonDefaults.Options);
            string? project = null;
            try
            {
                project = _gateway.CurrentProjectPath;
            }
            catch
            {
                // non bloquant
            }
            _audit.Write(new AuditEntry(DateTimeOffset.UtcNow, operation, level.ToString().ToUpperInvariant(), p, project, envelope.Success,
                envelope.Success ? Summarize(envelope.Data) : null,
                envelope.Errors.Select(e => $"{e.Code}: {e.Message}").ToList(), envelope.DurationMs, ctx.ModifiedElements, ctx.CheckpointId));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Audit impossible pour {Operation}", operation);
        }
    }

    private static string? Summarize(object? data)
    {
        if (data is null) return null;
        var json = JsonSerializer.Serialize(data, JsonDefaults.Options);
        return json.Length <= 300 ? json : json[..300] + "…";
    }

    public static CallToolResult ToResult(McpEnvelope envelope)
    {
        var element = JsonSerializer.SerializeToElement(envelope, JsonDefaults.Options);
        return new CallToolResult
        {
            Content = new List<ContentBlock> { new TextContentBlock { Text = element.GetRawText() } },
            StructuredContent = element,
            IsError = !envelope.Success,
        };
    }
}
