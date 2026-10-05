namespace RobotStructuralMCP.Server;

internal static class ServerInstructions
{
    public const string Text = """
        Serveur MCP de pilotage d'Autodesk Robot Structural Analysis Professional (RobotOM).
        Règles d'usage :
        1. Commencer par robot_connect puis robot_get_project_info / get_model_summary.
        2. Unités : tout paramètre dimensionné a une unité OBLIGATOIRE (length_unit, force_unit, load_unit…). Ne jamais deviner une unité : la demander à l'utilisateur si elle est ambiguë. Les résultats indiquent toujours leurs unités (efforts kN, moments kNm, déplacements mm, contraintes MPa).
        3. Charges de gravité : composante Z NÉGATIVE (vers le bas), sauf apply_standard_building_loads qui prend des valeurs positives.
        4. Préférer les tools batch (create_nodes, create_bars, assign_sections, apply_loads) et de haut niveau (create_rc_building, create_3d_frame, analyze_structure).
        5. Opérations DESTRUCTIVES (suppression massive, écrasement, restauration, rollback) : le premier appel renvoie CONFIRMATION_REQUIRED et un confirmation_token. Demander l'accord EXPLICITE de l'utilisateur avant de rappeler le tool avec ce jeton.
        6. Aucune norme n'est supposée : generate_combinations exige norm=EN1990 ou from_project, et des coefficients ψ explicites.
        7. Ne jamais présenter un calcul comme réussi si success=false. Transmettre les messages du solveur.
        8. Quand l'API Robot ne permet pas une opération (ferraillage BA, fondations…), le tool renvoie NOT_SUPPORTED_BY_ROBOT_API avec les données disponibles : l'expliquer à l'utilisateur, ne pas inventer de résultat.
        9. « Proposer sans appliquer » : optimize_sections (lecture seule) puis apply_section_proposals avec le sous-ensemble choisi.
        """;
}
