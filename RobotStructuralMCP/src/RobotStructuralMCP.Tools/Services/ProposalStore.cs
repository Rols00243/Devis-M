using System.Collections.Concurrent;

namespace RobotStructuralMCP.Tools.Services;

public sealed record SectionProposal(int Bar, string? CurrentSection, string ProposedSection, double? CurrentRatio, double? EstimatedRatio, string Basis);

public sealed record ProposalSet(string Id, DateTimeOffset CreatedAt, IReadOnlyList<SectionProposal> Items, string Method);

/// <summary>Propositions de sections conservées en mémoire jusqu'à application explicite (apply_section_proposals).</summary>
public sealed class ProposalStore
{
    private readonly ConcurrentDictionary<string, ProposalSet> _sets = new();
    private int _counter;

    public ProposalSet Add(IReadOnlyList<SectionProposal> items, string method)
    {
        var id = $"prop{Interlocked.Increment(ref _counter):D3}";
        var set = new ProposalSet(id, DateTimeOffset.UtcNow, items, method);
        _sets[id] = set;
        return set;
    }

    public ProposalSet? Get(string id) => _sets.TryGetValue(id, out var s) ? s : null;

    public ProposalSet? Latest => _sets.Values.OrderByDescending(s => s.CreatedAt).FirstOrDefault();
}
