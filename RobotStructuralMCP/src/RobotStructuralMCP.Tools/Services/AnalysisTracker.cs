using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>
/// Suivi du calcul. CalcEngine.Calculate() est synchrone et bloque Robot : on l'exécute en tâche de fond
/// pour pouvoir répondre « en cours » si le calcul dépasse le délai d'attente du client.
/// </summary>
public sealed class AnalysisTracker
{
    public sealed record Snapshot(string State, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, double? DurationS,
        bool? ResultsAvailable, int? ReturnCode, IReadOnlyList<string> Messages, string? Error);

    private readonly object _lock = new();
    private string _state = "idle";
    private DateTimeOffset? _started, _finished;
    private AnalysisRunResult? _result;
    private string? _error;
    private Task? _task;

    public Snapshot Current
    {
        get
        {
            lock (_lock)
                return new Snapshot(_state, _started, _finished,
                    _started is null ? null : Math.Round(((_finished ?? DateTimeOffset.UtcNow) - _started.Value).TotalSeconds, 1),
                    _result?.ResultsAvailable, _result?.ReturnCode, _result?.Messages ?? Array.Empty<string>(), _error);
        }
    }

    public bool IsRunning
    {
        get
        {
            lock (_lock) return _state == "running";
        }
    }

    /// <summary>Lance le calcul ; attend au plus <paramref name="wait"/>. Renvoie l'état atteint.</summary>
    public async Task<Snapshot> RunAsync(IRobotGateway gateway, TimeSpan wait)
    {
        Task task;
        lock (_lock)
        {
            if (_state == "running")
                throw new RobotMcpException(ErrorCodes.AnalysisRunning, "Un calcul est déjà en cours (get_analysis_status).");
            _state = "running";
            _started = DateTimeOffset.UtcNow;
            _finished = null;
            _result = null;
            _error = null;
            task = _task = Task.Run(() =>
            {
                try
                {
                    var r = gateway.RunAnalysis();
                    lock (_lock)
                    {
                        _result = r;
                        _state = r.Success ? "succeeded" : "failed";
                        if (!r.Success) _error = "Robot n'a produit aucun résultat : le calcul a échoué (voir messages).";
                    }
                }
                catch (Exception ex)
                {
                    lock (_lock)
                    {
                        _state = "failed";
                        _error = ex is RobotMcpException rex ? $"{rex.Code}: {rex.Message}" : ex.Message;
                    }
                }
                finally
                {
                    lock (_lock) _finished = DateTimeOffset.UtcNow;
                }
            });
        }
        await Task.WhenAny(task, Task.Delay(wait)).ConfigureAwait(false);
        return Current;
    }

    public Task? Pending => _task;
}
