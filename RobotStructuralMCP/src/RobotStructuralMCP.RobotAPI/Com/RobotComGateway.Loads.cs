using RobotStructuralMCP.Core.Errors;
using RobotStructuralMCP.Core.Models;

namespace RobotStructuralMCP.RobotAPI.Com;

public sealed partial class RobotComGateway
{
    private static readonly (CaseNature Nature, string Robot)[] Natures =
    {
        (CaseNature.Permanent, "I_CN_PERMANENT"), (CaseNature.Live, "I_CN_EXPLOATATION"), (CaseNature.Wind, "I_CN_WIND"),
        (CaseNature.Snow, "I_CN_SNOW"), (CaseNature.Temperature, "I_CN_TEMPERATURE"), (CaseNature.Accidental, "I_CN_ACCIDENTAL"),
        (CaseNature.Seismic, "I_CN_SEISMIC"),
    };

    private static readonly (AnalysisKind Kind, string Robot)[] AnalysisTypes =
    {
        (AnalysisKind.StaticLinear, "I_CAT_STATIC_LINEAR"), (AnalysisKind.StaticNonlinear, "I_CAT_STATIC_NONLINEAR"),
        (AnalysisKind.Modal, "I_CAT_DYNAMIC_MODAL"), (AnalysisKind.Buckling, "I_CAT_STATIC_FLAMB"),
    };

    /// <summary>Correspondance type de charge → (type d'enregistrement, énumération des valeurs, composantes lues).</summary>
    private static readonly Dictionary<string, (string ValuesEnum, string[] Values)> RecordValueMap = new()
    {
        ["I_LRT_DEAD"] = ("IRobotDeadRecordValues", new[] { "I_DRV_X", "I_DRV_Y", "I_DRV_Z", "I_DRV_ENTIRE_STRUCTURE" }),
        ["I_LRT_NODE_FORCE"] = ("IRobotNodeForceRecordValues", new[] { "I_NFRV_FX", "I_NFRV_FY", "I_NFRV_FZ", "I_NFRV_CX", "I_NFRV_CY", "I_NFRV_CZ" }),
        ["I_LRT_BAR_UNIFORM"] = ("IRobotBarUniformRecordValues", new[] { "I_BURV_PX", "I_BURV_PY", "I_BURV_PZ", "I_BURV_LOCAL" }),
        ["I_LRT_BAR_FORCE_CONCENTRATED"] = ("IRobotBarForceConcentrateRecordValues", new[] { "I_BFCRV_FX", "I_BFCRV_FY", "I_BFCRV_FZ", "I_BFCRV_X", "I_BFCRV_REL", "I_BFCRV_LOC" }),
        ["I_LRT_UNIFORM"] = ("IRobotUniformRecordValues", new[] { "I_URV_PX", "I_URV_PY", "I_URV_PZ", "I_URV_LOCAL_SYSTEM" }),
        ["I_LRT_BAR_THERMAL"] = ("IRobotBarThermalRecordValues", new[] { "I_BTRV_TX", "I_BTRV_TY", "I_BTRV_TZ" }),
    };

    private static readonly Dictionary<string, string> RecordKindNames = new()
    {
        ["I_LRT_DEAD"] = "self_weight", ["I_LRT_NODE_FORCE"] = "nodal_force", ["I_LRT_BAR_UNIFORM"] = "bar_uniform",
        ["I_LRT_BAR_FORCE_CONCENTRATED"] = "bar_point_force", ["I_LRT_UNIFORM"] = "panel_uniform", ["I_LRT_BAR_THERMAL"] = "bar_temperature",
    };

    internal static string ApiName(AnalysisKind k) => k switch
    {
        AnalysisKind.StaticLinear => "static_linear", AnalysisKind.StaticNonlinear => "static_nonlinear",
        AnalysisKind.Modal => "modal", _ => "buckling",
    };

    private string NatureName(int value)
    {
        var n = _typeLib.EnumName("IRobotCaseNature", value);
        var match = Natures.FirstOrDefault(x => x.Robot == n);
        return match.Robot is null ? n : match.Nature.ToString().ToLowerInvariant();
    }

    private bool IsCombination(dynamic c)
    {
        var type = _typeLib.EnumName("IRobotCaseType", Try<int>(() => I(c.Type)));
        return type.Contains("COMB", StringComparison.OrdinalIgnoreCase);
    }

    public IReadOnlyList<LoadCaseData> GetLoadCases() => Call("get_load_cases", () =>
    {
        var list = new List<LoadCaseData>();
        foreach (var c in Items(Structure.Cases.GetAll()))
        {
            bool comb = IsCombination(c);
            string? analysis = null;
            if (!comb)
            {
                string robotName = _typeLib.EnumName("IRobotCaseAnalizeType", Try<int>(() => I(c.AnalizeType)));
                var known = AnalysisTypes.FirstOrDefault(x => x.Robot == robotName);
                analysis = known.Robot is null ? robotName : ApiName(known.Kind);
            }
            int records = comb ? 0 : Try<int>(() => I(c.Records.Count));
            list.Add(new LoadCaseData(I(c.Number), S(c.Name), NatureName(Try<int>(() => I(c.Nature))),
                comb ? "combination" : "simple", analysis, records));
        }
        return (IReadOnlyList<LoadCaseData>)list.OrderBy(c => c.Id).ToList();
    });

    public bool CaseExists(int id) => Call("case_exists", () => B(Structure.Cases.Exist(id)));

    public int NextCaseId() => Call("next_case_id", () => I(Structure.Cases.FreeNumber));

    public void CreateLoadCase(int id, string name, CaseNature nature, AnalysisKind analysis, int? modalModes = null) => Call("create_load_case", () =>
    {
        var n = E("IRobotCaseNature", Natures.First(x => x.Nature == nature).Robot);
        var a = E("IRobotCaseAnalizeType", AnalysisTypes.First(x => x.Kind == analysis).Robot);
        dynamic c = Structure.Cases.CreateSimple(id, name, n, a);
        if (analysis == AnalysisKind.Modal && modalModes is { } modes)
        {
            dynamic p = c.GetAnalysisParams();
            p.ModesCount = modes;
            c.SetAnalysisParams(p);
        }
    });

    public void DeleteCase(int id) => Call("delete_case", () => { Structure.Cases.Delete(id); });

    public IReadOnlyList<LoadRecordData> GetLoads(int? caseId = null) => Call("get_loads", () =>
    {
        var list = new List<LoadRecordData>();
        IEnumerable<dynamic> cases = caseId is { } cid ? new[] { Structure.Cases.Get(cid) } : Items(Structure.Cases.GetAll());
        foreach (var c in cases)
        {
            if (IsCombination(c)) continue;
            int number = I(c.Number);
            dynamic records = c.Records;
            int count = I(records.Count);
            for (int i = 1; i <= count; i++)
            {
                dynamic rec = records.Get(i);
                string typeName = _typeLib.EnumName("IRobotLoadRecordType", Try<int>(() => I(rec.Type)));
                var values = new Dictionary<string, double>();
                if (RecordValueMap.TryGetValue(typeName, out var map))
                {
                    foreach (var v in map.Values)
                    {
                        if (!_typeLib.TryEnumValue(map.ValuesEnum, v, out var idx)) continue;
                        var value = Try(() => (double?)D(rec.GetValue((short)idx)));
                        if (value is not null) values[v[(v.IndexOf('_', 2) + 1)..]] = value.Value;
                    }
                }
                list.Add(new LoadRecordData(number, i, RecordKindNames.GetValueOrDefault(typeName, typeName),
                    Try<string>(() => S(rec.Objects.ToText())) ?? "", values));
            }
        }
        return (IReadOnlyList<LoadRecordData>)list;
    });

    public int AddLoad(int caseId, LoadDefinition load) => Call("add_load", () =>
    {
        dynamic c = Structure.Cases.Get(caseId);
        if (IsCombination(c))
            throw new RobotMcpException(ErrorCodes.ValidationFailed, $"Le cas {caseId} est une combinaison : impossible d'y ajouter une charge.");
        string recordType = load.Kind switch
        {
            LoadKind.SelfWeight => "I_LRT_DEAD",
            LoadKind.NodalForce => "I_LRT_NODE_FORCE",
            LoadKind.BarUniform => "I_LRT_BAR_UNIFORM",
            LoadKind.BarPointForce => "I_LRT_BAR_FORCE_CONCENTRATED",
            LoadKind.PanelUniform => "I_LRT_UNIFORM",
            LoadKind.BarTemperature => "I_LRT_BAR_THERMAL",
            _ => throw new RobotMcpException(ErrorCodes.ValidationFailed, $"Type de charge non géré : {load.Kind}"),
        };
        var (valuesEnum, _) = RecordValueMap[recordType];
        int index = I(c.Records.New(E("IRobotLoadRecordType", recordType)));
        dynamic rec = c.Records.Get(index);
        void Set(string member, double value) => rec.SetValue((short)E(valuesEnum, member), value);

        switch (load.Kind)
        {
            case LoadKind.SelfWeight:
                Set("I_DRV_Z", -load.Factor);
                if (load.Objects.Count == 0) Set("I_DRV_ENTIRE_STRUCTURE", 1);
                break;
            case LoadKind.NodalForce:
                Set("I_NFRV_FX", load.FX); Set("I_NFRV_FY", load.FY); Set("I_NFRV_FZ", load.FZ);
                Set("I_NFRV_CX", load.MX); Set("I_NFRV_CY", load.MY); Set("I_NFRV_CZ", load.MZ);
                break;
            case LoadKind.BarUniform:
                Set("I_BURV_PX", load.FX); Set("I_BURV_PY", load.FY); Set("I_BURV_PZ", load.FZ);
                if (load.Local) Set("I_BURV_LOCAL", 1);
                break;
            case LoadKind.BarPointForce:
                Set("I_BFCRV_FX", load.FX); Set("I_BFCRV_FY", load.FY); Set("I_BFCRV_FZ", load.FZ);
                Set("I_BFCRV_X", load.Position ?? 0.5);
                Set("I_BFCRV_REL", load.Relative ? 1 : 0);
                if (load.Local) Set("I_BFCRV_LOC", 1);
                break;
            case LoadKind.PanelUniform:
                Set("I_URV_PX", load.FX); Set("I_URV_PY", load.FY); Set("I_URV_PZ", load.FZ);
                if (load.Local) Set("I_URV_LOCAL_SYSTEM", 1);
                break;
            case LoadKind.BarTemperature:
                Set("I_BTRV_TX", load.Temperature);
                break;
        }
        if (load.Objects.Count > 0) rec.Objects.FromText(Ids(load.Objects));
        return index;
    });

    public void DeleteLoad(int caseId, int recordIndex) => Call("delete_load", () =>
    {
        dynamic c = Structure.Cases.Get(caseId);
        int count = I(c.Records.Count);
        if (recordIndex < 1 || recordIndex > count)
            throw new RobotMcpException(ErrorCodes.NotFound, $"Le cas {caseId} n'a pas d'enregistrement de charge n°{recordIndex} (il en compte {count}).");
        c.Records.Delete(recordIndex);
    });

    // ---------------------------- Combinaisons ------------------------------------------------------

    public IReadOnlyList<CombinationData> GetCombinations() => Call("get_combinations", () =>
    {
        var list = new List<CombinationData>();
        foreach (var c in Items(Structure.Cases.GetAll()))
        {
            if (!IsCombination(c)) continue;
            var factors = new List<CaseFactor>();
            dynamic cf = c.CaseFactors;
            int count = I(cf.Count);
            for (int i = 1; i <= count; i++)
            {
                dynamic f = cf.Get(i);
                factors.Add(new CaseFactor(I(f.CaseNumber), D(f.Factor)));
            }
            var type = _typeLib.EnumName("IRobotCombinationType", Try<int>(() => I(c.CombinationType)));
            type = type switch { "I_CBT_ULS" => "ULS", "I_CBT_SLS" => "SLS", "I_CBT_ACC" => "ACC", _ => type };
            list.Add(new CombinationData(I(c.Number), S(c.Name), type, factors));
        }
        return (IReadOnlyList<CombinationData>)list.OrderBy(c => c.Id).ToList();
    });

    public void CreateCombination(int id, string name, CombinationType type, IReadOnlyList<CaseFactor> factors) => Call("create_combination", () =>
    {
        var t = E("IRobotCombinationType", type switch
        {
            CombinationType.Uls => "I_CBT_ULS",
            CombinationType.Sls => "I_CBT_SLS",
            _ => "I_CBT_ACC",
        });
        dynamic comb = Structure.Cases.CreateCombination(id, name, t,
            E("IRobotCaseNature", "I_CN_PERMANENT"), E("IRobotCaseAnalizeType", "I_CAT_COMB"));
        foreach (var f in factors) comb.CaseFactors.New(f.CaseId, f.Factor);
    });
}
