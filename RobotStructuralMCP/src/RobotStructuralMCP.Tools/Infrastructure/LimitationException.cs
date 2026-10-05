using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.Tools.Infrastructure;

/// <summary>
/// Opération impossible via l'API Robot : renvoyée avec success=false, le code NOT_SUPPORTED_BY_ROBOT_API
/// et, dans data, la limitation, les données disponibles et la proposition de module externe.
/// </summary>
public sealed class LimitationException : RobotMcpException
{
    public LimitationException(string message, object data)
        : base(ErrorCodes.NotSupportedByApi, message, data) { }
}
