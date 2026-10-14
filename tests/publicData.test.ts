import { afterEach, describe, expect, it } from 'vitest';
import { stripLegacySecrets, toPublicTrackerData, toWebsiteTrackerData } from '../lib/publicData';

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

describe('public tracker data', () => {
  it('projects legacy player selectors from canonical active core membership', () => {
    const result = toPublicTrackerData({
      settings: { players: ['Shalaby', 'Shniider'], inactivePlayers: ['Former'] },
      rosterPlayers: [{ id: 'active', displayName: 'Ahmed' }, { id: 'retired', displayName: 'Old', retiredAt: '2026-01-01T00:00:00.000Z' }],
      coreMemberships: [{ id: 'ended', playerId: 'active', endedAt: '2026-02-01T00:00:00.000Z' }],
    });

    expect(result.settings.players).toEqual([]);
    expect(result.settings.inactivePlayers).toEqual([]);
    expect(JSON.stringify(result.settings)).not.toMatch(/Shalaby|Shniider|Former/);
  });

  it('never returns auth records or credential values', () => {
    process.env.GRID_API_KEY = 'server-only';
    const result = toPublicTrackerData({
      authKeys: [{ key: 'coach-key' }],
      allowedUsers: [{ email: 'coach@example.com' }],
      secretValues: { GRID_API_KEY: 'database-secret' },
      settings: {
        teamName: 'RAAD',
        gridApiKey: 'legacy-grid',
        henrikApiKey: 'legacy-henrik',
        discordWebhook: 'https://discord.example/hook'
      },
      matches: []
    });

    expect(result).not.toHaveProperty('authKeys');
    expect(result).not.toHaveProperty('allowedUsers');
    expect(result).not.toHaveProperty('secretValues');
    expect(result.settings).toEqual({ teamName: 'RAAD' });
    expect(result.secrets.GRID_API_KEY).toBe(true);
    expect(JSON.stringify(result)).not.toContain('server-only');
  });

  it('scrubs legacy secrets from backup imports', () => {
    const result = stripLegacySecrets({
      secretValues: { GRID_API_KEY: 'secret' },
      settings: { teamName: 'RAAD', gridApiKey: 'secret' }
    });
    expect(result).toEqual({ settings: { teamName: 'RAAD' } });
  });

  it('keeps archive bodies and Riot IDs coach-only', () => {
    const db = {
      settings: { teamName: 'RAAD', riotIds: { Alpha: { name: 'Private', tag: 'TAG', region: 'eu' } } },
      seasonArchives: [{
        id: 'archive-1', name: 'Private season', riotIds: { Alpha: { tag: 'TAG' } },
        vodReviews: [{ id: 'private-vod', notes: [{ text: 'private coaching note' }] }],
        accessIdentities: { authKeys: [{ keyHash: 'ARCHIVED-KEY-HASH' }], allowedUsers: [{ email: 'private@example.com' }] },
        engineAdapters: { replay: { one: 'ARCHIVED-REPLAY-EVIDENCE' } }, replayIntake: { devices: { one: { tokenHash: 'ARCHIVED-TOKEN-HASH' } } },
      }],
      vodReviews: [{ id: 'active-vod' }],
    };

    const player = toPublicTrackerData(db, 'player');
    expect(player.settings).not.toHaveProperty('riotIds');
    expect(player.seasonArchives).toEqual([]);
    expect(JSON.stringify(player)).not.toContain('private coaching note');
    expect(player.vodReviews).toEqual([]);

    const coach = toPublicTrackerData(db, 'coach');
    expect(coach.settings.riotIds.Alpha.tag).toBe('TAG');
    expect(coach.seasonArchives[0].vodReviews[0].id).toBe('private-vod');
    expect(JSON.stringify(coach)).not.toContain('ARCHIVED-KEY-HASH'); expect(JSON.stringify(coach)).not.toContain('private@example.com'); expect(JSON.stringify(coach)).not.toContain('ARCHIVED-REPLAY-EVIDENCE'); expect(JSON.stringify(coach)).not.toContain('ARCHIVED-TOKEN-HASH');
  });

  it('never includes private replay intake or engine-adapter stores in the generic payload', () => {
    const privateStores = {
      replayIntake: {
        devices: { device: { tokenHash: 'TOKEN-HASH', owner: { actorId: 'PRIVATE-ACTOR' } } },
        associations: { receipt: { deviceId: 'PRIVATE-DEVICE', owner: { playerId: 'PRIVATE-PLAYER' } } },
        reviews: { replay: { mappings: [{ parserPlayerId: 'RAW-IDENTITY', rosterPlayerId: 'PRIVATE-PLAYER' }] } },
      },
      engineAdapters: { replay: { match: { draft: { observations: ['PRIVATE-OBSERVATION'] } } }, ratings: { records: { one: { input: 'PRIVATE-RATING-INPUT' } } } },
      matches: [{ id: 'safe-match' }], settings: { teamName: 'RAAD' },
    };
    for (const role of ['coach', 'player'] as const) {
      const result = toPublicTrackerData(privateStores, role); const serialized = JSON.stringify(result);
      expect(result.matches).toEqual([{ id: 'safe-match' }]); expect(result).not.toHaveProperty('replayIntake'); expect(result).not.toHaveProperty('engineAdapters');
      for (const marker of ['TOKEN-HASH', 'PRIVATE-ACTOR', 'PRIVATE-DEVICE', 'PRIVATE-PLAYER', 'RAW-IDENTITY', 'PRIVATE-OBSERVATION', 'PRIVATE-RATING-INPUT']) expect(serialized).not.toContain(marker);
    }
  });

  it('projects only accepted website summary fields and drops detailed desktop evidence', () => {
    const result = toWebsiteTrackerData({
      settings: { teamName: 'RAAD', theme: 'slate', riotIds: { Alpha: { name: 'Private', tag: 'TAG' } }, vlr: { teamId: 'private' }, ai: { model: 'private' }, calendars: [{ key: 'team', name: 'Team', color: '#fff', gcalId: 'private-calendar', sync: true }] },
      matches: [{ id: 'm1', date: '2026-10-13', type: 'Scrim', opponent: 'Other', map: 'Haven', ourScore: 13, theirScore: 9, notes: 'private coach note', vod: 'private-vod' }],
      playerStats: [{ id: 'p1', matchId: 'm1', player: 'Alpha', kills: 20, deaths: 10, corrections: [{ correctedBy: 'private-coach' }] }],
      rounds: [{ id: 'r1', matchId: 'm1', notes: 'private round detail' }], vetos: [{ id: 'v1' }], strats: [{ id: 's1', notes: 'private strat' }], stratRuns: [{ id: 'sr1' }],
      vodReviews: [{ id: 'vod1', notes: [{ text: 'private review' }] }], lineups: [{ id: 'l1', imageUrl: 'private-image' }], seasonArchives: [{ id: 'a1' }],
    });
    expect(result.matches).toEqual([{ id: 'm1', date: '2026-10-13', type: 'Scrim', opponent: 'Other', map: 'Haven', ourScore: 13, theirScore: 9 }]);
    expect(result.playerStats).toEqual([{ id: 'p1', matchId: 'm1', player: 'Alpha', kills: 20, deaths: 10 }]);
    expect(result).toMatchObject({ rounds: [], vetos: [], strats: [], stratRuns: [], vodReviews: [], lineups: [], seasonArchives: [], secrets: {} });
    expect(JSON.stringify(result)).not.toMatch(/private coach note|private-vod|private round detail|private strat|private review|private-image|private-calendar|private-coach|TAG/);
  });

  it('materializes round conversion summaries for the website without exposing detailed rounds', () => {
    const result = toWebsiteTrackerData({
      settings: {},
      matches: [{ id: 'm1', date: '2026-10-14', type: 'Scrim', opponent: 'Other', map: 'Ascent' }],
      playerStats: [],
      rounds: [
        { id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W', buy: 'Eco', enemyBuy: 'Eco' },
        { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Attack', result: 'W', buy: 'Low', enemyBuy: 'Eco' },
        { id: 'r3', matchId: 'm1', roundNo: 3, side: 'Attack', result: 'L', buy: 'Half', enemyBuy: 'Full' },
      ],
    });
    expect(result.rounds).toEqual([]);
    expect(result.matches[0].roundAnalytics).toMatchObject({ schemaVersion: 1, map: 'Ascent', coveredRounds: 3, postPistol: { won: 1, total: 1 }, earnedBonus: { won: 0, total: 1 } });
    expect(JSON.stringify(result.matches[0].roundAnalytics)).not.toContain('screenshotEvidence');
  });
});
