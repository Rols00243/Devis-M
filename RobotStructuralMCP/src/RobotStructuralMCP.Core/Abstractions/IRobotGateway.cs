using RobotStructuralMCP.Core.Geometry;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.Core.Abstractions;

/// <summary>
/// Passerelle vers Robot Structural Analysis. Toutes les valeurs sont en SI.
/// Deux implémentations :
///  - RobotComGateway   : pilote réellement Robot via RobotOM (COM, Windows uniquement) ;
///  - SimulationGateway : modèle en mémoire pour les tests et le développement hors Windows
///                        (aucun solveur : le calcul y est explicitement non supporté).
/// Les implémentations sont appelées de façon sérialisée (une opération à la fois).
/// </summary>
public interface IRobotGateway
{
    string BackendName { get; }

    // --- Connexion / projet -------------------------------------------------------------
    RobotStatus GetStatus();
    RobotStatus Connect(bool launchIfNotRunning);
    void Disconnect();
    ProjectInfo GetProjectInfo();
    void SaveProject();
    void SaveProjectAs(string path);
    /// <summary>Écrit un instantané complet du modèle dans <paramref name="path"/>.</summary>
    void WriteCheckpoint(string path);
    /// <summary>Recharge un instantané écrit par <see cref="WriteCheckpoint"/>.</summary>
    void RestoreCheckpoint(string path);
    string? CurrentProjectPath { get; }

    // --- Nœuds --------------------------------------------------------------------------
    IReadOnlyList<NodeData> GetNodes(IReadOnlyCollection<int>? ids = null);
    bool NodeExists(int id);
    int NextNodeId();
    void CreateNode(int id, double x, double y, double z);
    void MoveNode(int id, double x, double y, double z);
    void DeleteNode(int id);

    // --- Barres -------------------------------------------------------------------------
    IReadOnlyList<BarData> GetBars(IReadOnlyCollection<int>? ids = null);
    bool BarExists(int id);
    int NextBarId();
    void CreateBar(int id, int startNode, int endNode);
    void SetBarNodes(int id, int startNode, int endNode);
    void SetBarGamma(int id, double gammaRad);
    void DeleteBar(int id);

    // --- Panneaux (dalles / voiles) -----------------------------------------------------
    IReadOnlyList<PanelData> GetPanels(IReadOnlyCollection<int>? ids = null);
    bool PanelExists(int id);
    int NextPanelId();
    void CreatePanel(int id, IReadOnlyList<Point3> contour, string thicknessLabel);
    void DeletePanel(int id);

    // --- Étiquettes : affectation générique -------------------------------------------
    void AssignSection(IReadOnlyCollection<int> barIds, string sectionName);
    void AssignMaterial(ElementKind kind, IReadOnlyCollection<int> ids, string materialName);
    void AssignSupport(IReadOnlyCollection<int> nodeIds, string supportName);
    void RemoveSupport(IReadOnlyCollection<int> nodeIds);
    void AssignRelease(IReadOnlyCollection<int> barIds, string releaseName);
    void AssignThickness(IReadOnlyCollection<int> panelIds, string thicknessName);

    // --- Matériaux ----------------------------------------------------------------------
    IReadOnlyList<MaterialData> GetMaterials();
    void UpsertMaterial(MaterialDefinition def);

    // --- Sections -----------------------------------------------------------------------
    IReadOnlyList<SectionData> GetSections();
    void UpsertSection(SectionDefinition def);

    // --- Épaisseurs de panneaux ---------------------------------------------------------
    IReadOnlyList<ThicknessData> GetThicknesses();
    void UpsertThickness(ThicknessData def);

    // --- Appuis / relâchements ------------------------------------------------------------
    IReadOnlyList<SupportData> GetSupports();
    void UpsertSupport(SupportData def);
    void DeleteSupport(string name);
    IReadOnlyList<ReleaseData> GetReleases();
    void UpsertRelease(ReleaseData def);

    // --- Cas de charges / charges -------------------------------------------------------
    IReadOnlyList<LoadCaseData> GetLoadCases();
    bool CaseExists(int id);
    int NextCaseId();
    void CreateLoadCase(int id, string name, CaseNature nature, AnalysisKind analysis, int? modalModes = null);
    void DeleteCase(int id);
    IReadOnlyList<LoadRecordData> GetLoads(int? caseId = null);
    int AddLoad(int caseId, LoadDefinition load);
    void DeleteLoad(int caseId, int recordIndex);

    // --- Combinaisons -------------------------------------------------------------------
    IReadOnlyList<CombinationData> GetCombinations();
    void CreateCombination(int id, string name, CombinationType type, IReadOnlyList<CaseFactor> factors);

    // --- Groupes ------------------------------------------------------------------------
    IReadOnlyList<GroupData> GetGroups();

    // --- Maillage -----------------------------------------------------------------------
    IReadOnlyList<MeshSettingsData> GetMeshSettings(IReadOnlyCollection<int>? panelIds = null);
    void SetMeshSettings(IReadOnlyCollection<int> panelIds, double elementSize);
    void GenerateMesh();
    MeshStatistics GetMeshStatistics();

    // --- Calcul -------------------------------------------------------------------------
    AnalysisRunResult RunAnalysis();
    bool ResultsAvailable();

    // --- Résultats (SI ; Position relative 0..1 le long de la barre) ------------------------
    NodeDisplacement GetNodeDisplacement(int node, int caseId);
    NodeReaction GetNodeReaction(int node, int caseId);
    BarForces GetBarForces(int bar, int caseId, double position);
    BarDisplacement GetBarDisplacement(int bar, int caseId, double position);
    BarDeflection GetBarDeflection(int bar, int caseId, double position);
    BarStress GetBarStress(int bar, int caseId, double position);
    IReadOnlyList<PanelResultRow> GetPanelResults(int panel, int caseId);

    // --- Dimensionnement (module RDimServer de Robot) ------------------------------------
    IReadOnlyList<SteelMemberCheck> RunSteelMemberVerification(IReadOnlyCollection<int> members, IReadOnlyCollection<int> cases);

    // --- Introspection de l'API installée -----------------------------------------------
    ApiVerificationReport VerifyApi();
    IReadOnlyList<string> DescribeApi(string interfaceName);
}
