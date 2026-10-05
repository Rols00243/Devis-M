namespace RobotStructuralMCP.Core.Errors;

/// <summary>Codes d'erreur stables exposés aux clients MCP.</summary>
public static class ErrorCodes
{
    public const string ValidationFailed = "VALIDATION_FAILED";
    public const string NotFound = "NOT_FOUND";
    public const string AlreadyExists = "ALREADY_EXISTS";
    public const string UnitError = "UNIT_ERROR";
    public const string RobotNotRunning = "ROBOT_NOT_RUNNING";
    public const string RobotNotConnected = "ROBOT_NOT_CONNECTED";
    public const string RobotConnectionLost = "ROBOT_CONNECTION_LOST";
    public const string RobotBusy = "ROBOT_BUSY";
    public const string RobotComError = "ROBOT_COM_ERROR";
    public const string RobotApiMemberNotFound = "ROBOT_API_MEMBER_NOT_FOUND";
    public const string RobotEnumNotFound = "ROBOT_ENUM_NOT_FOUND";
    public const string NoActiveProject = "NO_ACTIVE_PROJECT";
    public const string PlatformNotSupported = "PLATFORM_NOT_SUPPORTED";
    public const string NotSupportedByApi = "NOT_SUPPORTED_BY_ROBOT_API";
    public const string NotSupportedInSimulation = "NOT_SUPPORTED_IN_SIMULATION";
    public const string AnalysisFailed = "ANALYSIS_FAILED";
    public const string AnalysisRunning = "ANALYSIS_RUNNING";
    public const string ResultsUnavailable = "RESULTS_UNAVAILABLE";
    public const string SafetyLevelForbidden = "SAFETY_LEVEL_FORBIDDEN";
    public const string ConfirmationRequired = "CONFIRMATION_REQUIRED";
    public const string ConfirmationInvalid = "CONFIRMATION_INVALID";
    public const string CheckpointFailed = "CHECKPOINT_FAILED";
    public const string TransactionError = "TRANSACTION_ERROR";
    public const string Internal = "INTERNAL_ERROR";
}
