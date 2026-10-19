import { describe, expect, it } from 'vitest';
import { currentAnalyticsIdentityPolicy, projectCurrentPlayerAnalytics } from '../lib/activePlayerAnalytics';
import { buildWeaponRoundOutcomesByEconomy } from '../src/components/EconomyAnalytics';

describe('current player analytics projection', () => {
  it('removes one archived identity from every player metric source while preserving team round history', () => {
    const raw: any = {
      rosterPlayers: [
        { id: 'active', displayName: 'caelia', createdAt: '2026-10-01' },
        { id: 'archived', displayName: 'twitch elyystan', createdAt: '2026-10-01', retiredAt: '2026-10-18' },
      ],
      playerStats: [
        { id: 'sa', matchId: 'm1', playerId: 'active', player: 'caelia' },
        { id: 'sx', matchId: 'm1', playerId: 'archived', player: 'twitch elyystan' },
      ],
      rounds: [{
        id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', result: 'W',
        screenshotEvidence: {
          schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'confirmed', eventsComplete: true, openingEventComplete: true,
          ourAverageLoadout: 3_000, ourAverageBank: 1_000,
          players: [
            { playerId: 'active', displayName: 'caelia', team: 'ours', equippedWeapon: 'Vandal', loadoutValue: 3_900, bank: 800, survived: true },
            { playerId: 'archived', displayName: 'twitch elyystan', team: 'ours', equippedWeapon: 'Operator', loadoutValue: 4_700, bank: 1_200, survived: false },
            { playerId: 'enemy', displayName: 'Opponent', team: 'theirs', equippedWeapon: 'Phantom', survived: false },
          ],
          events: [
            { sequence: 1, killerPlayerId: 'archived', victimPlayerId: 'enemy', killerTeam: 'ours', victimTeam: 'theirs' },
            { sequence: 2, killerPlayerId: 'active', victimPlayerId: 'enemy-2', killerTeam: 'ours', victimTeam: 'theirs' },
          ],
          objectives: [{ type: 'plant', playerId: 'archived', team: 'ours' }],
        },
      }],
      soloq: [{ id: 'qa', date: '2026-10-18', player: 'caelia', wins: 1, losses: 0 }, { id: 'qx', date: '2026-10-18', player: 'twitch elyystan', wins: 3, losses: 0 }],
    };

    const projected = projectCurrentPlayerAnalytics(raw);
    expect(projected.playerStats.map(row => row.id)).toEqual(['sa']);
    expect(projected.soloq.map(row => row.id)).toEqual(['qa']);
    expect(projected.rounds).toHaveLength(1);
    expect(projected.rounds[0].result).toBe('W');
    expect(projected.rounds[0].screenshotEvidence.players.map((player: any) => player.displayName)).toEqual(['caelia', 'Opponent']);
    expect(projected.rounds[0].screenshotEvidence.events).toEqual([expect.objectContaining({ killerPlayerId: 'active' })]);
    expect(projected.rounds[0].screenshotEvidence.objectives).toEqual([]);
    expect(projected.rounds[0].screenshotEvidence).toMatchObject({ eventsComplete: false, openingEventComplete: false, ourAverageLoadout: 3900, ourAverageBank: 800 });
    expect(buildWeaponRoundOutcomesByEconomy(projected.rounds).flatMap(group => group.outcomes.map(row => row.weapon))).toEqual(['Vandal']);

    // Projection is read-only: Review still receives the preserved source.
    expect(raw.playerStats).toHaveLength(2);
    expect(raw.rounds[0].screenshotEvidence.players).toHaveLength(3);
  });

  it('keeps repaired historical evidence when a different live identity proves the same observed player remains current', () => {
    const data: any = {
      rosterPlayers: [{ id: 'old', displayName: 'bellatr1x', retiredAt: '2026-10-18' }],
      playerStats: [
        { id: 'historical', matchId: 'm1', playerId: 'old', displayNameSnapshot: 'bellatr1x' },
        { id: 'current', matchId: 'm2', playerId: 'replay-current', displayNameSnapshot: 'bellatrix' },
      ],
    };
    const policy = currentAnalyticsIdentityPolicy(data);
    expect(policy.isVisible('old', 'bellatr1x')).toBe(true);
    expect(projectCurrentPlayerAnalytics({ ...data, rounds: [], soloq: [] }).playerStats.map(row => row.id)).toEqual(['historical', 'current']);
  });

  it('keeps an archived name tombstoned when no current evidence identity replaces it', () => {
    const data: any = {
      rosterPlayers: [{ id: 'old', displayName: 'twitch elyystan', retiredAt: '2026-10-18' }],
      playerStats: [], rounds: [], soloq: [{ id: 'q', player: 'Twitch Elyystan', date: '2026-10-18', wins: 1, losses: 0 }],
    };
    expect(projectCurrentPlayerAnalytics(data).soloq).toEqual([]);
  });
});
