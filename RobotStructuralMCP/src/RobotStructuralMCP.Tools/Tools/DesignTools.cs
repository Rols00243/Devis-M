using System.ComponentModel;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using RobotStructuralMCP.Core.Abstractions;
using RobotStructuralMCP.Core.Models;
using RobotStructuralMCP.Safety;
using RobotStructuralMCP.Tools.Infrastructure;
using RobotStructuralMCP.Tools.Services;

namespace RobotStructuralMCP.Tools.Tools;

/// <summary>
/// Dimensionnement. Règle : aucun calcul réglementaire n'est inventé.
/// - Acier : vérification via le module RDimServer de Robot (seul module de dimensionnement appelé).
/// - Béton armé, dalles, fondations : non exposés de façon vérifiée par RobotOM → limitation explicite,
///   données disponibles, et proposition d'un module de calcul externe séparé.
/// </summary>
[McpServerToolType]
public sealed class DesignTools(ToolRunner runner, IRobotGateway gateway, ModelService model, ResultService results)
{
    [McpServerTool(Name = "check_steel_member", ReadOnly = true)]
    [Description("Vérification des barres acier par le module de dimensionnement acier de Robot (RDimServer, ELU) selon la norme acier configurée dans Robot : taux de travail, cas déterminant. Les barres béton sont ignorées.")]
    public Task<CallToolResult> CheckSteelMember(int[]? bar_ids = null, string? selection = null, string? group = null,
        BarRoleFilter role = BarRoleFilter.Any, [Description("Cas/combinaisons ELU (vide = toutes les combinaisons ULS, sinon tous les cas).")] int[]? case_ids = null) =>
        runner.RunAsync("check_steel_member", SafetyLevel.Read, new { bar_ids, selection, group, role, case_ids }, ctx =>
            SteelCheck(ctx, model, gateway, results, bar_ids, selection, group, role, case_ids));

    internal static object SteelCheck(OperationContext ctx, ModelService model, IRobotGateway gateway, ResultService results,
        int[]? barIds, string? selection, string? group, BarRoleFilter role, int[]? caseIds)
    {
        results.EnsureResults();
        var bars = model.ResolveBars(barIds, selection, group, role);
        var sections = gateway.GetSections().ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
        var steel = bars.Where(b => b.Section is not null && sections.TryGetValue(b.Section, out var s) && !s.IsConcrete).Select(b => b.Id).ToList();
        var skipped = bars.Select(b => b.Id).Except(steel).ToList();
        if (skipped.Count > 0)
            ctx.Warn("NON_STEEL_SKIPPED", $"Barres non acier (béton ou sans section) non vérifiées par le module acier : {SelectionParser.Format(skipped.Take(200))}.");
        if (steel.Count == 0) return new { checks = Array.Empty<object>(), note = "Aucune barre acier dans la sélection." };
        var cases = caseIds is { Length: > 0 } ? caseIds.ToList()
            : gateway.GetCombinations().Where(c => c.Type == "ULS").Select(c => c.Id).DefaultIfEmpty().Where(i => i > 0).ToList();
        if (cases.Count == 0)
        {
            cases = gateway.GetLoadCases().Where(c => c.Kind == "simple").Select(c => c.Id).ToList();
            ctx.Warn("NO_ULS_COMBINATIONS", "Aucune combinaison ELU : vérification sur les cas simples (non représentative d'une vérification ELU).");
        }
        var checks = gateway.RunSteelMemberVerification(steel, cases);
        return new
        {
            checks = checks.Select(c => new { member = c.Member, section = c.Section, ratio = c.Ratio is { } r ? Math.Round(r, 3) : (double?)null, governing_case = c.GoverningCase, status = c.Status, c.Extra }),
            cases = cases,
            method = "Module de dimensionnement acier de Robot (RDimServer), norme acier active du projet.",
        };
    }

    [McpServerTool(Name = "design_steel_member", ReadOnly = true)]
    [Description("Dimensionnement automatique de profils acier. Limitation : le dimensionnement de groupes de Robot n'est pas exposé de façon vérifiée ; renvoie les taux actuels et oriente vers optimize_sections (propositions sans application).")]
    public Task<CallToolResult> DesignSteelMember(int[]? bar_ids = null, string? group = null, int[]? case_ids = null) =>
        runner.RunAsync("design_steel_member", SafetyLevel.Read, new { bar_ids, group, case_ids }, ctx =>
        {
            object? current = null;
            try
            {
                current = SteelCheck(ctx, model, gateway, results, bar_ids, null, group, BarRoleFilter.Any, case_ids);
            }
            catch (Core.Errors.RobotMcpException ex)
            {
                current = new { unavailable = ex.Message };
            }
            throw new LimitationException(
                "Le dimensionnement automatique (groupes de dimensionnement Robot, I_DCPVT_GROUPS_DESIGN) n'est pas implémenté : son paramétrage via RobotOM n'a pas pu être vérifié.",
                new
                {
                    available_data = current,
                    alternative = "optimize_sections (propositions à partir de sections candidates existantes, puis check_steel_member après application).",
                });
        });

    private object Limitation(string element, IReadOnlyList<BarData> bars, string proposal)
    {
        var sections = gateway.GetSections().ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
        object? envelope = null;
        if (bars.Count > 0 && gateway.ResultsAvailable())
        {
            var cases = gateway.GetCombinations().Select(c => c.Id).ToList();
            var caseData = model.ResolveCases(cases.Count > 0 ? cases : null);
            envelope = ResultService.Envelope(results.BarForces(bars.Take(200).ToList(), caseData, ResultService.Positions(5)));
        }
        throw new LimitationException(
            $"Le ferraillage / la vérification {element} de Robot (modules BA) n'est pas exposé par une API RobotOM vérifiée : aucun calcul n'est simulé par ce serveur.",
            new
            {
                limitation = "Modules de ferraillage BA (calcul théorique/réel des armatures) non pilotables de façon vérifiée via RobotOM.",
                available_data = new
                {
                    members = bars.Take(200).Select(b => new
                    {
                        bar = b.Id, length_m = Math.Round(b.Length, 3), section = b.Section, material = b.Material,
                        dimensions_m = b.Section is not null && sections.TryGetValue(b.Section, out var s) ? s.Dimensions : null,
                    }),
                    force_envelope = envelope,
                    units = ResultService.ForceUnits,
                },
                external_module_proposal = proposal,
                in_robot = "Dans Robot : Dimensionnement > Ferraillage théorique / Ferraillage réel des éléments BA.",
            });
    }

    private const string RcProposal =
        "Module externe séparé « RobotStructuralMCP.Design.RC » (à développer) : lit les efforts enveloppes exportés par get_result_envelope, " +
        "applique l'EN 1992-1-1 (flexion simple/composée, effort tranchant, ELS) avec matériaux et enrobages explicites, et renvoie As requis — validé par un ingénieur.";

    [McpServerTool(Name = "check_rc_beam", ReadOnly = true)]
    [Description("Vérification d'une poutre BA. Limitation API : renvoie les données disponibles (section, matériau, enveloppe d'efforts) et la proposition de module externe.")]
    public Task<CallToolResult> CheckRcBeam(int[] bar_ids) =>
        runner.RunAsync("check_rc_beam", SafetyLevel.Read, new { bar_ids }, _ => Limitation("des poutres BA", model.ResolveBars(bar_ids, null, null), RcProposal));

    [McpServerTool(Name = "design_rc_beam", ReadOnly = true)]
    [Description("Ferraillage d'une poutre BA. Limitation API : données disponibles + module externe proposé.")]
    public Task<CallToolResult> DesignRcBeam(int[] bar_ids) =>
        runner.RunAsync("design_rc_beam", SafetyLevel.Read, new { bar_ids }, _ => Limitation("des poutres BA", model.ResolveBars(bar_ids, null, null), RcProposal));

    [McpServerTool(Name = "check_rc_column", ReadOnly = true)]
    [Description("Vérification d'un poteau BA (taux de travail). Limitation API : données disponibles + module externe proposé.")]
    public Task<CallToolResult> CheckRcColumn(int[] bar_ids) =>
        runner.RunAsync("check_rc_column", SafetyLevel.Read, new { bar_ids }, _ => Limitation("des poteaux BA", model.ResolveBars(bar_ids, null, null), RcProposal));

    [McpServerTool(Name = "design_rc_column", ReadOnly = true)]
    [Description("Ferraillage d'un poteau BA. Limitation API : données disponibles + module externe proposé.")]
    public Task<CallToolResult> DesignRcColumn(int[] bar_ids) =>
        runner.RunAsync("design_rc_column", SafetyLevel.Read, new { bar_ids }, _ => Limitation("des poteaux BA", model.ResolveBars(bar_ids, null, null), RcProposal));

    [McpServerTool(Name = "design_rc_slab", ReadOnly = true)]
    [Description("Ferraillage de dalle / voile BA. Limitation API : renvoie les panneaux concernés ; utiliser get_panel_results pour les moments par mètre.")]
    public Task<CallToolResult> DesignRcSlab(int[] panel_ids) =>
        runner.RunAsync("design_rc_slab", SafetyLevel.Read, new { panel_ids }, _ =>
        {
            model.RequirePanels(panel_ids);
            throw new LimitationException(
                "Le ferraillage des panneaux BA de Robot n'est pas exposé par une API RobotOM vérifiée.",
                new
                {
                    available_data = new { panels = gateway.GetPanels(panel_ids).Select(Out.Panel), results_tool = "get_panel_results (MXX, MYY, MXY en kNm/m ; NXX… en kN/m)" },
                    external_module_proposal = "Module externe : méthode de Wood–Armer sur les moments get_panel_results puis EN 1992-1-1 — validé par un ingénieur.",
                    in_robot = "Dans Robot : Dimensionnement > Ferraillage des plaques et coques.",
                });
        });

    [McpServerTool(Name = "design_foundation", ReadOnly = true)]
    [Description("Dimensionnement de fondations. Limitation API : renvoie les réactions d'appui disponibles (descente de charges) et la proposition de module externe.")]
    public Task<CallToolResult> DesignFoundation(int[]? node_ids = null) =>
        runner.RunAsync("design_foundation", SafetyLevel.Read, new { node_ids }, _ =>
        {
            object? reactions = null;
            if (gateway.ResultsAvailable())
            {
                var supported = gateway.GetSupports().SelectMany(s => s.Nodes).Distinct().ToList();
                if (node_ids is { Length: > 0 }) supported = supported.Intersect(node_ids).ToList();
                var cases = gateway.GetCombinations().Select(c => c.Id).ToList();
                reactions = supported.Take(200).SelectMany(n => model.ResolveCases(cases.Count > 0 ? cases : null).Select(c => ResultService.ReactionRow(gateway.GetNodeReaction(n, c.Id)))).ToList();
            }
            throw new LimitationException(
                "Le module « Fondations » de Robot n'est pas exposé par une API RobotOM vérifiée.",
                new
                {
                    available_data = new { reactions, units = ResultService.ReactionUnits, note = reactions is null ? "Lancer le calcul pour obtenir les réactions." : null },
                    external_module_proposal = "Module externe : semelles isolées/filantes à partir des réactions ELU/ELS, contrainte admissible du sol fournie explicitement (EN 1997), puis EN 1992 pour le ferraillage.",
                });
        });
}
