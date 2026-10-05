# RobotStructuralMCP

Serveur **MCP (Model Context Protocol)** en C#/.NET 8 qui permet à ChatGPT (ou à tout client MCP) de **piloter
Autodesk Robot Structural Analysis Professional** depuis une conversation : lire le modèle, créer et modifier la
structure, appliquer charges et combinaisons, lancer le calcul, extraire les résultats, vérifier les barres acier et
produire des synthèses — avec unités explicites, validation stricte, confirmations pour les actions destructives,
checkpoints et journal d'audit.

> **État (v0.1.0)** — La solution compile sans avertissement et **47 tests automatisés passent** (unités, validation,
> sécurité, scénarios complets et protocole MCP HTTP) en **mode Simulation**. Le mode **Com** (Robot réel) a été écrit
> contre l'API RobotOM mais **n'a pas encore été exécuté sur un poste équipé de Robot** : la première étape sur la
> machine Windows est `scripts\Inspect-RobotEnvironment.ps1` puis `robot_verify_api` (voir
> [docs/ROBOTOM_API.md](docs/ROBOTOM_API.md)).

## Sommaire

1. [Architecture](#architecture)
2. [Prérequis](#prérequis)
3. [Démarrage rapide](#démarrage-rapide)
4. [Configuration](#configuration)
5. [Catalogue des tools](#catalogue-des-tools)
6. [Ressources MCP](#ressources-mcp)
7. [Réponses, unités, sécurité, journalisation](#réponses-unités-sécurité-journalisation)
8. [Exemple de conversation](#exemple-de-conversation)
9. [Tests](#tests)
10. [Limitations et suite](#limitations-et-suite)

## Architecture

```
RobotStructuralMCP/
├─ src/
│  ├─ RobotStructuralMCP.Core       Modèles (SI), IRobotGateway, UnitService, enveloppe de réponse, codes d'erreur
│  ├─ RobotStructuralMCP.RobotAPI   RobotComGateway (RobotOM via COM/IDispatch, thread STA dédié, lecture de la
│  │                                typelib installée, inventaire RobotApiManifest) + SimulationGateway (en mémoire)
│  ├─ RobotStructuralMCP.Safety     Niveaux READ/WRITE/DESTRUCTIVE, confirmations, checkpoints, transactions, audit
│  ├─ RobotStructuralMCP.Tools      119 tools MCP + 8 ressources, services métier (validation, vérification du
│  │                                modèle, combinaisons EN 1990, résultats, générateurs de structures)
│  └─ RobotStructuralMCP.Server     Hôte ASP.NET Core : Streamable HTTP (/mcp) ou stdio (--stdio), config, auth
├─ tests/RobotStructuralMCP.Tests   xUnit (simulation + intégration HTTP MCP)
├─ scripts/                         Inspect-RobotEnvironment.ps1, Publish.ps1, Smoke-Test.ps1
├─ config/                          Exemples de configuration client (Claude Desktop, API Responses OpenAI)
└─ docs/                            ROBOTOM_API.md (référencement, vérification, limitations), CHATGPT.md
```

Flux d'un appel :

```
client MCP ──► tool (schéma JSON strict) ──► ToolRunner
                 │  niveau de sécurité ≤ Safety:MaxLevel ?  sinon SAFETY_LEVEL_FORBIDDEN
                 │  verrou d'exécution (une opération Robot à la fois)
                 │  checkpoint automatique (opérations complexes)
                 ▼
            services (validation complète AVANT toute écriture, conversions d'unités → SI)
                 ▼
            IRobotGateway ──► RobotComGateway ──► thread COM ──► Robot (RobotOM)
                          └─► SimulationGateway (tests / hors Windows, sans solveur)
                 ▼
            enveloppe { success, operation, data, warnings, errors } + audit JSONL
```

Choix structurants (détaillés dans [docs/ROBOTOM_API.md](docs/ROBOTOM_API.md)) :

* **Pas de dépendance de compilation à `Interop.RobotOM.dll`** : appels en liaison tardive ; les **valeurs
  d'énumérations sont lues par nom dans la bibliothèque de types de la version installée** — aucune valeur devinée.
* Un membre RobotOM absent produit `ROBOT_API_MEMBER_NOT_FOUND`, jamais un résultat inventé ; `robot_verify_api` audite
  l'ensemble des membres utilisés.
* Les fonctions que RobotOM n'expose pas de façon vérifiable (ferraillage BA, fondations, annulation de calcul…)
  renvoient `NOT_SUPPORTED_BY_ROBOT_API` avec les données disponibles et une proposition de module externe.

## Prérequis

| Élément | Mode Com (Robot réel) | Mode Simulation |
|---|---|---|
| OS | Windows 10/11 x64 | Windows, Linux, macOS |
| Robot Structural Analysis Professional | 2020 ou plus récent (64 bits), installé et activé | — |
| .NET | SDK 8 pour compiler ; runtime ASP.NET Core 8 pour exécuter | idem |

## Démarrage rapide

```powershell
# 1. Inspecter le poste (version de Robot, x64/x86, ProgID, typelib RobotOM, SDK .NET)
powershell -ExecutionPolicy Bypass -File .\scripts\Inspect-RobotEnvironment.ps1

# 2. Compiler, tester, publier
.\scripts\Publish.ps1

# 3. Ouvrir Robot et un projet, puis lancer le serveur
.\publish\RobotStructuralMCP.Server.exe            # Streamable HTTP sur http://127.0.0.1:3001/mcp

# 4. Test de fumée (connexion, infos projet, vérification de l'API installée, résumé)
.\scripts\Smoke-Test.ps1 -WriteTest                # -WriteTest : création puis rollback d'une barre de test
```

Sans Robot (développement, CI) :

```bash
dotnet test
Robot__Mode=Simulation dotnet run --project src/RobotStructuralMCP.Server            # HTTP
Robot__Mode=Simulation dotnet run --project src/RobotStructuralMCP.Server -- --stdio # stdio
```

Connexion de ChatGPT (tunnel HTTPS, segment secret d'URL, mode développeur) : **[docs/CHATGPT.md](docs/CHATGPT.md)**.

## Configuration

`src/RobotStructuralMCP.Server/appsettings.json`, surchargeable par variables d'environnement (`Section__Cle`, ou
préfixe `ROBOTMCP_`).

| Clé | Défaut | Rôle |
|---|---|---|
| `Server:Urls` | `http://127.0.0.1:3001` | Adresse d'écoute (local uniquement par défaut). |
| `Server:McpPath` | `/mcp` | Endpoint MCP. |
| `Server:ApiKey` | vide | Clé exigée (`Authorization: Bearer` ou `X-Api-Key`). **Variable d'environnement uniquement.** |
| `Server:PathSecret` | vide | Segment secret : endpoint `/mcp/<secret>`. |
| `Robot:Mode` | `Com` | `Com` (RobotOM) ou `Simulation`. |
| `Robot:ProgId` / `Robot:ProcessName` | `Robot.Application` / `robot` | Identification de Robot. |
| `Robot:LaunchIfNotRunning` | `false` | Autorise `robot_connect(launch_if_not_running=true)` à lancer Robot. |
| `Robot:TypeLibraryPath` | vide | Secours : chemin de `robotom.tlb`. |
| `Robot:Apartment` | `STA` | Appartement du thread COM. |
| `Robot:BusyRetries` / `BusyRetryDelayMs` | `5` / `200` | Ré-essais quand Robot répond « occupé ». |
| `Robot:ReleaseReleasedValue` / `ReleaseConnectedValue` | `I_BERV_FIXED` / `I_BERV_NONE` | Sémantique des relâchements (à confirmer, cf. docs). |
| `Robot:PanelResultIds` | `I_FRT_DETAILED_*` | Résultats lus pour `get_panel_results`. |
| `Safety:MaxLevel` | `Destructive` | `Read`, `Write` ou `Destructive`. |
| `Safety:MassDeletionThreshold` | `10` | Au-delà, une suppression devient DESTRUCTIVE (confirmation). |
| `Safety:ConfirmationTtlSeconds` | `300` | Validité d'un jeton de confirmation. |
| `Safety:AutoCheckpoint` / `MaxCheckpoints` | `true` / `20` | Checkpoints automatiques avant opérations complexes. |
| `Safety:CheckpointDirectory` / `AuditLogDirectory` | `checkpoints` / `logs` | Relatifs au dossier de l'exécutable. |
| `Safety:MaxBatchSize` | `5000` | Taille maximale d'un lot. |

## Catalogue des tools

Niveau : **R** = READ, **W** = WRITE, **D** = DESTRUCTIVE (confirmation en deux temps), **W/D** = devient destructif
au-delà du seuil de suppression massive.

| Domaine | Tools |
|---|---|
| Connexion / projet | `robot_get_status` R, `robot_connect` R, `robot_disconnect` R, `robot_get_project_info` R, `robot_save_project` W, `robot_save_project_as` W/D (écrasement), `robot_verify_api` R, `robot_describe_api` R |
| Lecture du modèle | `get_model_summary`, `get_nodes`, `get_node`, `get_bars`, `get_bar`, `get_panels`, `get_groups`, `get_levels`, `get_sections`, `get_section`, `get_materials`, `get_material`, `get_thicknesses`, `get_supports`, `get_releases`, `get_load_cases`, `get_loads`, `get_combinations`, `get_mesh_settings`, `get_mesh_statistics` (tous R) |
| Géométrie | `create_node`, `create_nodes`, `move_node`, `create_bar`, `create_bars`, `update_bar`, `divide_bar`, `create_panel`, `create_slab`, `create_wall`, `create_wall_between`, `copy_elements`, `move_elements` (W) ; `delete_node`, `delete_bar`, `delete_panel` (W/D) |
| Matériaux | `create_material` (base Robot ou personnalisé), `update_material`, `assign_material` (W) |
| Sections | `create_section` (béton rectangulaire/carré/circulaire, profil acier de la base, tubes), `update_section`, `assign_section`, `assign_sections` (lot), `create_thickness` (W) |
| Appuis / relâchements | `create_support` (UX…RZ : free/fixed/spring), `update_support`, `assign_support`, `remove_support`, `create_bar_release`, `assign_bar_release` (W) ; `delete_support` (D) |
| Charges | `create_load_case` (natures, analyses statique/non linéaire/modale/flambement), `add_self_weight`, `add_nodal_load`, `add_bar_uniform_load`, `add_bar_point_load`, `add_panel_load`, `add_surface_load`, `add_temperature_load`, `apply_loads` (lot), `delete_load` (W) ; `delete_load_case` (D) |
| Combinaisons | `create_combination`, `update_combination`, `generate_combinations` (EN 1990 explicite ou norme du projet si lisible) (W) ; `delete_combination` (W/D) |
| Maillage | `set_mesh_settings`, `generate_mesh`, `refine_mesh` (W) |
| Calcul | `check_model` R, `run_analysis` W, `get_analysis_status` R, `get_analysis_messages` R, `cancel_analysis` (limitation API) |
| Résultats | `get_node_displacements`, `get_support_reactions`, `get_bar_forces`, `get_bar_displacements`, `get_bar_stresses`, `get_bar_extremes`, `get_result_envelope`, `get_panel_results` (R ; filtres éléments / sélection Robot / groupe / rôle / cas / `extremes_only`) |
| Dimensionnement | `check_steel_member` (module acier Robot), `design_steel_member`, `check_rc_beam`, `design_rc_beam`, `check_rc_column`, `design_rc_column`, `design_rc_slab`, `design_foundation` (R ; BA/fondations = limitation explicite + données) |
| Haut niveau | `create_3d_frame`, `create_grid_structure`, `create_rc_building`, `apply_standard_building_loads`, `analyze_structure` (W, checkpoint auto) ; `find_max_bar_force`, `find_max_displacement`, `find_max_reaction`, `find_overstressed_members`, `optimize_sections` (propose sans appliquer), `generate_structural_summary` (R) ; `apply_section_proposals` (W, checkpoint auto) |
| Sécurité | `begin_transaction`, `commit_transaction`, `create_checkpoint` (W) ; `rollback_transaction`, `restore_checkpoint` (D) ; `list_checkpoints`, `get_transaction_status`, `get_audit_log`, `get_safety_policy` (R) |

Toutes les entrées ont un **JSON Schema strict** (types, énumérations d'unités, `required`,
`additionalProperties: false` pour les objets des lots). Les lots (`create_nodes`, `create_bars`, `assign_sections`,
`apply_loads`) sont **validés intégralement avant la première écriture**.

## Ressources MCP

`project://summary`, `project://nodes`, `project://bars`, `project://sections`, `project://materials`,
`project://load-cases`, `project://combinations`, `project://analysis-status` (JSON, même enveloppe que les tools).

## Réponses, unités, sécurité, journalisation

**Enveloppe** — tous les tools renvoient (en `structuredContent` et en texte JSON) :

```json
{ "success": true, "operation": "create_bar", "data": { }, "warnings": [], "errors": [],
  "modified_elements": ["bar:12"], "duration_ms": 41 }
```

En cas d'échec, `success=false`, `isError=true`, et `errors=[{ "code": "...", "message": "..." }]` (codes stables :
`VALIDATION_FAILED`, `UNIT_ERROR`, `NOT_FOUND`, `ROBOT_NOT_RUNNING`, `ROBOT_CONNECTION_LOST`, `ROBOT_BUSY`,
`ROBOT_API_MEMBER_NOT_FOUND`, `ROBOT_ENUM_NOT_FOUND`, `ANALYSIS_FAILED`, `RESULTS_UNAVAILABLE`,
`CONFIRMATION_REQUIRED`, `CONFIRMATION_INVALID`, `SAFETY_LEVEL_FORBIDDEN`, `NOT_SUPPORTED_BY_ROBOT_API`…).

**Unités** — `UnitService` centralise m, cm, mm, N, kN, MN, Nm, kNm, Pa, kPa, MPa, GPa, N/mm², kN/m, kN/m², kN/m³,
kNm/rad, deg/rad, °C. Chaque paramètre dimensionné a une **unité obligatoire** typée (énumération dans le schéma) ;
une unité inconnue ou de mauvaise dimension est **refusée** (`UNIT_ERROR`), jamais convertie silencieusement. Tout est
converti en SI avant RobotOM. Les résultats indiquent leurs unités (kN, kNm, mm, rad, MPa, kN/m, kNm/m).
Les valeurs manifestement incohérentes (E d'un béton hors 20–50 GPa, charge surfacique > 100 kN/m², charge de gravité
dirigée vers le haut…) déclenchent un avertissement.

**Sécurité** — trois niveaux (READ/WRITE/DESTRUCTIVE), plafond configurable, confirmation explicite en deux temps
(jeton à usage unique, lié à l'opération et aux paramètres, 5 min) pour : suppressions massives, suppression de nœuds
portant des barres, écrasement de fichier, suppression d'un appui utilisé ou d'un cas chargé, restauration de
checkpoint, rollback. Checkpoints automatiques avant les opérations complexes (`create_*_frame/building`,
`copy_elements`, `move_elements`, `apply_section_proposals`). Transactions logiques `begin/commit/rollback`.

**Journal** — `logs/audit-AAAAMMJJ.jsonl` : horodatage, tool, niveau, paramètres (expurgés des secrets, lots
tronqués), projet, succès, résumé du résultat, erreurs, durée, éléments modifiés, checkpoint. Consultable via
`get_audit_log`. Les journaux techniques vont sur la console (stderr).

## Exemple de conversation

| Demande | Tools appelés |
|---|---|
| « Connecte-toi au projet ouvert dans Robot et résume le modèle. » | `robot_connect`, `get_model_summary` |
| « Crée quatre poteaux 30 × 30 cm, béton C30/37, hauteur 3,20 m, aux coordonnées… » | `create_material(database_name="C30/37")`, `create_section(concrete_column_rect, cm, 30, 30)`, `create_nodes(length_unit="m")`, `create_bars` |
| « Relie-les par des poutres 25 × 50 cm. » | `create_section(concrete_beam_rect)`, `create_bars` |
| « Crée une dalle de 15 cm. » | `create_slab(thickness=15, thickness_unit="cm", material="C30/37")` |
| « Ajoute le poids propre et une exploitation de 2 kN/m². » | `create_load_case` ×2, `add_self_weight`, `add_surface_load(pz=-2, "kN/m2")` |
| « Génère les combinaisons ELU et ELS selon la norme configurée. » | `generate_combinations(norm="from_project", …)` — refus explicite si la norme n'est pas lisible ; sinon `norm="EN1990"` avec ψ fournis |
| « Vérifie le modèle avant calcul. » | `check_model` |
| « Lance le calcul. » | `analyze_structure` (ou `run_analysis`) |
| « Quelle poutre a le moment fléchissant maximal ? » | `find_max_bar_force(component="MY", role="beam")` |
| « Poteaux dont le taux de travail dépasse 90 % ? » | `find_overstressed_members(threshold=0.9, role="column")` — acier : taux Robot ; **BA : limitation signalée** |
| « Propose de nouvelles sections sans les appliquer. » | `optimize_sections` → `proposal_id` |
| « Applique uniquement aux poteaux 12, 16 et 24. » | `apply_section_proposals(proposal_id, bar_ids=[12,16,24])` |

## Tests

```bash
dotnet test        # 47 tests : unités, sélection Robot, EN 1990, validation, sécurité, scénarios, MCP HTTP
```

Contrôles métier couverts : rectangle 5 × 4 m → dalle de 20 m² ; 30 cm → 0,30 m ; 2 kN/m² → 2000 N/m² ;
ELU 6.10 avec deux actions variables (1,35 G + 1,5 Q1 + 1,5 ψ0 Q2) ; calcul jamais déclaré réussi sans solveur ;
confirmation à usage unique liée aux paramètres ; rollback de transaction ; journal sans secrets.

Sur le poste Robot : `scripts\Smoke-Test.ps1 [-WriteTest]`.

## Limitations et suite

Les limitations de l'API sont listées dans [docs/ROBOTOM_API.md](docs/ROBOTOM_API.md#4-limitations-connues-documentées-plutôt-quinventées).
Prochaines étapes recommandées :

1. Exécuter `Inspect-RobotEnvironment.ps1`, `robot_verify_api` et `Smoke-Test.ps1 -WriteTest` sur le poste Robot ;
   corriger les éventuels membres signalés manquants ; confirmer la sémantique des relâchements.
2. Ajouter les lectures manquantes (étages Robot, excentrements, maillage par élément) une fois les noms vérifiés.
3. Module externe de dimensionnement BA (EN 1992) alimenté par `get_result_envelope`, validé par un ingénieur.
4. OAuth pour l'exposition à ChatGPT sans segment secret.
