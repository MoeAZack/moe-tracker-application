import { describe, expect, it } from 'vitest';
import {
  historicalPlayerLabel,
  mergeAcceptedPlayerStat,
  playerAggregationKey,
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

  it('changes or clears only an explicitly corrected stable link', () => {
    expect(preserveIdentitySnapshot(accepted, { ...accepted, playerId: 'player-2', agent: 'Sova' }, {
      fields: ['playerId'], reason: 'Wrong roster link was confirmed.',
    })).toMatchObject({ playerId: 'player-2', agent: 'Jett', displayNameSnapshot: 'Alpha observed', appearanceType: 'tryout' });
    expect(preserveIdentitySnapshot(accepted, { ...accepted, playerId: null }, {
      fields: ['playerId'], reason: 'The appearance is unmatched.',
    })).toMatchObject({ playerId: null, displayNameSnapshot: 'Alpha observed', agent: 'Jett', appearanceType: 'tryout' });
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

  it('keys same-name and renamed linked appearances by stable identity', () => {
    expect(playerAggregationKey({ id: 'a', playerId: 'player-a' })).toBe('player:player-a');
    expect(playerAggregationKey({ id: 'b', playerId: 'player-b' })).toBe('player:player-b');
    expect(playerAggregationKey({ id: 'later', playerId: 'player-a' })).toBe('player:player-a');
    const rows: any[] = [
      { id: 'a-old', matchId: 'm1', playerId: 'player-a', displayNameSnapshot: 'Old Alpha', kills: 10, deaths: 5 },
      { id: 'a-new', matchId: 'm2', playerId: 'player-a', displayNameSnapshot: 'Renamed Alpha', kills: 5, deaths: 5 },
      { id: 'b-same-name', matchId: 'm3', playerId: 'player-b', displayNameSnapshot: 'Old Alpha', kills: 1, deaths: 2 },
    ];
    const aggregates = aggregateObservedPlayerKd(rows);
    expect(aggregates).toHaveLength(2);
    expect(aggregates.find(row => row.playerId === 'player-a')).toMatchObject({ recordedRows: 2, kd: 1.5 });
    expect(aggregates.find(row => row.playerId === 'player-b')).toMatchObject({ recordedRows: 1, kd: 0.5 });
  });
});
