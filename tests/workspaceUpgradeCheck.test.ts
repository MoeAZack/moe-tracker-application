import { describe, expect, it } from 'vitest';
import { contentSummary, upgradeFailures } from '../scripts/workspace-upgrade-check.mts';

const state = () => ({
  matches: [{ id: 'm2', map: 'Bind', opponent: 'Synthetic B' }, { id: 'm1', map: 'Ascent', opponent: 'Synthetic A' }],
  rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, result: 'W' }],
  playerStats: [{ id: 's1', matchId: 'm1', kills: 12, deaths: 9 }],
});

describe('workspace upgrade check', () => {
  it('is independent of row and key order', () => {
    const shuffled = state(); shuffled.matches.reverse(); shuffled.rounds = [{ result: 'W', roundNo: 1, matchId: 'm1', id: 'r1' }];
    expect(contentSummary(shuffled)).toEqual(contentSummary(state()));
  });

  it('changes the content hash when any stored value changes, but not the ids hash', () => {
    const changed = state(); changed.playerStats[0].kills = 13;
    const [a, b] = [contentSummary(state()), contentSummary(changed)];
    expect(b.playerStats.contentSha256).not.toBe(a.playerStats.contentSha256);
    expect(b.playerStats.idsSha256).toBe(a.playerStats.idsSha256);
    const dropped = state(); dropped.rounds = [];
    expect(contentSummary(dropped).rounds).toMatchObject({ count: 0 });
  });

  it('reports a duplicate quarantine without counting it as a content change', () => {
    const quarantined = state(); (quarantined.matches[0] as any).duplicateReview = { status: 'quarantined' };
    const summary = contentSummary(quarantined);
    expect(summary.quarantinedMatches).toBe(1);
    expect(summary.matches.contentSha256).toBe(contentSummary(state()).matches.contentSha256);
    expect(summary.matches.fields).toContain('duplicateReview');
  });

  it('prints no row values', () => {
    expect(JSON.stringify(contentSummary(state()))).not.toMatch(/Synthetic|Ascent|Bind/);
  });

  const snapshots = (read: (state: any) => any) => {
    const base = state(); (base.matches[1] as any).roundAnalytics = { stale: true }; (base.playerStats[0] as any).screenshotMetrics = { calculationVersion: 'old' };
    const summary = contentSummary(base);
    return { stored: summary, before: summary, afterFile: summary, firstRead: contentSummary(read(structuredClone(base))), secondRead: contentSummary(read(structuredClone(base))), afterRead: contentSummary(read(structuredClone(base))) };
  };

  it('accepts server reads that rebuild or withhold derived aggregates consistently', () => {
    const rebuilt = snapshots(copy => { copy.matches[1].roundAnalytics = { rebuilt: 1 }; delete copy.playerStats[0].screenshotMetrics; return copy; });
    expect(upgradeFailures(rebuilt)).toEqual([]);
  });

  it('fails when derived aggregates differ between reads, naming the field', () => {
    let call = 0;
    const unstable = snapshots(copy => { copy.matches[1].roundAnalytics = { rebuilt: call++ }; return copy; });
    expect(upgradeFailures(unstable)).toEqual([
      'second 0.2.0 read vs first: matches.contentSha256 changed (fields: roundAnalytics)',
      'read after save vs first: matches.contentSha256 changed (fields: roundAnalytics)',
    ]);
  });

  it('fails when a read changes a source field, naming only that field', () => {
    const drifted = snapshots(copy => { copy.matches[1].roundAnalytics = { rebuilt: 1 }; copy.matches[0].map = 'Haven'; return copy; });
    const failures = upgradeFailures(drifted);
    expect(failures).toContain('first 0.2.0 read: matches.sourceContentSha256 changed (fields: map)');
    expect(JSON.stringify(failures)).not.toMatch(/Haven|Bind|Synthetic/);
  });

  it('compares the migrated file exactly, derived aggregates included', () => {
    const base = snapshots(copy => copy);
    const migrated = structuredClone(state()); (migrated.matches[1] as any).roundAnalytics = { stale: false }; (migrated.playerStats[0] as any).screenshotMetrics = { calculationVersion: 'old' };
    expect(upgradeFailures({ ...base, afterFile: contentSummary(migrated) })).toEqual(['migrated file: matches.contentSha256 changed (fields: roundAnalytics)']);
  });
});
