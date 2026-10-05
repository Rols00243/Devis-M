using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RobotStructuralMCP.Tools.Infrastructure;

public static class JsonDefaults
{
    /// <summary>Sérialisation des réponses : snake_case, compacte, nombres finis, caractères accentués non échappés.</summary>
    public static readonly JsonSerializerOptions Options = Create();

    /// <summary>Désérialisation des arguments des tools (et génération de leurs JSON Schema) : snake_case strict.</summary>
    public static readonly JsonSerializerOptions Input = CreateInput();

    private static JsonSerializerOptions CreateInput()
    {
        var o = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            NumberHandling = JsonNumberHandling.Strict,
        };
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
        o.TypeInfoResolver = new System.Text.Json.Serialization.Metadata.DefaultJsonTypeInfoResolver();
        return o;
    }

    private static JsonSerializerOptions Create()
    {
        var o = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DictionaryKeyPolicy = null,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            WriteIndented = false,
            NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };
        o.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
        return o;
    }
}
