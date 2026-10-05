using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.Safety;

/// <summary>
/// Confirmation explicite en deux temps des opérations destructives :
///  1. premier appel sans jeton → CONFIRMATION_REQUIRED + jeton + résumé de ce qui sera détruit ;
///  2. second appel avec le même jeton et les mêmes paramètres → exécution.
/// Le jeton est lié à l'opération ET à l'empreinte des paramètres : il ne peut pas servir à autre chose.
/// </summary>
public sealed class ConfirmationService
{
    private sealed record Pending(string Operation, string Fingerprint, DateTimeOffset Expires);

    private readonly ConcurrentDictionary<string, Pending> _pending = new();
    private readonly SafetyOptions _options;
    private readonly TimeProvider _time;

    public ConfirmationService(IOptions<SafetyOptions> options, TimeProvider? time = null)
    {
        _options = options.Value;
        _time = time ?? TimeProvider.System;
    }

    public static string Fingerprint(string canonicalParameters) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalParameters)))[..16];

    /// <summary>Lève <see cref="ConfirmationRequiredException"/> tant qu'un jeton valide n'est pas fourni.</summary>
    public void Require(string operation, string canonicalParameters, string? token, string summary, object? impact = null)
    {
        var fp = Fingerprint(canonicalParameters);
        var now = _time.GetUtcNow();
        foreach (var kv in _pending.Where(kv => kv.Value.Expires < now).ToList()) _pending.TryRemove(kv.Key, out _);

        if (!string.IsNullOrWhiteSpace(token))
        {
            if (_pending.TryRemove(token, out var p) && p.Operation == operation && p.Fingerprint == fp && p.Expires >= now)
                return;
            throw new RobotMcpException(ErrorCodes.ConfirmationInvalid,
                "Jeton de confirmation invalide, expiré, déjà utilisé ou associé à d'autres paramètres. Relancez l'appel sans jeton pour en obtenir un nouveau.");
        }

        var newToken = "confirm-" + Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        var expires = now.AddSeconds(_options.ConfirmationTtlSeconds);
        _pending[newToken] = new Pending(operation, fp, expires);
        throw new ConfirmationRequiredException(
            $"Opération DESTRUCTIVE « {operation} » : {summary} Demandez la confirmation explicite de l'utilisateur, puis rappelez le même tool " +
            "avec les mêmes paramètres et confirmation_token.",
            new { confirmation_token = newToken, expires_at = expires, summary, impact });
    }
}
