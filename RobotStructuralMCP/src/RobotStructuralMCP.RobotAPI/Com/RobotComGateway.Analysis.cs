using System.Globalization;
using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.RobotAPI.Com;

public sealed partial class RobotComGateway
{
    // ---------------------------- Maillage ------------------------------------------------------------

    public IReadOnlyList<MeshSettingsData> GetMeshSettings(IReadOnlyCollection<int>? panelIds = null) => Call("get_mesh_settings", () =>
    {
        var ids = panelIds is { Count: > 0 } ? panelIds.ToList() : AllPanelNumbers().ToList();
        var list = new List<MeshSettingsData>();
        foreach (var id in ids)
        {
            dynamic obj = Structure.Objects.Get(id);
            dynamic sp = obj.Mesh.Params.SurfaceParams;
            double? size = Try(() => (double?)D(sp.Generation.ElementSize));
            string? gen = Try<string>(() => _typeLib.EnumName("IRobotMeshGenerationType", I(sp.Generation.Type)));
            string? method = Try<string>(() => _typeLib.EnumName("IRobotMeshMethodType", I(sp.Method.Method)));
            list.Add(new MeshSettingsData(id, size, method, gen));
        }
        return (IReadOnlyList<MeshSettingsData>)list;
    });

    public void SetMeshSettings(IReadOnlyCollection<int> panelIds, double elementSize) => Call("set_mesh_settings", () =>
    {
        var genType = E("IRobotMeshGenerationType", "I_MGT_ELEMENT_SIZE");
        foreach (var id in panelIds)
        {
            dynamic obj = Structure.Objects.Get(id);
            dynamic p = obj.Mesh.Params;
            p.SurfaceParams.Generation.Type = genType;
            p.SurfaceParams.Generation.ElementSize = elementSize;
            obj.Update();
        }
    });

    public void GenerateMesh() => Call("generate_mesh", () => { App.Project.CalcEngine.GenerateModel(); });

    public MeshStatistics GetMeshStatistics() => Call("get_mesh_statistics", () =>
    {
        int fe = Try<int>(() => I(Structure.FiniteElems.GetAll().Count));
        int nodes = I(Structure.Nodes.GetAll().Count);
        var panels = AllPanelNumbers();
        int meshed = panels.Count(id => Try<bool>(() => B(Structure.Objects.Get(id).Main.Attribs.Meshed)));
        return new MeshStatistics(fe, nodes, panels.Count, meshed);
    });

    // ---------------------------- Calcul ------------------------------------------------------------------

    public AnalysisRunResult RunAnalysis() => Call("run_analysis", () =>
    {
        EnsureActiveProject();
        var messages = new List<string>();
        int? rc = null;
        try
        {
            rc = I(App.Project.CalcEngine.Calculate());
            messages.Add($"CalcEngine.Calculate() a renvoyé {rc}.");
        }
        catch (Exception ex)
        {
            var root = Unwrap(ex);
            messages.Add($"Le solveur Robot a signalé une erreur : {root.Message}");
            if (root is not System.Runtime.InteropServices.COMException) throw;
        }
        bool available = Try<bool>(() => B(Structure.Results.Available));
        messages.Add(available ? "Résultats disponibles (Structure.Results.Available = 1)." : "Aucun résultat disponible après calcul (Structure.Results.Available = 0).");
        messages.Add("Le journal détaillé du solveur (fenêtre de calcul Robot) n'est pas exposé par RobotOM ; consultez Robot pour les messages complets.");
        // Le calcul n'est déclaré réussi que si Robot rend effectivement des résultats.
        return new AnalysisRunResult(available, rc, available, messages);
    });

    public bool ResultsAvailable() => Call("results_available", () => Try<bool>(() => B(Structure.Results.Available)));

    // ---------------------------- Résultats ---------------------------------------------------------------

    private void EnsureResults()
    {
        if (!Try<bool>(() => B(Structure.Results.Available)))
            throw new RobotMcpException(ErrorCodes.ResultsUnavailable, "Aucun résultat disponible : lancez d'abord le calcul (run_analysis).");
    }

    public NodeDisplacement GetNodeDisplacement(int node, int caseId) => Call("get_node_displacements", () =>
    {
        EnsureResults();
        dynamic d = Structure.Results.Nodes.Displacements.Value(node, caseId);
        return new NodeDisplacement(node, caseId, D(d.UX), D(d.UY), D(d.UZ), D(d.RX), D(d.RY), D(d.RZ));
    });

    public NodeReaction GetNodeReaction(int node, int caseId) => Call("get_support_reactions", () =>
    {
        EnsureResults();
        dynamic r = Structure.Results.Nodes.Reactions.Value(node, caseId);
        return new NodeReaction(node, caseId, D(r.FX), D(r.FY), D(r.FZ), D(r.MX), D(r.MY), D(r.MZ));
    });

    public BarForces GetBarForces(int bar, int caseId, double position) => Call("get_bar_forces", () =>
    {
        EnsureResults();
        dynamic f = Structure.Results.Bars.Forces.Value(bar, caseId, position);
        return new BarForces(bar, caseId, position, D(f.FX), D(f.FY), D(f.FZ), D(f.MX), D(f.MY), D(f.MZ));
    });

    public BarDisplacement GetBarDisplacement(int bar, int caseId, double position) => Call("get_bar_displacements", () =>
    {
        EnsureResults();
        dynamic d = Structure.Results.Bars.Displacements.Value(bar, caseId, position);
        return new BarDisplacement(bar, caseId, position, D(d.UX), D(d.UY), D(d.UZ), D(d.RX), D(d.RY), D(d.RZ));
    });

    public BarDeflection GetBarDeflection(int bar, int caseId, double position) => Call("get_bar_deflections", () =>
    {
        EnsureResults();
        dynamic d = Structure.Results.Bars.Deflections.Value(bar, caseId, position);
        return new BarDeflection(bar, caseId, position, D(d.UX), D(d.UY), D(d.UZ));
    });

    private static readonly string[] StressFields = { "Smax", "Smin", "SmaxMY", "SmaxMZ", "SminMY", "SminMZ", "FXSX", "T", "TY", "TZ" };

    public BarStress GetBarStress(int bar, int caseId, double position) => Call("get_bar_stresses", () =>
    {
        EnsureResults();
        dynamic s = Structure.Results.Bars.Stresses.Value(bar, caseId, position);
        var values = new Dictionary<string, double>();
        foreach (var field in StressFields)
        {
            // Lecture membre par membre (IDispatch, insensible à la casse) ; un champ absent est simplement omis.
            var v = Try(() => (double?)D(ReadProperty(s, field)));
            if (v is not null) values[field] = v.Value;
        }
        if (values.Count == 0)
            throw new RobotMcpException(ErrorCodes.RobotApiMemberNotFound, "Aucun champ de contrainte lisible sur IRobotBarStressData (voir robot_describe_api).");
        return new BarStress(bar, caseId, position, values);
    });

    private static object? ReadProperty(object comObject, string name) =>
        comObject.GetType().InvokeMember(name, System.Reflection.BindingFlags.GetProperty, null, comObject, null, CultureInfo.InvariantCulture);

    public IReadOnlyList<PanelResultRow> GetPanelResults(int panel, int caseId) => Call("get_panel_results", () =>
    {
        EnsureResults();
        // API de requête de résultats (exemples officiels « Results.Query ») :
        // IRobotResultQueryParams + RobotResultRowSet, résultats aux nœuds du maillage.
        var ids = new List<(string Name, int Id)>();
        foreach (var name in _options.PanelResultIds)
            if (_typeLib.TryEnumValue("IRobotFeResultType", name, out var v)) ids.Add((name, v));
        if (ids.Count == 0)
            throw new RobotMcpException(ErrorCodes.RobotEnumNotFound,
                "Aucun identifiant de résultat de Robot:PanelResultIds n'existe dans IRobotFeResultType (voir robot_describe_api IRobotFeResultType).");

        dynamic qp = App.CmpntFactory.Create(E("IRobotComponentType", "I_CT_RESULT_QUERY_PARAMS"));
        dynamic caseSel = Structure.Selections.Create(E(OT, "I_OT_CASE"));
        caseSel.FromText(caseId.ToString(CultureInfo.InvariantCulture));
        dynamic panelSel = Structure.Selections.Create(E(OT, "I_OT_PANEL"));
        panelSel.FromText(panel.ToString(CultureInfo.InvariantCulture));
        qp.Selection.Set(E(OT, "I_OT_PANEL"), panelSel);
        qp.Selection.Set(E(OT, "I_OT_CASE"), caseSel);
        qp.SetParam(E("IRobotResultParamType", "I_RPT_RESULT_POINT_TYPE"), E("IRobotResultPointType", "I_RPT_NODE"));
        qp.ResultIds.SetSize(ids.Count);
        for (int i = 0; i < ids.Count; i++) qp.ResultIds.Set(i + 1, ids[i].Id);

        dynamic rowSet = Activator.CreateInstance(Type.GetTypeFromCLSID(_typeLib.CoclassId("RobotResultRowSet"), true)!)!;
        int done = E("IRobotResultQueryReturnType", "I_RQRT_DONE");
        int nodeParam = E("IRobotResultParamType", "I_RPT_NODE");
        bool hasElemParam = _typeLib.TryEnumValue("IRobotResultParamType", "I_RPT_ELEMENT", out var elemParam);
        var rows = new List<PanelResultRow>();
        for (int guard = 0; guard < 10_000; guard++)
        {
            int ret = I(Structure.Results.Query(qp, rowSet));
            bool ok = B(rowSet.MoveFirst());
            while (ok)
            {
                dynamic row = rowSet.CurrentRow;
                var values = new Dictionary<string, double>();
                foreach (var (name, id) in ids)
                    if (B(row.IsAvailable(id))) values[name.Replace("I_FRT_DETAILED_", "")] = D(row.GetValue(id));
                int? node = Try(() => (int?)I(row.GetParam(nodeParam)));
                int? elem = hasElemParam ? Try(() => (int?)I(row.GetParam(elemParam))) : null;
                rows.Add(new PanelResultRow(panel, caseId, elem, node, values));
                ok = B(rowSet.MoveNext());
            }
            if (ret == done) break;
        }
        return (IReadOnlyList<PanelResultRow>)rows;
    });

    // ---------------------------- Dimensionnement acier (RDimServer) ----------------------------------------

    public IReadOnlyList<SteelMemberCheck> RunSteelMemberVerification(IReadOnlyCollection<int> members, IReadOnlyCollection<int> cases) =>
        Call("check_steel_member", () =>
        {
            EnsureResults();
            // Module de dimensionnement acier de Robot, exposé par l'extension « RDimServer ».
            dynamic dimServer = App.Kernel.GetExtension("RDimServer");
            dimServer.Mode = E("IRDimServerMode", "I_DSM_STEEL");
            dynamic engine = dimServer.CalculEngine;
            dynamic param = engine.GetCalcParam();
            dynamic conf = engine.GetCalcConf();
            dynamic stream = dimServer.Connection.GetStream();
            stream.Clear();
            stream.WriteText(Ids(members));
            param.SetObjsList(E("IRDimCalcParamVerifType", "I_DCPVT_MEMBERS_VERIF"), stream);
            param.SetLimitState(E("IRDimCalcParamLimitStateType", "I_DCPLST_ULTIMATE"), 1);
            stream.Clear();
            stream.WriteText(Ids(cases));
            param.SetLoadsList(stream);
            engine.SetCalcParam(param);
            engine.SetCalcConf(conf);
            engine.Solve(null);
            dynamic all = engine.Results();
            var list = new List<SteelMemberCheck>();
            foreach (var m in members)
            {
                try
                {
                    dynamic det = all.Get(m);
                    double ratio = D(det.Ratio);
                    string? gov = Try<string>(() => S(det.GovernCaseName));
                    string? section = Try<string>(() => S(det.SectionName));
                    list.Add(new SteelMemberCheck(m, NullIfEmpty(section), ratio, NullIfEmpty(gov), ratio <= 1.0 ? "ok" : "exceeded"));
                }
                catch (Exception ex)
                {
                    list.Add(new SteelMemberCheck(m, null, null, null, "unavailable",
                        new Dictionary<string, string> { ["reason"] = Unwrap(ex).Message }));
                }
            }
            return (IReadOnlyList<SteelMemberCheck>)list;
        });

    // ---------------------------- Introspection --------------------------------------------------------------

    public ApiVerificationReport VerifyApi() => Call("robot_verify_api", () =>
    {
        if (!_typeLib.IsLoaded)
            throw new RobotMcpException(ErrorCodes.RobotComError, "Bibliothèque de types RobotOM non chargée.");
        var found = new List<ApiMemberCheck>();
        var missing = new List<ApiMemberCheck>();
        foreach (var e in RobotApiManifest.Members)
        {
            var sig = _typeLib.MemberSignature(e.Interface, e.Member);
            var check = new ApiMemberCheck(e.Interface, e.Member, sig is not null, sig);
            (sig is not null ? found : missing).Add(check);
        }
        var missingEnums = RobotApiManifest.EnumValues
            .Where(v => !_typeLib.TryEnumValue(v.Enum, v.Value, out _))
            .Select(v => $"{v.Enum}.{v.Value}")
            .ToList();
        return new ApiVerificationReport($"{_typeLib.LibraryName} — {_typeLib.Source}", RobotApiManifest.Members.Count,
            missing.Count, missing, found, missingEnums);
    });

    public IReadOnlyList<string> DescribeApi(string interfaceName) => Call("robot_describe_api", () => _typeLib.Describe(interfaceName));
}
