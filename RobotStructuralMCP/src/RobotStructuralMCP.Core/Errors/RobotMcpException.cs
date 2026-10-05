using RobotStructuralMCP.Core.Responses;

namespace RobotStructuralMCP.Core.Errors;

/// <summary>Exception métier portant un code d'erreur stable.</summary>
public class RobotMcpException : Exception
{
    public string Code { get; }
    public object? Details { get; }

    public RobotMcpException(string code, string message, object? details = null, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        Details = details;
    }

    public McpError ToError() => new(Code, Message, Details);
}

/// <summary>Erreurs de validation multiples (toutes collectées avant l'envoi à Robot).</summary>
public sealed class ValidationException : RobotMcpException
{
    public IReadOnlyList<McpError> Errors { get; }

    public ValidationException(IReadOnlyList<McpError> errors)
        : base(ErrorCodes.ValidationFailed, string.Join(" | ", errors.Select(e => e.Message)))
    {
        Errors = errors;
    }

    public ValidationException(string message, string code = ErrorCodes.ValidationFailed)
        : this(new[] { new McpError(code, message) }) { }
}

/// <summary>Opération destructive en attente de confirmation explicite.</summary>
public sealed class ConfirmationRequiredException : RobotMcpException
{
    public ConfirmationRequiredException(string message, object details)
        : base(ErrorCodes.ConfirmationRequired, message, details) { }
}
