namespace RobotStructuralMCP.Server;

public sealed class ServerOptions
{
    public const string SectionName = "Server";

    /// <summary>Adresse d'écoute. Par défaut uniquement en local (127.0.0.1).</summary>
    public string Urls { get; set; } = "http://127.0.0.1:3001";

    /// <summary>Chemin de l'endpoint MCP (Streamable HTTP).</summary>
    public string McpPath { get; set; } = "/mcp";

    /// <summary>Clé d'API exigée (en-tête « Authorization: Bearer … » ou « X-Api-Key »). Vide = pas de contrôle. Ne jamais la committer : variable d'environnement Server__ApiKey.</summary>
    public string? ApiKey { get; set; }

    /// <summary>Segment secret ajouté au chemin MCP (/mcp/&lt;secret&gt;) pour les clients ne sachant pas envoyer d'en-tête (connecteurs ChatGPT sans OAuth).</summary>
    public string? PathSecret { get; set; }
}
