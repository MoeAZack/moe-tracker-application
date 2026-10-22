import { describe, expect, it } from 'vitest';
import { createSeed } from '../lib/seed';
import { integrateVodSubmission } from '../lib/vodSubmissions';
import { addCoreMembership, retireRosterPlayer, setTryoutsMode } from '../lib/roster';
import { vodSubmissionSchema } from '../schemas';

const row = (observedName: string, index: number) => ({ observedName, agent: 'Jett', kills: 20 - index, deaths: 10 + index, assists: index, acs: 200 + index, adr: 140, hs: 25, fk: 1, fd: 1, plants: 0, defuses: 0, trades: 2 });
const game = (names: string[], n: number) => ({
  vodUrl: 'https://example.test/vod/1', imageSha256: String(n).repeat(64).slice(0, 64), playerId: null, date: '2026-10-22', map: n % 2 ? 'Ascent' : 'Bind', opponent: null,
  ourScore: 13, theirScore: 7 + n, players: names.map(row), addObservedPlayers: true,
});
let counter = 0;
const ids = () => ({ submissionId: `sub-${++counter}`, matchId: `match-${counter}`, statId: () => `stat-${++counter}`, reviewId: `review-${counter}` });
const empty = () => { const db: any = createSeed(); Object.assign(db, { rosterPlayers: [], coreMemberships: [], matches: [], playerStats: [], rounds: [] }); return db; };
const FIRST = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

describe('coach VOD import adds players from the scoreboard names', () => {
  it('turns five unknown names on an empty workspace into tryouts and credits their stats at once', () => {
    const db = empty();
    const submission = integrateVodSubmission(db, game(FIRST, 1), 'Coach team VOD', ids(), '2026-10-22T20:00:00Z');
    expect(submission).toMatchObject({ linkMode: 'new-match', rosterMatchCount: 5, integration: { createdMatch: true, createdStats: 5, addedPlayers: FIRST } });
    expect(db.rosterPlayers.map((player: any) => player.displayName)).toEqual(FIRST);
    expect(db.rosterPlayers.every((player: any) => player.rosterStatus === 'tryout' && player.addedFrom === 'vod-import')).toBe(true);
    expect(db.settings.tryoutsMode).toBe(true);
    const phase = db.tryoutBatches.find((batch: any) => batch.id === db.settings.activeTryoutBatchId);
    expect(phase.candidatePlayerIds).toEqual(db.rosterPlayers.map((player: any) => player.id));
    expect(db.playerStats).toHaveLength(5);
    expect(db.playerStats.map((stat: any) => [stat.displayNameSnapshot, stat.appearanceType, stat.kills])).toEqual(FIRST.map((name, index) => [name, 'tryout', 20 - index]));
    expect(db.coreMemberships).toEqual([]);
  });

  it('reuses a player seen before (even through a small OCR slip) and keeps stats for everyone who rotates in', () => {
    const db = empty();
    integrateVodSubmission(db, game(FIRST, 1), 'Coach team VOD', ids(), '2026-10-22T20:00:00Z');
    const second = integrateVodSubmission(db, game(['A1pha', 'Bravo', 'Foxtrot', 'Golf', 'Hotel'], 2), 'Coach team VOD', ids(), '2026-10-22T20:30:00Z');
    expect(second.integration.addedPlayers).toEqual(['Foxtrot', 'Golf', 'Hotel']);
    expect(db.rosterPlayers).toHaveLength(8);
    expect(db.playerStats).toHaveLength(10);
    const alpha = db.rosterPlayers.find((player: any) => player.displayName === 'Alpha');
    expect(db.playerStats.filter((stat: any) => stat.playerId === alpha.id)).toHaveLength(2);
  });

  it('adds nobody unless a coach import asks for it', () => {
    const db = empty();
    expect(() => integrateVodSubmission(db, { ...game(FIRST, 1), addObservedPlayers: false }, 'Coach team VOD', ids())).toThrow(/must match exactly one active roster player/);
    expect(db.rosterPlayers).toEqual([]);
    // A player's own submission never creates identities.
    db.rosterPlayers = [{ id: 'p-own', displayName: 'Alpha', createdAt: '2026-10-01T00:00:00Z' }];
    expect(() => integrateVodSubmission(db, { ...game(FIRST, 1), playerId: 'p-own' }, 'Alpha', ids())).toThrow(/must match exactly one active roster player/);
    expect(db.rosterPlayers).toHaveLength(1);
    expect(db.settings.tryoutsMode).toBeFalsy();
  });

  it('refuses, adding nobody, when a name belongs to an archived player or two names look alike', () => {
    const db = empty();
    integrateVodSubmission(db, game(FIRST, 1), 'Coach team VOD', ids(), '2026-10-22T20:00:00Z');
    retireRosterPlayer(db, db.rosterPlayers.find((player: any) => player.displayName === 'Echo').id);
    const before = db.rosterPlayers.length;
    expect(() => integrateVodSubmission(db, game(['Echo', 'India', 'Juliet', 'Kilo', 'Lima'], 2), 'Coach team VOD', ids())).toThrow(/archived under Roster/);
    expect(() => integrateVodSubmission(db, game(['Alpha', 'Mike', 'Mlke', 'Kilo', 'Lima'], 3), 'Coach team VOD', ids())).toThrow(/look like the same player/);
    expect(db.rosterPlayers).toHaveLength(before);
  });

  it('adds stand-ins beside an existing core, and tryouts while a tryout phase runs', () => {
    const db = empty();
    integrateVodSubmission(db, game(FIRST, 1), 'Coach team VOD', ids(), '2026-10-22T20:00:00Z');
    setTryoutsMode(db, false);
    for (const player of db.rosterPlayers) addCoreMembership(db, player.id);
    const standIn = integrateVodSubmission(db, game(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Oscar'], 2), 'Coach team VOD', ids());
    expect(standIn.integration.addedPlayers).toEqual(['Oscar']);
    expect(db.rosterPlayers.find((player: any) => player.displayName === 'Oscar').rosterStatus).toBe('standIn');
    expect(db.settings.tryoutsMode).toBe(false);
    setTryoutsMode(db, true);
    integrateVodSubmission(db, game(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Papa'], 3), 'Coach team VOD', ids());
    expect(db.rosterPlayers.find((player: any) => player.displayName === 'Papa').rosterStatus).toBe('tryout');
  });

  it('archiving an added player keeps every match and every stat row', () => {
    const db = empty();
    integrateVodSubmission(db, game(FIRST, 1), 'Coach team VOD', ids(), '2026-10-22T20:00:00Z');
    const before = { matches: structuredClone(db.matches), stats: structuredClone(db.playerStats) };
    retireRosterPlayer(db, db.rosterPlayers[4].id);
    expect(db.matches).toEqual(before.matches);
    expect(db.playerStats).toEqual(before.stats);
  });

  it('accepts the request flag in the submission schema', () => {
    const { playerId: _playerId, ...body } = game(FIRST, 1);
    expect(vodSubmissionSchema.safeParse({ ...body, coachTeamEvidence: true }).success).toBe(true);
  });
});
