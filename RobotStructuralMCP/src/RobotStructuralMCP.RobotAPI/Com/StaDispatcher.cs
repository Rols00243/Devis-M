using System.Collections.Concurrent;

namespace RobotStructuralMCP.RobotAPI.Com;

/// <summary>
/// Thread dédié qui exécute séquentiellement tous les appels COM vers Robot.
/// Les objets RobotOM sont créés et utilisés sur ce seul thread (règle d'appartement COM),
/// ce qui sérialise aussi les opérations : Robot n'est pas conçu pour des appels concurrents.
/// </summary>
public sealed class StaDispatcher : IDisposable
{
    private readonly BlockingCollection<Action> _queue = new();
    private readonly Thread _thread;
    private int _callsSinceCleanup;

    public StaDispatcher(bool sta = true)
    {
        _thread = new Thread(Run) { IsBackground = true, Name = "RobotOM-COM" };
        if (OperatingSystem.IsWindows())
            _thread.SetApartmentState(sta ? ApartmentState.STA : ApartmentState.MTA);
        _thread.Start();
    }

    public bool IsDispatcherThread => Thread.CurrentThread == _thread;

    private void Run()
    {
        foreach (var work in _queue.GetConsumingEnumerable())
            work();
    }

    public T Invoke<T>(Func<T> func)
    {
        if (IsDispatcherThread) return func();
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _queue.Add(() =>
        {
            try
            {
                tcs.SetResult(func());
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
            finally
            {
                // Les RCW intermédiaires créés par la liaison tardive sont libérés par le GC ;
                // on force périodiquement une collecte pour ne pas retenir d'objets dans Robot.
                if (++_callsSinceCleanup >= 50)
                {
                    _callsSinceCleanup = 0;
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                }
            }
        });
        return tcs.Task.GetAwaiter().GetResult();
    }

    public void Invoke(Action action) => Invoke(() => { action(); return true; });

    public void Dispose()
    {
        _queue.CompleteAdding();
        _thread.Join(TimeSpan.FromSeconds(5));
        _queue.Dispose();
    }
}
