namespace RobotStructuralMCP.Safety;

/// <summary>Niveaux d'action des tools.</summary>
public enum SafetyLevel
{
    /// <summary>Consultation uniquement.</summary>
    Read = 0,
    /// <summary>Création et modification.</summary>
    Write = 1,
    /// <summary>Suppression massive, écrasement, restauration, fermeture sans sauvegarde, reset.</summary>
    Destructive = 2,
}

/// <summary>Configuration de sécurité (section « Safety » d'appsettings.json).</summary>
public sealed class SafetyOptions
{
    public const string SectionName = "Safety";

    /// <summary>Niveau maximal autorisé : Read, Write ou Destructive.</summary>
    public SafetyLevel MaxLevel { get; set; } = SafetyLevel.Destructive;

    /// <summary>Au-delà de ce nombre d'éléments supprimés en un appel, la suppression devient DESTRUCTIVE (confirmation requise).</summary>
    public int MassDeletionThreshold { get; set; } = 10;

    /// <summary>Durée de validité d'un jeton de confirmation (secondes).</summary>
    public int ConfirmationTtlSeconds { get; set; } = 300;

    /// <summary>Dossier des checkpoints (copies complètes du projet).</summary>
    public string CheckpointDirectory { get; set; } = "checkpoints";

    /// <summary>Créer automatiquement un checkpoint avant toute opération complexe ou destructive.</summary>
    public bool AutoCheckpoint { get; set; } = true;

    /// <summary>Nombre maximal de checkpoints conservés (les plus anciens sont supprimés).</summary>
    public int MaxCheckpoints { get; set; } = 20;

    /// <summary>Dossier du journal d'audit (JSON Lines).</summary>
    public string AuditLogDirectory { get; set; } = "logs";

    /// <summary>Nombre maximal d'éléments par appel batch.</summary>
    public int MaxBatchSize { get; set; } = 5000;
}
