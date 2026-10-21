import { describe, expect, it } from 'vitest';
import { contentSummary } from '../scripts/workspace-upgrade-check.mts';

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
});
