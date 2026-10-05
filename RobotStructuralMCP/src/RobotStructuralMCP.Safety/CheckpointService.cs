using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.Safety;

public sealed record CheckpointInfo(string Id, string Label, DateTimeOffset CreatedAt, string Path, string? ProjectPath, string Reason);

/// <summary>
/// Checkpoints : RobotOM ne fournit pas de transaction native ; on écrit une copie complète du projet
/// (fichier .rtd via Project.SaveAs en mode COM, instantané JSON en simulation) que l'on peut recharger.
/// </summary>
public sealed class CheckpointService
{
    private readonly IRobotGateway _gateway;
    private readonly SafetyOptions _options;
    private readonly ILogger<CheckpointService> _logger;
    private readonly ConcurrentDictionary<string, CheckpointInfo> _checkpoints = new();
    private int _counter;

    public CheckpointService(IRobotGateway gateway, IOptions<SafetyOptions> options, ILogger<CheckpointService> logger)
    {
        _gateway = gateway;
        _options = options.Value;
        _logger = logger;
    }

    public IReadOnlyList<CheckpointInfo> List() => _checkpoints.Values.OrderByDescending(c => c.CreatedAt).ToList();

    public CheckpointInfo Create(string label, string reason)
    {
        var id = $"cp{Interlocked.Increment(ref _counter):D3}-{DateTimeOffset.UtcNow:yyyyMMddHHmmss}";
        var ext = _gateway.BackendName.StartsWith("RobotOM", StringComparison.Ordinal) ? ".rtd" : ".json";
        var dir = Path.GetFullPath(_options.CheckpointDirectory);
        Directory.CreateDirectory(dir);
        var safeLabel = new string(label.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
        if (safeLabel.Length > 40) safeLabel = safeLabel[..40];
        var path = Path.Combine(dir, $"{id}_{safeLabel}{ext}");
        try
        {
            _gateway.WriteCheckpoint(path);
        }
        catch (RobotMcpException ex)
        {
            throw new RobotMcpException(ErrorCodes.CheckpointFailed, $"Création du checkpoint impossible : {ex.Message}", ex.Details, ex);
        }
        var info = new CheckpointInfo(id, label, DateTimeOffset.UtcNow, path, _gateway.CurrentProjectPath, reason);
        _checkpoints[id] = info;
        Prune();
        return info;
    }

    public CheckpointInfo Restore(string id)
    {
        if (!_checkpoints.TryGetValue(id, out var info))
            throw new RobotMcpException(ErrorCodes.NotFound, $"Checkpoint « {id} » inconnu. Utilisez list_checkpoints.");
        if (!File.Exists(info.Path))
            throw new RobotMcpException(ErrorCodes.CheckpointFailed, $"Fichier de checkpoint introuvable : {info.Path}");
        _gateway.RestoreCheckpoint(info.Path);
        return info;
    }

    public CheckpointInfo? Get(string id) => _checkpoints.TryGetValue(id, out var c) ? c : null;

    public void Delete(string id)
    {
        if (_checkpoints.TryRemove(id, out var info))
        {
            try
            {
                File.Delete(info.Path);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Suppression du checkpoint {Path} impossible", info.Path);
            }
        }
    }

    private void Prune()
    {
        foreach (var old in _checkpoints.Values.OrderByDescending(c => c.CreatedAt).Skip(Math.Max(1, _options.MaxCheckpoints)).ToList())
            Delete(old.Id);
    }
}
