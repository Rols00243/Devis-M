# RobotOM : référencement, vérification et limitations

Ce document décrit **comment le serveur accède à RobotOM**, **ce qui a été vérifié et ce qui reste à vérifier**
sur la version de Robot installée, et **les limitations connues de l'API**.

## 1. Pourquoi aucune référence à `Interop.RobotOM.dll` à la compilation

RobotOM est une bibliothèque de types COM (fichier `robotom.tlb`, enregistrée par l'installeur de Robot ;
un assembly d'interop `Interop.RobotOM.dll` est en général présent dans le dossier `Exe` de Robot).
Elle **n'existe que sur un poste Windows où Robot est installé** et **change selon la version de Robot**.

Choix retenu :

| Point | Solution |
|---|---|
| Compilation | Aucune dépendance : la solution compile partout (.NET 8, y compris en CI Linux). |
| Appels | Liaison tardive **IDispatch** (`dynamic`) depuis `RobotComGateway`, sur un thread COM dédié (`StaDispatcher`, STA par défaut). |
| Énumérations | **Jamais de valeur numérique codée en dur.** Les valeurs sont lues par **nom** dans la bibliothèque de types de l'instance Robot connectée (`RobotTypeLibrary`, via `IDispatch.GetTypeInfo` → `ITypeLib`). Un nom absent ⇒ erreur `ROBOT_ENUM_NOT_FOUND`. |
| Membres | Un membre absent ⇒ `DISP_E_UNKNOWNNAME` ⇒ erreur `ROBOT_API_MEMBER_NOT_FOUND` (aucun résultat inventé). |
| Vérification | Le tool **`robot_verify_api`** compare l'inventaire `RobotApiManifest` (tous les membres et valeurs d'énumération utilisés) à la bibliothèque de types installée. **`robot_describe_api`** liste les membres réels d'une interface ou d'une énumération. |
| Secours | `Robot:TypeLibraryPath` peut pointer vers `robotom.tlb` si la lecture depuis l'instance échoue. |

### Contraintes d'architecture

* **Windows uniquement** pour le mode `Com` (COM out-of-process vers `robot.exe`). Sous Linux/macOS, seul le mode
  `Simulation` fonctionne (tests, développement).
* **x64** : Robot 2020+ est 64 bits ; le serveur est publié en `win-x64`.
* **.NET 8** : le binder COM de `dynamic` est disponible sur .NET 5+ sous Windows. Aucune contrainte .NET Framework.
* **Un seul appel Robot à la fois** : Robot n'est pas réentrant. Le `StaDispatcher` sérialise tous les appels et le
  `ToolRunner` sérialise les opérations composées.
* **`CalcEngine.Calculate()` est synchrone** : le calcul est exécuté en tâche de fond (`AnalysisTracker`) pour pouvoir
  répondre « running » au client ; pendant le calcul, les autres appels Robot attendent.

## 2. Étapes de vérification sur le poste Windows (à faire une fois par version de Robot)

1. `scripts\Inspect-RobotEnvironment.ps1` : version et architecture de Robot, ProgID `Robot.Application`, typelib.
2. Lancer le serveur, ouvrir Robot avec un projet, puis `scripts\Smoke-Test.ps1` (ou le tool `robot_verify_api`).
3. Pour chaque membre listé dans `missing` : `robot_describe_api` sur l'interface concernée pour trouver le nom réel,
   corriger `RobotComGateway` et l'entrée correspondante de `RobotApiManifest`.
4. **Relâchements** : la sémantique de `IRobotBarEndReleaseValue` doit être confirmée une fois : créer un relâchement
   avec `create_bar_release` (ex. `end_released=["RY","RZ"]`) et vérifier dans Robot (boîte « Relâchements ») que ce
   sont bien ces DDL qui sont libérés. Sinon, inverser `Robot:ReleaseReleasedValue` / `Robot:ReleaseConnectedValue`
   dans `appsettings.json` (aucune recompilation).

## 3. Niveau de confiance par domaine

« sample » = séquence identique aux exemples officiels du SDK Robot API ; « inferred » = nomenclature RobotOM
documentée mais non confirmée sur une installation pendant le développement (à valider par `robot_verify_api`).

| Domaine | Membres principaux | Confiance |
|---|---|---|
| Connexion | `RobotApplication` (ProgID `Robot.Application`), `Visible`, `Interactive`, `UserControl`, `Project.Name/FileName/Type/Save/SaveAs/Open` | sample |
| Nœuds / barres | `Structure.Nodes/Bars.Create/Get/GetAll/Exist/Delete/FreeNumber`, `X/Y/Z`, `StartNode/EndNode/Length/Gamma`, `SetLabel/HasLabel/GetLabelName` | sample |
| Panneaux | `CmpntFactory.Create(I_CT_POINTS_ARRAY)`, `Objects.CreateContour`, `Main.Attribs.Meshed`, `I_LT_PANEL_THICKNESS`, `Initialize/Update` | sample |
| Lecture du contour d'un panneau | `Main.Geometry.Segments.Get(i).P1` | inferred (contour vide + note si absent) |
| Étiquettes | `Labels.Create/Get/Exist/Store/GetAvailableNames`, `Delete/IsUsed` | sample / inferred |
| Matériaux | `IRobotMaterialData.Type/E/NU/RO/Kirchoff`, `LX/RE/RT/LoadFromDBase` | sample / inferred |
| Sections béton | `ShapeType = I_BSST_CONCR_BEAM_RECT / I_BSST_CONCR_COL_R / I_BSST_CONCR_COL_C`, `Concrete.SetValue(I_BSCDV_…)`, `CalcNonstdGeometry` | sample |
| Profils acier | `IRobotBarSectionData.LoadFromDBase("HEA 200")` (base de profilés active du projet) | sample |
| Tubes | `I_BST_NS_TUBE/I_BST_NS_RECT`, `CreateNonstd`, `I_BSNDV_TUBE_*`, `I_BSNDV_RECT_*` | sample |
| Appuis | `IRobotNodeSupportData.UX..RZ`, `KX..KZ`, `HX..HZ` | sample / inferred (H*) |
| Relâchements | `IRobotBarReleaseData.StartNode/EndNode.UX..RZ`, valeurs `IRobotBarEndReleaseValue` | sample — **sémantique à confirmer** (§2.4) |
| Cas / charges | `Cases.CreateSimple`, `Records.New/Get/Count`, `SetValue/GetValue`, `Objects.FromText/ToText` ; `I_LRT_DEAD/NODE_FORCE/BAR_UNIFORM/BAR_FORCE_CONCENTRATED/UNIFORM/BAR_THERMAL` | sample |
| Repère local des charges | `I_BURV_LOCAL`, `I_BFCRV_LOC`, `I_URV_LOCAL_SYSTEM` (utilisés seulement si `local=true`) | inferred |
| Combinaisons | `Cases.CreateCombination`, `CaseFactors.New/Get/Count` | sample |
| Analyse modale | `GetAnalysisParams().ModesCount`, `SetAnalysisParams` | inferred |
| Maillage | `CalcEngine.GenerateModel`, `Mesh.Params.SurfaceParams.Generation.ElementSize/Type` | inferred |
| Calcul | `CalcEngine.Calculate`, `Results.Available` | sample |
| Résultats nœuds / barres | `Results.Nodes.Displacements/Reactions.Value(n,c)`, `Results.Bars.Forces/Displacements/Deflections/Stresses.Value(b,c,x)` | sample |
| Résultats panneaux | `Results.Query` + `I_CT_RESULT_QUERY_PARAMS` + coclasse `RobotResultRowSet` + `IRobotFeResultType.I_FRT_DETAILED_*` (liste configurable `Robot:PanelResultIds`) | sample |
| Dimensionnement acier | `Kernel.GetExtension("RDimServer")`, `I_DSM_STEEL`, `CalculEngine.GetCalcParam/SetObjsList/SetLimitState/SetLoadsList/Solve/Results`, `Ratio`, `GovernCaseName` | inferred |
| Normes actives | `Preferences.GetActiveCode(IRobotCodeType.*)` | inferred (si illisible : aucune norme supposée) |

## 4. Limitations connues (documentées plutôt qu'inventées)

| Fonction demandée | Statut | Ce que fait le serveur |
|---|---|---|
| Annuler un calcul (`cancel_analysis`) | Pas de méthode d'arrêt dans RobotOM (`Calculate()` synchrone) | `NOT_SUPPORTED_BY_ROBOT_API` + état courant ; arrêt manuel dans Robot. |
| Journal détaillé du solveur | Non exposé | Code retour de `Calculate()`, `Results.Available`, exceptions COM ; renvoi vers la fenêtre de calcul. |
| Vérification interne de Robot (« Vérifier la structure ») | Non exposée | `check_model` réalise ses propres contrôles et le précise. |
| Transactions natives | Inexistantes | Checkpoints = copies `.rtd` via `SaveAs` ; restauration via `Open`. Le projet reste ensuite ouvert depuis le fichier checkpoint ; `robot_save_project` ré-enregistre vers le fichier d'origine mémorisé. |
| Ferraillage BA (poutres, poteaux, dalles), fondations | Non vérifiable via RobotOM | `NOT_SUPPORTED_BY_ROBOT_API` + données disponibles (sections, enveloppes d'efforts, réactions) + proposition de module externe. Aucun taux BA n'est inventé. |
| Dimensionnement automatique acier (groupes) | Paramétrage non vérifié | `design_steel_member` renvoie la limitation + taux actuels ; `optimize_sections` fait une **estimation de pré-dimensionnement** explicite, à confirmer par `check_steel_member`. |
| Combinaisons automatiques de Robot selon la norme du projet | Non exposées de façon vérifiée | `generate_combinations` implémente l'EN 1990 de façon transparente (coefficients renvoyés) ; refus pour une autre norme. |
| Analyses P-Delta / second ordre / sismique | Paramètres spécifiques non vérifiés | `create_load_case` gère `static_linear`, `static_nonlinear`, `modal`, `buckling`. P-Delta et sismique : à paramétrer dans Robot. |
| Étages Robot (« Storeys »), excentrements | Non lus dans cette version | `get_levels` déduit les niveaux des altitudes ; excentrements à ajouter (`I_LT_BAR_OFFSET` à vérifier). |
| Raffinement local autour d'un point | Non exposé | `refine_mesh` raffine **par panneau** (taille d'élément) puis régénère. |
| Copie/déplacement natifs | Non utilisés | Implémentés avec les primitives vérifiées (création/déplacement de nœuds, barres, panneaux). Les charges ne sont pas copiées. |
