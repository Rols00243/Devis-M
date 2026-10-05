using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.CSharp.RuntimeBinder;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.RobotAPI.Com;

/// <summary>
/// Implémentation RobotOM (COM, liaison tardive) de <see cref="IRobotGateway"/>.
///
/// Principes :
///  - aucun Interop.RobotOM.dll requis à la compilation ; les membres sont appelés via IDispatch ;
///  - les valeurs d'énumérations sont résolues par NOM dans la bibliothèque de types de l'instance
///    installée (RobotTypeLibrary) : un nom absent produit ROBOT_ENUM_NOT_FOUND, jamais une valeur devinée ;
///  - un membre absent produit ROBOT_API_MEMBER_NOT_FOUND (DISP_E_UNKNOWNNAME), jamais un résultat inventé ;
///  - tous les appels passent par un thread COM dédié (StaDispatcher).
/// </summary>
public sealed partial class RobotComGateway : IRobotGateway, IDisposable
{
    private readonly RobotOptions _options;
    private readonly ILogger<RobotComGateway> _logger;
    private readonly StaDispatcher _sta;
    private readonly RobotTypeLibrary _typeLib = new();
    private dynamic? _app;
    private string? _userProjectPath;

    public RobotComGateway(IOptions<RobotOptions> options, ILogger<RobotComGateway> logger)
    {
        _options = options.Value;
        _logger = logger;
        _sta = new StaDispatcher(!string.Equals(_options.Apartment, "MTA", StringComparison.OrdinalIgnoreCase));
    }

    public string BackendName => "RobotOM (COM)";

    public string? CurrentProjectPath => _userProjectPath;

    // ------------------------------------------------------------------------------------
    // Infrastructure
    // ------------------------------------------------------------------------------------

    private dynamic App => _app ?? throw new RobotMcpException(ErrorCodes.RobotNotConnected,
        "Non connecté à Robot. Appelez d'abord robot_connect.");

    private dynamic Structure => App.Project.Structure;

    private int E(string enumType, string member) => _typeLib.EnumValue(enumType, member);

    private static int I(object? o) => Convert.ToInt32(o, CultureInfo.InvariantCulture);
    private static double D(object? o) => Convert.ToDouble(o, CultureInfo.InvariantCulture);
    private static bool B(object? o) => o is bool b ? b : Convert.ToInt32(o, CultureInfo.InvariantCulture) != 0;
    private static string S(object? o) => Convert.ToString(o, CultureInfo.InvariantCulture) ?? "";

    private static string Ids(IEnumerable<int> ids) => string.Join(" ", ids.Select(i => i.ToString(CultureInfo.InvariantCulture)));

    /// <summary>Exécute une opération RobotOM sur le thread COM avec traduction d'erreurs et ré-essais si Robot est occupé.</summary>
    private T Call<T>(string operation, Func<T> body, bool requireConnection = true)
    {
        EnsurePlatform();
        return _sta.Invoke(() =>
        {
            if (requireConnection && _app is null)
                throw new RobotMcpException(ErrorCodes.RobotNotConnected, "Non connecté à Robot. Appelez d'abord robot_connect.");
            var delay = _options.BusyRetryDelayMs;
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    return body();
                }
                catch (Exception ex)
                {
                    var root = Unwrap(ex);
                    if (root is COMException busy && IsBusy(busy.HResult) && attempt < _options.BusyRetries)
                    {
                        _logger.LogDebug("Robot occupé pendant {Operation}, nouvel essai dans {Delay} ms", operation, delay);
                        Thread.Sleep(delay);
                        delay *= 2;
                        continue;
                    }
                    throw Translate(operation, root);
                }
            }
        });
    }

    private void Call(string operation, Action body) => Call(operation, () => { body(); return true; });

    private static Exception Unwrap(Exception ex)
    {
        while (ex is TargetInvocationException { InnerException: { } inner }) ex = inner;
        return ex;
    }

    private static bool IsBusy(int hr) => hr is NativeMethods.RPC_E_SERVERCALL_RETRYLATER or NativeMethods.RPC_E_CALL_REJECTED;

    private Exception Translate(string operation, Exception ex)
    {
        switch (ex)
        {
            case RobotMcpException:
                return ex;
            case RuntimeBinderException rbe:
                return new RobotMcpException(ErrorCodes.RobotApiMemberNotFound,
                    $"{operation} : membre RobotOM inaccessible ({rbe.Message}). Vérifiez avec robot_verify_api.", null, ex);
            case COMException com when com.HResult is NativeMethods.DISP_E_UNKNOWNNAME or NativeMethods.DISP_E_MEMBERNOTFOUND:
                return new RobotMcpException(ErrorCodes.RobotApiMemberNotFound,
                    $"{operation} : membre RobotOM absent de la version installée ({com.Message}). Vérifiez avec robot_verify_api.", null, ex);
            case COMException com when com.HResult is NativeMethods.RPC_E_DISCONNECTED or NativeMethods.RPC_S_SERVER_UNAVAILABLE
                                           or NativeMethods.RPC_S_CALL_FAILED or NativeMethods.CO_E_OBJNOTCONNECTED:
                ReleaseApp();
                return new RobotMcpException(ErrorCodes.RobotConnectionLost,
                    $"{operation} : connexion à Robot perdue (HRESULT 0x{com.HResult:X8}). Robot a peut-être été fermé ; appelez robot_connect.", null, ex);
            case COMException com when IsBusy(com.HResult):
                return new RobotMcpException(ErrorCodes.RobotBusy,
                    $"{operation} : Robot est occupé (boîte de dialogue ouverte ou calcul en cours). Fermez les dialogues Robot puis réessayez.", null, ex);
            case COMException com:
                return new RobotMcpException(ErrorCodes.RobotComError,
                    $"{operation} : Robot a renvoyé une erreur COM 0x{com.HResult:X8} : {com.Message}", new { hresult = $"0x{com.HResult:X8}" }, ex);
            case InvalidCastException or ArgumentException or InvalidOperationException:
                return new RobotMcpException(ErrorCodes.RobotComError, $"{operation} : {ex.Message}", null, ex);
            default:
                return new RobotMcpException(ErrorCodes.Internal, $"{operation} : {ex.GetType().Name} : {ex.Message}", null, ex);
        }
    }

    private static void EnsurePlatform()
    {
        if (!OperatingSystem.IsWindows())
            throw new RobotMcpException(ErrorCodes.PlatformNotSupported,
                "RobotOM (COM) n'est disponible que sous Windows, sur la machine où Robot Structural Analysis est installé. " +
                "Utilisez Robot:Mode=Simulation pour développer hors Windows.");
    }

    /// <summary>Lit un membre optionnel ; renvoie null si absent ou en erreur (utilisé uniquement pour des informations facultatives).</summary>
    private T? Try<T>(Func<T> f)
    {
        try
        {
            return f();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Lecture facultative RobotOM échouée");
            return default;
        }
    }

    private void ReleaseApp()
    {
        if (_app is not null && OperatingSystem.IsWindows())
        {
            try
            {
                object o = _app;
                if (Marshal.IsComObject(o)) Marshal.FinalReleaseComObject(o);
            }
            catch
            {
                // L'objet peut déjà être déconnecté.
            }
        }
        _app = null;
    }

    public void Dispose()
    {
        try
        {
            _sta.Invoke(ReleaseApp);
        }
        finally
        {
            _sta.Dispose();
        }
    }

    // ------------------------------------------------------------------------------------
    // Connexion / projet
    // ------------------------------------------------------------------------------------

    private Process? FindRobotProcess()
    {
        try
        {
            return Process.GetProcessesByName(_options.ProcessName).FirstOrDefault();
        }
        catch
        {
            return null;
        }
    }

    private static string? ProcessVersion(Process? p)
    {
        try
        {
            return p?.MainModule?.FileVersionInfo.ProductVersion;
        }
        catch
        {
            return null;
        }
    }

    public RobotStatus GetStatus()
    {
        if (!OperatingSystem.IsWindows())
            return new RobotStatus(BackendName, false, false, null, false, false, null, null, null,
                "Plate-forme non Windows : RobotOM indisponible. Utilisez le mode Simulation ou exécutez le serveur sous Windows.");

        var proc = FindRobotProcess();
        var version = ProcessVersion(proc);
        if (_app is null)
            return new RobotStatus(BackendName, true, proc is not null, proc?.Id, false, false, version, null, null,
                proc is null ? "Robot n'est pas ouvert." : "Robot est ouvert mais le serveur n'y est pas connecté (robot_connect).");

        try
        {
            return Call("robot_get_status", () =>
            {
                dynamic project = App.Project;
                bool active = Try<bool>(() => B(project.IsActive)) || !string.IsNullOrEmpty(Try<string>(() => S(project.Name)));
                string? name = Try<string>(() => S(project.Name));
                string? path = Try<string>(() => S(project.FileName));
                return new RobotStatus(BackendName, true, proc is not null, proc?.Id, true, active, version, name,
                    string.IsNullOrEmpty(path) ? null : path,
                    active ? "Connecté à Robot, projet actif." : "Connecté à Robot, aucun projet actif.");
            });
        }
        catch (RobotMcpException ex) when (ex.Code == ErrorCodes.RobotConnectionLost)
        {
            return new RobotStatus(BackendName, true, proc is not null, proc?.Id, false, false, version, null, null, ex.Message);
        }
    }

    public RobotStatus Connect(bool launchIfNotRunning)
    {
        EnsurePlatform();
        var launch = launchIfNotRunning && _options.LaunchIfNotRunning;
        Call("robot_connect", () =>
        {
            ReleaseApp();
            var proc = FindRobotProcess();
            var hr = NativeMethods.CLSIDFromProgID(_options.ProgId, out var clsid);
            if (hr != 0)
                throw new RobotMcpException(ErrorCodes.RobotNotRunning,
                    $"Le ProgID COM « {_options.ProgId} » n'est pas enregistré : Robot Structural Analysis n'est pas installé (ou son enregistrement COM est cassé).");

            object? app = null;
            if (proc is not null)
            {
                // 1) instance enregistrée dans la ROT ; 2) sinon, CoCreateInstance se rattache à l'instance en cours
                //    (comportement documenté de RobotApplication : une seule instance de Robot par session).
                if (NativeMethods.GetActiveObject(ref clsid, IntPtr.Zero, out var active) == 0) app = active;
                app ??= Activator.CreateInstance(Type.GetTypeFromCLSID(clsid, true)!);
            }
            else if (launch)
            {
                app = Activator.CreateInstance(Type.GetTypeFromCLSID(clsid, true)!);
                dynamic d = app!;
                if (_options.MakeVisibleOnLaunch)
                {
                    d.Visible = 1;
                    d.Interactive = 1;
                }
                Try(() => { d.UserControl = true; return true; });
            }
            else
            {
                throw new RobotMcpException(ErrorCodes.RobotNotRunning,
                    "Robot Structural Analysis n'est pas ouvert. Ouvrez Robot et un projet, puis relancez robot_connect " +
                    "(ou autorisez Robot:LaunchIfNotRunning et passez launch_if_not_running=true).");
            }

            _app = app;
            LoadTypeLibrary(app!);
            _userProjectPath = NullIfEmpty(Try<string>(() => S(App.Project.FileName)));
            return true;
        }, requireConnection: false);
        return GetStatus();
    }

    private void LoadTypeLibrary(object app)
    {
        try
        {
            _typeLib.LoadFromObject(app);
        }
        catch (Exception ex) when (!string.IsNullOrWhiteSpace(_options.TypeLibraryPath))
        {
            _logger.LogWarning(ex, "Lecture de la bibliothèque de types depuis l'instance impossible, repli sur {Path}", _options.TypeLibraryPath);
            _typeLib.LoadFromFile(_options.TypeLibraryPath!);
        }
    }

    private static string? NullIfEmpty(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    public void Disconnect() => Call("robot_disconnect", () => { ReleaseApp(); return true; }, requireConnection: false);

    private void EnsureActiveProject()
    {
        dynamic project = App.Project;
        bool active = Try<bool>(() => B(project.IsActive));
        if (!active && string.IsNullOrEmpty(Try<string>(() => S(project.Name))))
            throw new RobotMcpException(ErrorCodes.NoActiveProject, "Aucun projet n'est ouvert dans Robot.");
    }

    public ProjectInfo GetProjectInfo() => Call("get_project_info", () =>
    {
        EnsureActiveProject();
        dynamic project = App.Project;
        var notes = new List<string>();
        var typeValue = Try(() => (int?)I(project.Type));
        var type = typeValue is null ? "inconnu" : _typeLib.EnumName("IRobotProjectType", typeValue.Value);
        var codes = new Dictionary<string, string>();
        // Normes actives : lues uniquement si l'API les expose (IRobotProjectPreferences.GetActiveCode) — jamais supposées.
        foreach (var codeType in new[] { "I_CT_CODE_COMBINATIONS", "I_CT_STEEL", "I_CT_RC_THEORETICAL_REINF", "I_CT_RC_REAL_REINF", "I_CT_LOADS", "I_CT_TIMBER" })
        {
            if (!_typeLib.TryEnumValue("IRobotCodeType", codeType, out var ct)) continue;
            var code = Try<string>(() => S(project.Preferences.GetActiveCode(ct)));
            if (!string.IsNullOrWhiteSpace(code)) codes[codeType] = code!;
        }
        if (codes.Count == 0)
            notes.Add("Normes actives non lisibles via l'API sur cette version : aucune norme n'est supposée.");
        var path = NullIfEmpty(Try<string>(() => S(project.FileName)));
        if (path is not null && _userProjectPath is not null && !string.Equals(path, _userProjectPath, StringComparison.OrdinalIgnoreCase))
            notes.Add($"Le fichier ouvert dans Robot est un checkpoint ({path}) ; robot_save_project enregistrera dans {_userProjectPath}.");
        var version = ProcessVersion(FindRobotProcess());
        return new ProjectInfo(S(project.Name), path ?? _userProjectPath, type, true,
            Try<bool>(() => B(project.Structure.Results.Available)), version, codes, notes);
    });

    public void SaveProject() => Call("robot_save_project", () =>
    {
        EnsureActiveProject();
        dynamic project = App.Project;
        var current = NullIfEmpty(Try<string>(() => S(project.FileName)));
        if (_userProjectPath is null && current is null)
            throw new RobotMcpException(ErrorCodes.ValidationFailed, "Le projet n'a jamais été enregistré : utilisez robot_save_project_as avec un chemin .rtd.");
        if (_userProjectPath is not null && !string.Equals(current, _userProjectPath, StringComparison.OrdinalIgnoreCase))
            project.SaveAs(_userProjectPath);
        else
            project.Save();
        return true;
    });

    public void SaveProjectAs(string path) => Call("robot_save_project_as", () =>
    {
        EnsureActiveProject();
        App.Project.SaveAs(path);
        _userProjectPath = path;
        return true;
    });

    public void WriteCheckpoint(string path) => Call("create_checkpoint", () =>
    {
        EnsureActiveProject();
        // RobotOM n'offre pas de transaction native : on écrit une copie complète du projet (.rtd).
        // Conséquence : Robot travaille ensuite sur le fichier checkpoint ; robot_save_project
        // ré-enregistre explicitement vers le fichier utilisateur mémorisé.
        App.Project.SaveAs(path);
        return true;
    });

    public void RestoreCheckpoint(string path) => Call("restore_checkpoint", () =>
    {
        dynamic app = App;
        var interactive = Try<int>(() => I(app.Interactive));
        try
        {
            app.Interactive = 0; // pas de boîte de dialogue « enregistrer les modifications ? »
            app.Project.Open(path);
        }
        finally
        {
            Try(() => { app.Interactive = interactive; return true; });
        }
        return true;
    });
}
