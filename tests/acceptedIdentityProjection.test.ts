import { describe, expect, it } from 'vitest';
import { auditAcceptedAnonymousLeaks, buildAcceptedIdentityProjection } from '../lib/acceptedIdentityProjection';

const data: any = {
  settings: { players: [], maps: [], agents: [] }, rosterPlayers: [{ id: 'p1', displayName: 'Sandra' }], coreMemberships: [], tryoutBatches: [], seasonArchives: [],
  matches: [{ id: 'm1' }], playerStats: [{ id: 's1', matchId: 'm1', playerId: 'p1', player: 'Sandra', displayNameSnapshot: 'Sandra' }], rounds: [],
  engineAdapters: { replay: { m1: { status: 'accepted', overlay: { mappings: [{ parserPlayerId: 'player-592198cc9971c1a6', rosterPlayerId: 'p1', displayName: 'Sandra' }] } } } },
};

describe('accepted identity projection', () => {
  it('projects accepted parser IDs without rewriting raw evidence', () => {
    const projection = buildAcceptedIdentityProjection(data, 'm1');
    expect(projection.resolve('player-592198cc9971c1a6')).toMatchObject({ resolved: true, playerId: 'p1', displayName: 'Sandra', source: 'accepted-replay' });
    expect(data.engineAdapters.replay.m1.overlay.mappings[0].parserPlayerId).toBe('player-592198cc9971c1a6');
  });

  it('detects a materialized anonymous leak after accepted mapping', () => {
    expect(auditAcceptedAnonymousLeaks(data)).toEqual([]);
    const broken = structuredClone(data); broken.playerStats[0].displayNameSnapshot = 'Anonymous player 1';
    expect(auditAcceptedAnonymousLeaks(broken)).toEqual([expect.objectContaining({ reference: 'playerStats:s1' })]);
  });
});
