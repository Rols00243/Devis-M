using System.Text.Json.Serialization;

namespace RobotStructuralMCP.Core.Geometry;

/// <summary>Point 3D en mètres (repère global Robot).</summary>
public readonly record struct Point3(
    [property: JsonPropertyName("x")] double X,
    [property: JsonPropertyName("y")] double Y,
    [property: JsonPropertyName("z")] double Z)
{
    public static Point3 operator +(Point3 a, Point3 b) => new(a.X + b.X, a.Y + b.Y, a.Z + b.Z);
    public static Point3 operator -(Point3 a, Point3 b) => new(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
    public static Point3 operator *(Point3 a, double k) => new(a.X * k, a.Y * k, a.Z * k);
    public double Length => Math.Sqrt(X * X + Y * Y + Z * Z);
    public double DistanceTo(Point3 o) => (this - o).Length;
    public static Point3 Cross(Point3 a, Point3 b) => new(a.Y * b.Z - a.Z * b.Y, a.Z * b.X - a.X * b.Z, a.X * b.Y - a.Y * b.X);
    public static double Dot(Point3 a, Point3 b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z;
}

public static class GeometryMath
{
    public const double Tolerance = 1e-6;

    /// <summary>Normale (non normalisée, méthode de Newell) d'un contour plan.</summary>
    public static Point3 Normal(IReadOnlyList<Point3> pts)
    {
        double nx = 0, ny = 0, nz = 0;
        for (int i = 0; i < pts.Count; i++)
        {
            var a = pts[i];
            var b = pts[(i + 1) % pts.Count];
            nx += (a.Y - b.Y) * (a.Z + b.Z);
            ny += (a.Z - b.Z) * (a.X + b.X);
            nz += (a.X - b.X) * (a.Y + b.Y);
        }
        return new Point3(nx, ny, nz);
    }

    /// <summary>Aire d'un polygone 3D plan (m²).</summary>
    public static double Area(IReadOnlyList<Point3> pts) => pts.Count < 3 ? 0 : Normal(pts).Length / 2;

    /// <summary>Écart maximal des sommets au plan moyen (m) — 0 pour un contour plan.</summary>
    public static double PlanarityDeviation(IReadOnlyList<Point3> pts)
    {
        if (pts.Count < 4) return 0;
        var n = Normal(pts);
        var len = n.Length;
        if (len < Tolerance) return double.PositiveInfinity;
        n = n * (1 / len);
        var c = new Point3(pts.Average(p => p.X), pts.Average(p => p.Y), pts.Average(p => p.Z));
        return pts.Max(p => Math.Abs(Point3.Dot(p - c, n)));
    }

    /// <summary>Orientation d'un panneau : horizontal (dalle), vertical (voile) ou incliné.</summary>
    public static string Orientation(IReadOnlyList<Point3> pts)
    {
        var n = Normal(pts);
        var len = n.Length;
        if (len < Tolerance) return "degenerate";
        var cz = Math.Abs(n.Z / len);
        if (cz > 0.999) return "horizontal";
        if (cz < 0.001) return "vertical";
        return "inclined";
    }

    /// <summary>Rôle structurel déduit de la géométrie d'une barre : poteau (verticale), poutre (horizontale) ou barre inclinée.</summary>
    public static string BarRole(Point3 a, Point3 b)
    {
        var d = b - a;
        var len = d.Length;
        if (len < Tolerance) return "degenerate";
        var cz = Math.Abs(d.Z / len);
        if (cz > 0.995) return "column";
        if (cz < 0.005) return "beam";
        return "inclined";
    }
}
