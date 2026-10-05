namespace RobotStructuralMCP.RobotAPI;

/// <summary>Configuration de la connexion à Robot (section « Robot » d'appsettings.json).</summary>
public sealed class RobotOptions
{
    public const string SectionName = "Robot";

    /// <summary>« Com » (Robot réel via RobotOM) ou « Simulation » (modèle en mémoire, sans solveur).</summary>
    public string Mode { get; set; } = "Com";

    /// <summary>ProgID COM de l'application Robot.</summary>
    public string ProgId { get; set; } = "Robot.Application";

    /// <summary>Nom du processus Robot (sans .exe).</summary>
    public string ProcessName { get; set; } = "robot";

    /// <summary>Autoriser le lancement de Robot s'il n'est pas ouvert (désactivé par défaut).</summary>
    public bool LaunchIfNotRunning { get; set; }

    /// <summary>Rendre visible une instance lancée par le serveur.</summary>
    public bool MakeVisibleOnLaunch { get; set; } = true;

    /// <summary>Chemin optionnel vers robotom.tlb / Interop.RobotOM.dll si la bibliothèque de types ne peut être lue depuis l'instance.</summary>
    public string? TypeLibraryPath { get; set; }

    /// <summary>Appartement COM du thread dédié : « STA » (recommandé) ou « MTA ».</summary>
    public string Apartment { get; set; } = "STA";

    /// <summary>Nombre de nouvelles tentatives quand Robot répond « occupé » (RPC_E_SERVERCALL_RETRYLATER).</summary>
    public int BusyRetries { get; set; } = 5;

    /// <summary>Délai initial entre tentatives (ms), doublé à chaque essai.</summary>
    public int BusyRetryDelayMs { get; set; } = 200;

    /// <summary>
    /// Valeurs de IRobotBarEndReleaseValue utilisées pour un degré de liberté relâché / non relâché.
    /// À VÉRIFIER sur la version installée (voir docs/ROBOTOM_API.md) : configurables sans recompiler.
    /// </summary>
    public string ReleaseReleasedValue { get; set; } = "I_BERV_FIXED";
    public string ReleaseConnectedValue { get; set; } = "I_BERV_NONE";

    /// <summary>
    /// Identifiants de résultats éléments finis demandés pour get_panel_results (noms de l'énumération
    /// IRobotFeResultType). Les noms absents de la bibliothèque de types installée sont ignorés avec un avertissement.
    /// </summary>
    public string[] PanelResultIds { get; set; } =
    {
        "I_FRT_DETAILED_NXX", "I_FRT_DETAILED_NYY", "I_FRT_DETAILED_NXY",
        "I_FRT_DETAILED_MXX", "I_FRT_DETAILED_MYY", "I_FRT_DETAILED_MXY",
        "I_FRT_DETAILED_QXX", "I_FRT_DETAILED_QYY",
    };
}
