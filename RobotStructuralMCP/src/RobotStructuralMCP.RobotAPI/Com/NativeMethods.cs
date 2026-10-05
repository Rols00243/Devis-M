using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

namespace RobotStructuralMCP.RobotAPI.Com;

/// <summary>Déclarations Win32/OLE nécessaires (aucune dépendance à Interop.RobotOM.dll).</summary>
internal static class NativeMethods
{
    public const int S_OK = 0;
    public const int MK_E_UNAVAILABLE = unchecked((int)0x800401E3);
    public const int DISP_E_UNKNOWNNAME = unchecked((int)0x80020006);
    public const int DISP_E_MEMBERNOTFOUND = unchecked((int)0x80020003);
    public const int RPC_E_SERVERCALL_RETRYLATER = unchecked((int)0x8001010A);
    public const int RPC_E_CALL_REJECTED = unchecked((int)0x80010001);
    public const int RPC_E_DISCONNECTED = unchecked((int)0x80010108);
    public const int RPC_S_SERVER_UNAVAILABLE = unchecked((int)0x800706BA);
    public const int RPC_S_CALL_FAILED = unchecked((int)0x800706BE);
    public const int CO_E_OBJNOTCONNECTED = unchecked((int)0x800401FD);

    [DllImport("ole32.dll", CharSet = CharSet.Unicode)]
    public static extern int CLSIDFromProgID(string progId, out Guid clsid);

    [DllImport("oleaut32.dll")]
    public static extern int GetActiveObject(ref Guid rclsid, IntPtr reserved, [MarshalAs(UnmanagedType.IUnknown)] out object? ppunk);

    /// <summary>REGKIND_NONE = 2 : charge la bibliothèque sans l'enregistrer.</summary>
    [DllImport("oleaut32.dll", CharSet = CharSet.Unicode)]
    public static extern int LoadTypeLibEx(string szFile, int regkind, out ITypeLib? pptlib);
}

/// <summary>Vue minimale d'IDispatch permettant de récupérer l'ITypeInfo d'un objet COM.</summary>
[ComImport]
[Guid("00020400-0000-0000-C000-000000000046")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IDispatchInfo
{
    [PreserveSig] int GetTypeInfoCount(out uint pctinfo);
    [PreserveSig] int GetTypeInfo(uint iTInfo, int lcid, out ITypeInfo? ppTInfo);
}
