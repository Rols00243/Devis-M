using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using RobotStructuralMCP.Core.Errors;

namespace RobotStructuralMCP.RobotAPI.Com;

/// <summary>
/// Lecture de la bibliothèque de types COM RobotOM réellement installée.
/// Sert à :
///  1. résoudre les valeurs des énumérations RobotOM par leur NOM (aucune valeur numérique codée en dur) ;
///  2. vérifier que chaque interface / membre utilisé par le serveur existe dans la version installée ;
///  3. obtenir les CLSID des coclasses (ex. RobotResultRowSet) ;
///  4. décrire une interface (outil robot_describe_api).
/// </summary>
public sealed class RobotTypeLibrary
{
    private readonly Dictionary<string, Dictionary<string, int>> _enums = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Dictionary<string, string>> _members = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, Guid> _coclasses = new(StringComparer.OrdinalIgnoreCase);

    public string Source { get; private set; } = "non chargée";
    public string? LibraryName { get; private set; }
    public bool IsLoaded => _enums.Count > 0 || _members.Count > 0;

    /// <summary>Charge la bibliothèque contenant le type de l'objet COM fourni (ex. l'objet RobotApplication).</summary>
    public void LoadFromObject(object comObject)
    {
        if (!OperatingSystem.IsWindows()) return;
        var disp = (IDispatchInfo)comObject;
        var hr = disp.GetTypeInfo(0, 0, out var ti);
        if (hr != 0 || ti is null)
            throw new RobotMcpException(ErrorCodes.RobotComError, $"Impossible d'obtenir l'ITypeInfo de l'objet Robot (HRESULT 0x{hr:X8}).");
        ti.GetContainingTypeLib(out var lib, out _);
        Load(lib, "bibliothèque de types de l'instance Robot active");
    }

    /// <summary>Charge une bibliothèque depuis un fichier (.tlb, ou .dll contenant une ressource typelib).</summary>
    public void LoadFromFile(string path)
    {
        if (!OperatingSystem.IsWindows()) return;
        var hr = NativeMethods.LoadTypeLibEx(path, 2, out var lib);
        if (hr != 0 || lib is null)
            throw new RobotMcpException(ErrorCodes.RobotComError, $"LoadTypeLibEx a échoué pour « {path} » (HRESULT 0x{hr:X8}).");
        Load(lib, path);
    }

    private void Load(ITypeLib lib, string source)
    {
        _enums.Clear();
        _members.Clear();
        _coclasses.Clear();
        lib.GetDocumentation(-1, out var libName, out _, out _, out _);
        LibraryName = libName;
        Source = source;

        int count = lib.GetTypeInfoCount();
        for (int i = 0; i < count; i++)
        {
            lib.GetTypeInfoType(i, out var kind);
            lib.GetTypeInfo(i, out var ti);
            ti.GetDocumentation(-1, out var typeName, out _, out _, out _);
            ti.GetTypeAttr(out var pAttr);
            try
            {
                var attr = Marshal.PtrToStructure<TYPEATTR>(pAttr);
                switch (kind)
                {
                    case TYPEKIND.TKIND_ENUM:
                        _enums[typeName] = ReadEnum(ti, attr);
                        break;
                    case TYPEKIND.TKIND_DISPATCH:
                    case TYPEKIND.TKIND_INTERFACE:
                        var members = _members.TryGetValue(typeName, out var existing) ? existing : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                        ReadMembers(ti, attr, members);
                        _members[typeName] = members;
                        break;
                    case TYPEKIND.TKIND_COCLASS:
                        _coclasses[typeName] = attr.guid;
                        break;
                }
            }
            finally
            {
                ti.ReleaseTypeAttr(pAttr);
            }
        }
    }

    private static Dictionary<string, int> ReadEnum(ITypeInfo ti, TYPEATTR attr)
    {
        var values = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        for (int v = 0; v < attr.cVars; v++)
        {
            ti.GetVarDesc(v, out var pVar);
            try
            {
                var vd = Marshal.PtrToStructure<VARDESC>(pVar);
                var names = new string[1];
                ti.GetNames(vd.memid, names, 1, out _);
                var value = Marshal.GetObjectForNativeVariant(vd.desc.lpvarValue);
                if (value is not null) values[names[0]] = Convert.ToInt32(value);
            }
            finally
            {
                ti.ReleaseVarDesc(pVar);
            }
        }
        return values;
    }

    private static void ReadMembers(ITypeInfo ti, TYPEATTR attr, Dictionary<string, string> members)
    {
        for (int f = 0; f < attr.cFuncs; f++)
        {
            ti.GetFuncDesc(f, out var pFunc);
            try
            {
                var fd = Marshal.PtrToStructure<FUNCDESC>(pFunc);
                var names = new string[fd.cParams + 1];
                ti.GetNames(fd.memid, names, names.Length, out var got);
                var name = names[0];
                var kind = fd.invkind switch
                {
                    INVOKEKIND.INVOKE_PROPERTYGET => "get",
                    INVOKEKIND.INVOKE_PROPERTYPUT or INVOKEKIND.INVOKE_PROPERTYPUTREF => "set",
                    _ => "method",
                };
                var parameters = string.Join(", ", names.Skip(1).Take(Math.Max(0, got - 1)));
                var sig = kind == "method" ? $"{name}({parameters})" : $"[{kind}] {name}{(parameters.Length > 0 ? $"[{parameters}]" : "")}";
                members[name + ":" + kind] = sig;
            }
            finally
            {
                ti.ReleaseFuncDesc(pFunc);
            }
        }
        for (int v = 0; v < attr.cVars; v++)
        {
            ti.GetVarDesc(v, out var pVar);
            try
            {
                var vd = Marshal.PtrToStructure<VARDESC>(pVar);
                var names = new string[1];
                ti.GetNames(vd.memid, names, 1, out _);
                members[names[0] + ":get"] = $"[property] {names[0]}";
            }
            finally
            {
                ti.ReleaseVarDesc(pVar);
            }
        }
    }

    public int EnumValue(string enumType, string member)
    {
        if (!_enums.TryGetValue(enumType, out var values))
            throw new RobotMcpException(ErrorCodes.RobotEnumNotFound,
                $"Énumération RobotOM « {enumType} » introuvable dans {Source}.", new { enum_type = enumType });
        if (!values.TryGetValue(member, out var v))
            throw new RobotMcpException(ErrorCodes.RobotEnumNotFound,
                $"Valeur « {member} » absente de l'énumération RobotOM « {enumType} » de la version installée.",
                new { enum_type = enumType, member, available = values.Keys.OrderBy(k => k).ToArray() });
        return v;
    }

    public bool TryEnumValue(string enumType, string member, out int value)
    {
        value = 0;
        return _enums.TryGetValue(enumType, out var values) && values.TryGetValue(member, out value);
    }

    /// <summary>Nom symbolique d'une valeur d'énumération (pour restituer des valeurs lues dans Robot).</summary>
    public string EnumName(string enumType, int value)
    {
        if (_enums.TryGetValue(enumType, out var values))
            foreach (var kv in values)
                if (kv.Value == value) return kv.Key;
        return value.ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    public bool HasMember(string interfaceName, string member) =>
        _members.TryGetValue(interfaceName, out var m) && m.Keys.Any(k => k.StartsWith(member + ":", StringComparison.OrdinalIgnoreCase));

    public string? MemberSignature(string interfaceName, string member) =>
        _members.TryGetValue(interfaceName, out var m)
            ? m.Where(kv => kv.Key.StartsWith(member + ":", StringComparison.OrdinalIgnoreCase)).Select(kv => kv.Value).FirstOrDefault()
            : null;

    public bool HasInterface(string interfaceName) => _members.ContainsKey(interfaceName);

    public IReadOnlyList<string> Describe(string name)
    {
        if (_members.TryGetValue(name, out var m))
            return m.Values.Distinct().OrderBy(s => s, StringComparer.OrdinalIgnoreCase).ToList();
        if (_enums.TryGetValue(name, out var e))
            return e.OrderBy(kv => kv.Value).Select(kv => $"{kv.Key} = {kv.Value}").ToList();
        var candidates = _members.Keys.Concat(_enums.Keys)
            .Where(k => k.Contains(name, StringComparison.OrdinalIgnoreCase)).OrderBy(k => k).Take(50).ToList();
        if (candidates.Count == 0)
            throw new RobotMcpException(ErrorCodes.NotFound, $"Aucun type RobotOM ne correspond à « {name} ».");
        return candidates.Select(c => "type: " + c).ToList();
    }

    public Guid CoclassId(string coclassName) =>
        _coclasses.TryGetValue(coclassName, out var g)
            ? g
            : throw new RobotMcpException(ErrorCodes.RobotApiMemberNotFound, $"Coclasse RobotOM « {coclassName} » introuvable dans {Source}.");
}
