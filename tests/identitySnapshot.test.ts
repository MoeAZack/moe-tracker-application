import { describe, expect, it } from 'vitest';
import {
  historicalPlayerLabel,
  mergeAcceptedPlayerStat,
  preserveIdentitySnapshot,
} from '../lib/identitySnapshot';
import { aggregateObservedPlayerKd } from '../lib/uiIntegration';

describe('S0.5 identity snapshot policy', () => {
  const accepted = {
    id: 'appearance-1', matchId: 'match-1', playerId: 'player-1',
    player: 'Alpha observed', displayNameSnapshot: 'Alpha observed',
    agent: 'Jett', appearanceType: 'tryout', kills: 10,
  };

  it('preserves accepted observations across routine resaves and current roster changes', () => {
    expect(preserveIdentitySnapshot(accepted, {
      ...accepted, playerId: 'player-2', player: 'Alpha renamed',
      displayNameSnapshot: 'Alpha renamed', agent: 'Sova', appearanceType: 'core', kills: 12,
    })).toEqual({ ...accepted, kills: 12 });
  });

  it('changes only explicitly corrected facts and retains linkage', () => {
    expect(preserveIdentitySnapshot(accepted, {
      ...accepted, playerId: 'player-2', displayNameSnapshot: 'Alpha corrected',
      player: 'Alpha corrected', agent: 'Raze', appearanceType: 'core',
    }, { fields: ['displayNameSnapshot', 'agent'], reason: 'Coach checked the source image.' })).toMatchObject({
      playerId: 'player-1', player: 'Alpha corrected', displayNameSnapshot: 'Alpha corrected',
      agent: 'Raze', appearanceType: 'tryout',
    });
  });

  it('does not backfill missing legacy snapshot fields during a merge', () => {
    const legacy = { id: 'legacy', matchId: 'match-1', player: 'Legacy Alpha', kills: 4 };
    expect(mergeAcceptedPlayerStat(legacy, {
      ...legacy, playerId: 'player-1', displayNameSnapshot: 'Current Alpha', agent: 'Jett', appearanceType: 'core', kills: 6,
    })).toEqual({ id: 'legacy', matchId: 'match-1', player: 'Legacy Alpha', kills: 6 });
    expect(historicalPlayerLabel(legacy)).toBe('Legacy Alpha');
  });

  it('never aggregates unlinked duplicate names as a proven identity', () => {
    const rows: any[] = [
      { id: 'one', matchId: 'm1', player: 'Same Name', kills: 10, deaths: 5 },
      { id: 'two', matchId: 'm2', player: 'Same Name', kills: 1, deaths: 5 },
    ];
    const result = aggregateObservedPlayerKd(rows);
    expect(result).toHaveLength(2);
    expect(result.map(row => row.identity)).toEqual(['unlinked:one', 'unlinked:two']);
  });
});
