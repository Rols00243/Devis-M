# Serveur MCP pour Robot Structural Analysis

Permet à Claude (Claude Desktop ou Claude Code) de piloter **Autodesk Robot Structural
Analysis** : créer des nœuds et des barres, lancer le calcul, lire les efforts.

> Windows uniquement : Robot s'automatise via son API COM (RobotOM), accessible seulement
> sur la machine où il est installé et sous licence.

## Installation

```
cd integrations\robot-mcp
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## Déclaration dans Claude Desktop

Dans `%APPDATA%\Claude\claude_desktop_config.json` (adaptez les chemins) :

```json
{
  "mcpServers": {
    "robot": {
      "command": "C:\\chemin\\Devis-M\\integrations\\robot-mcp\\.venv\\Scripts\\python.exe",
      "args": ["C:\\chemin\\Devis-M\\integrations\\robot-mcp\\robot_mcp.py"]
    }
  }
}
```

Redémarrez Claude Desktop : les outils `robot` apparaissent.

## Déclaration dans Claude Code

```
claude mcp add robot -- C:\chemin\...\.venv\Scripts\python.exe C:\chemin\...\robot_mcp.py
```

## Outils exposés

| Outil            | Rôle                                                        |
|------------------|-------------------------------------------------------------|
| `structure_info` | Nombre de nœuds, barres, cas de charge ; résultats dispo ?  |
| `create_node`    | Crée un nœud (x, y, z en m)                                 |
| `create_bar`     | Crée une barre entre deux nœuds existants                   |
| `run_analysis`   | Lance le calcul                                             |
| `bar_forces`     | Efforts N, Vy, Vz, Mx, My, Mz d'une barre pour un cas       |

Exemple de demande : « Dans Robot, crée un portique de 6 m de portée et 3 m de haut,
lance le calcul et donne-moi le moment en milieu de traverse pour le cas 1. »

## Notes

- Robot est lancé (ou récupéré s'il est déjà ouvert) au premier appel d'outil.
- Ouvrez ou créez un projet dans Robot avant de créer des éléments.
- Les efforts sont retournés dans les unités de base de Robot (N, N·m).
- Les noms des méthodes COM peuvent varier selon la version de Robot : en cas d'erreur,
  vérifiez dans la documentation SDK livrée avec Robot.
