# robot_mcp.py — serveur MCP reliant Claude à Autodesk Robot Structural Analysis.
#
# Windows uniquement (API COM RobotOM). Robot doit être installé et sous licence.
# Installation : pip install -r requirements.txt  (mcp<2 : FastMCP est renommé en 2.x)
# Lancement    : lancé automatiquement par Claude Desktop / Claude Code (voir README.md).
#
# Important : le transport MCP passe par stdin/stdout, donc aucun print() ici.

import pythoncom
import win32com.client
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("robot")

_robot = None


def robot():
    """Connexion paresseuse à Robot : le serveur démarre même si Robot est fermé."""
    global _robot
    # COM doit être initialisé dans chaque thread qui l'utilise.
    pythoncom.CoInitialize()
    if _robot is None:
        try:
            _robot = win32com.client.Dispatch("Robot.Application")
        except pythoncom.com_error as e:
            raise RuntimeError(
                "Impossible de se connecter à Robot (installé ? licence active ?)"
            ) from e
        _robot.Visible = True
        _robot.Interactive = True
    return _robot


def structure():
    return robot().Project.Structure


@mcp.tool()
def structure_info() -> dict:
    """Résumé du projet Robot ouvert : nombre de nœuds, de barres et de cas de charge."""
    s = structure()
    return {
        "noeuds": s.Nodes.GetAll().Count,
        "barres": s.Bars.GetAll().Count,
        "cas_de_charge": s.Cases.GetAll().Count,
        "resultats_disponibles": bool(s.Results.Available),
    }


@mcp.tool()
def create_node(num: int, x: float, y: float, z: float) -> str:
    """Crée un nœud (coordonnées en mètres)."""
    nodes = structure().Nodes
    if nodes.Exist(num):
        return f"Le nœud {num} existe déjà"
    nodes.Create(num, x, y, z)
    return f"Nœud {num} créé en ({x}, {y}, {z})"


@mcp.tool()
def create_bar(num: int, n1: int, n2: int) -> str:
    """Crée une barre entre deux nœuds existants."""
    s = structure()
    missing = [n for n in (n1, n2) if not s.Nodes.Exist(n)]
    if missing:
        return f"Nœud(s) inexistant(s) : {missing}"
    if s.Bars.Exist(num):
        return f"La barre {num} existe déjà"
    s.Bars.Create(num, n1, n2)
    return f"Barre {num} créée ({n1} → {n2})"


@mcp.tool()
def run_analysis() -> str:
    """Lance le calcul de la structure."""
    code = robot().Project.CalcEngine.Calculate()
    return "Calcul terminé" if code == 0 else f"Calcul terminé avec le code {code}"


@mcp.tool()
def bar_forces(bar: int, case: int, pos: float = 0.5) -> dict:
    """Efforts dans une barre pour un cas de charge (pos : 0 à 1 le long de la barre).

    Unités Robot par défaut : N et N·m.
    """
    if not 0 <= pos <= 1:
        raise ValueError("pos doit être compris entre 0 et 1")
    s = structure()
    if not s.Results.Available:
        raise RuntimeError("Aucun résultat : lancez d'abord run_analysis")
    f = s.Results.Bars.Forces.Value(bar, case, pos)
    return {"N": f.FX, "Vy": f.FY, "Vz": f.FZ, "Mx": f.MX, "My": f.MY, "Mz": f.MZ}


if __name__ == "__main__":
    mcp.run()
