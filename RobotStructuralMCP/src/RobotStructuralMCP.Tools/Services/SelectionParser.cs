using System.Globalization;
using System.Text.RegularExpressions;
using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.Tools.Services;

/// <summary>Analyse la syntaxe de sélection Robot : « 1 2 5to10 20to30by5 ».</summary>
public static partial class SelectionParser
{
    [GeneratedRegex(@"^(?<a>\d+)\s*(to|à|-)\s*(?<b>\d+)(\s*by\s*(?<s>\d+))?$", RegexOptions.IgnoreCase)]
    private static partial Regex Range();

    public static IReadOnlyList<int> Parse(string? text)
    {
        var result = new SortedSet<int>();
        if (string.IsNullOrWhiteSpace(text)) return Array.Empty<int>();
        var normalized = Regex.Replace(text.Trim(), @"\s*(to|by)\s*", m => $" {m.Value.Trim()} ", RegexOptions.IgnoreCase);
        var tokens = normalized.Split(new[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries).ToList();
        for (int i = 0; i < tokens.Count; i++)
        {
            var t = tokens[i];
            if (i + 2 < tokens.Count && tokens[i + 1].Equals("to", StringComparison.OrdinalIgnoreCase))
            {
                int a = ParseInt(t), b = ParseInt(tokens[i + 2]), step = 1;
                i += 2;
                if (i + 2 < tokens.Count && tokens[i + 1].Equals("by", StringComparison.OrdinalIgnoreCase))
                {
                    step = ParseInt(tokens[i + 2]);
                    i += 2;
                }
                if (step <= 0 || b < a) throw new ValidationException($"Plage de sélection invalide « {a} to {b} by {step} ».");
                if ((b - a) / step > 1_000_000) throw new ValidationException("Plage de sélection trop grande.");
                for (int v = a; v <= b; v += step) result.Add(v);
                continue;
            }
            var m = Range().Match(t);
            if (m.Success)
            {
                int a = int.Parse(m.Groups["a"].Value, CultureInfo.InvariantCulture), b = int.Parse(m.Groups["b"].Value, CultureInfo.InvariantCulture);
                int s = m.Groups["s"].Success ? int.Parse(m.Groups["s"].Value, CultureInfo.InvariantCulture) : 1;
                if (b < a || s <= 0) throw new ValidationException($"Plage de sélection invalide « {t} ».");
                for (int v = a; v <= b; v += s) result.Add(v);
                continue;
            }
            result.Add(ParseInt(t));
        }
        return result.ToList();
    }

    private static int ParseInt(string s) =>
        int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) && v > 0
            ? v
            : throw new ValidationException($"Élément de sélection invalide « {s} » (entier positif attendu).");

    public static string Format(IEnumerable<int> ids) => string.Join(" ", ids);
}
