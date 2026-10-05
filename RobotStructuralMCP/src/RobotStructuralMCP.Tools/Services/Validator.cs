using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Responses;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>Collecte d'erreurs de validation : toutes les erreurs sont renvoyées en une fois, avant tout appel à Robot.</summary>
public sealed class Validator
{
    private readonly List<McpError> _errors = new();

    /// <summary>Bornes de plausibilité (SI).</summary>
    public static class Limits
    {
        public const double MaxCoordinate = 10_000;      // m
        public const double MinSectionDim = 0.005;       // m
        public const double MaxSectionDim = 10;          // m
        public const double MinThickness = 0.01;         // m
        public const double MaxThickness = 5;            // m
        public const double MaxBarLength = 500;          // m
        public const double MinE = 1e6, MaxE = 1e13;     // Pa
        public const double MaxUnitWeight = 2e5;         // N/m³
    }

    public bool HasErrors => _errors.Count > 0;

    public Validator Error(string message, string code = ErrorCodes.ValidationFailed, object? details = null)
    {
        _errors.Add(new McpError(code, message, details));
        return this;
    }

    public Validator Require(bool condition, string message, string code = ErrorCodes.ValidationFailed)
    {
        if (!condition) Error(message, code);
        return this;
    }

    public Validator Finite(double v, string name) => Require(double.IsFinite(v), $"{name} doit être un nombre fini (reçu {v}).");

    public Validator Positive(double v, string name) => Require(double.IsFinite(v) && v > 0, $"{name} doit être strictement positif (reçu {v}).");

    public Validator Range(double v, double min, double max, string name, string unit) =>
        Require(double.IsFinite(v) && v >= min && v <= max, $"{name} = {v} {unit} hors du domaine plausible [{min} ; {max}] {unit}.");

    public Validator Coordinate(double v, string name) =>
        Require(double.IsFinite(v) && Math.Abs(v) <= Limits.MaxCoordinate, $"Coordonnée {name} = {v} m invalide (|valeur| ≤ {Limits.MaxCoordinate} m).");

    public Validator Id(int? id, string name) => Require(id is null || id > 0, $"{name} doit être un entier strictement positif (reçu {id}).");

    public Validator NotEmpty(string? s, string name) => Require(!string.IsNullOrWhiteSpace(s), $"{name} est obligatoire.");

    public Validator NotEmpty<T>(IReadOnlyCollection<T>? items, string name) => Require(items is { Count: > 0 }, $"{name} ne doit pas être vide.");

    public void ThrowIfAny()
    {
        if (_errors.Count > 0) throw new ValidationException(_errors.ToList());
    }
}
