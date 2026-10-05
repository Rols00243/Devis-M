using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.Safety;

public sealed record TransactionInfo(string Id, string Label, DateTimeOffset StartedAt, string CheckpointId, IReadOnlyList<string> Operations);

/// <summary>
/// Transactions logiques au-dessus des checkpoints : begin = checkpoint, rollback = restauration, commit = abandon du checkpoint.
/// Une seule transaction active à la fois (Robot n'a qu'un modèle courant).
/// </summary>
public sealed class TransactionService
{
    private readonly CheckpointService _checkpoints;
    private readonly object _lock = new();
    private string? _id;
    private string? _label;
    private DateTimeOffset _started;
    private string? _checkpointId;
    private readonly List<string> _operations = new();

    public TransactionService(CheckpointService checkpoints) => _checkpoints = checkpoints;

    public TransactionInfo? Current
    {
        get
        {
            lock (_lock)
                return _id is null ? null : new TransactionInfo(_id, _label!, _started, _checkpointId!, _operations.ToList());
        }
    }

    public void Record(string operation)
    {
        lock (_lock)
            if (_id is not null) _operations.Add($"{DateTimeOffset.UtcNow:HH:mm:ss} {operation}");
    }

    public TransactionInfo Begin(string label)
    {
        lock (_lock)
        {
            if (_id is not null)
                throw new RobotMcpException(ErrorCodes.TransactionError, $"Une transaction est déjà active ({_id}, « {_label} »). Validez-la ou annulez-la d'abord.");
            var cp = _checkpoints.Create("tx_" + label, "begin_transaction");
            _id = "tx-" + cp.Id;
            _label = label;
            _started = DateTimeOffset.UtcNow;
            _checkpointId = cp.Id;
            _operations.Clear();
            return Current!;
        }
    }

    public TransactionInfo Commit(bool keepCheckpoint)
    {
        lock (_lock)
        {
            var tx = Current ?? throw new RobotMcpException(ErrorCodes.TransactionError, "Aucune transaction active.");
            if (!keepCheckpoint) _checkpoints.Delete(tx.CheckpointId);
            Clear();
            return tx;
        }
    }

    public TransactionInfo Rollback()
    {
        lock (_lock)
        {
            var tx = Current ?? throw new RobotMcpException(ErrorCodes.TransactionError, "Aucune transaction active.");
            _checkpoints.Restore(tx.CheckpointId);
            Clear();
            return tx;
        }
    }

    private void Clear()
    {
        _id = null;
        _label = null;
        _checkpointId = null;
        _operations.Clear();
    }
}
