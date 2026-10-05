# Connecter ChatGPT (et d'autres clients MCP)

Le serveur expose le protocole MCP en **Streamable HTTP** (`http://127.0.0.1:3001/mcp` par défaut) et en **stdio**
(`--stdio`). Robot doit tourner **sur le même poste Windows** que le serveur.

## 1. Démarrer le serveur sur le poste Robot

```powershell
.\scripts\Publish.ps1                       # compile, teste, publie dans .\publish
$env:Server__PathSecret = "<chaine-aleatoire-longue>"   # recommandé dès que le serveur est exposé
.\publish\RobotStructuralMCP.Server.exe     # écoute sur http://127.0.0.1:3001
```

Le serveur n'écoute **que sur 127.0.0.1**. Pour ChatGPT (service cloud), il faut une **URL HTTPS publique** vers ce
port : utilisez un tunnel (par exemple Cloudflare Tunnel ou ngrok) :

```powershell
cloudflared tunnel --url http://127.0.0.1:3001
# ou : ngrok http 3001
```

## 2. Ajouter le connecteur dans ChatGPT

Dans ChatGPT, activez le **mode développeur** des connecteurs/apps (paramètres → Apps & Connectors → paramètres
avancés), puis créez un connecteur MCP personnalisé :

* **URL du serveur** : `https://<votre-tunnel>/mcp/<PathSecret>` ;
* **Authentification** : aucune (la protection repose alors sur le segment secret de l'URL — voir §3) ;
* faites confiance au connecteur, puis activez-le dans la conversation.

> L'interface de ChatGPT évolue : si un libellé diffère, reportez-vous à la documentation OpenAI sur les connecteurs
> MCP personnalisés. Le serveur suit la spécification MCP (transport Streamable HTTP, `tools`, `resources`).

Exemple de première demande : « Connecte-toi au projet actuellement ouvert dans Robot et donne-moi un résumé du
modèle. » → ChatGPT appelle `robot_connect` puis `get_model_summary`.

## 3. Sécurité de l'exposition

| Mécanisme | Réglage | Usage |
|---|---|---|
| Écoute locale uniquement | `Server:Urls = http://127.0.0.1:3001` | Défaut. Ne pas écouter sur `0.0.0.0`. |
| Segment secret d'URL | `Server:PathSecret` (variable `Server__PathSecret`) | Clients sans en-tête d'authentification (connecteur ChatGPT sans OAuth). |
| Clé d'API | `Server:ApiKey` (variable `Server__ApiKey`) ; en-tête `Authorization: Bearer …` ou `X-Api-Key` | API Responses d'OpenAI (`headers`), scripts, autres clients. |
| Niveau maximal | `Safety:MaxLevel = Read | Write | Destructive` | Ex. `Read` pour une démonstration en lecture seule. |
| Confirmation en deux temps | toujours active pour les opérations DESTRUCTIVES | Jeton à usage unique, lié aux paramètres, valable 5 min. |

Ne committez jamais `ApiKey` ni `PathSecret` : utilisez des variables d'environnement. Le journal d'audit expurge les
paramètres sensibles. OAuth n'est pas implémenté dans cette version.

## 4. API Responses d'OpenAI

Voir `config/openai-responses-mcp-tool.example.json` (outil `type: "mcp"` avec `server_url` et en-tête
`Authorization`). Gardez `require_approval: "always"` tant que vous découvrez le serveur.

## 5. Clients stdio (Claude Desktop, Codex CLI, etc.)

Voir `config/claude_desktop_config.example.json` : `RobotStructuralMCP.Server.exe --stdio`. En stdio, les journaux
partent sur stderr ; stdout est réservé au protocole.
