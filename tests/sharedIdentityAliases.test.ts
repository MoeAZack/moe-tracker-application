import { describe, expect, it } from 'vitest';
import { captureRosterFromIdentity } from '../lib/identityResolver';
import { integrateVodSubmission } from '../lib/vodSubmissions';
import { createSeed } from '../lib/seed';

const roster = ['caelia', 'dexle', 'majusIa', 'bellatrix', 'Sandra'].map((displayName, index) => ({ id: `player-${index + 1}`, displayName, createdAt: '2026-10-18T10:00:00Z' }));
const correction = (sourceIdentity: string, targetPlayerId: string, extra: any = {}) => ({ id: `c-${sourceIdentity}`, sourceIdentity, targetPlayerId, reason: 'Coach fix', affectedRows: [], createdAt: '2026-10-18T10:00:00Z', createdBy: 'Coach', ...extra });

describe('one identity source for capture, replay and VOD', () => {
  it('gives the capture roster every alias the resolver knows, minus retired players', () => {
    const data = {
      rosterPlayers: [...roster, { id: 'old', displayName: 'Veteran', retiredAt: '2026-09-01' }],
      tryoutBatches: [{ id: 't1', aliases: [{ playerId: 'player-2', alias: 'dex' }] }],
      identityCorrectionBatches: [correction('unlinked-name:Qwerty Main', 'player-1'), correction('Reverted', 'player-1', { revertedAt: '2026-10-19' })],
      playerStats: [{ id: 's1', matchId: 'm1', playerId: 'player-3', player: 'majusIa', displayNameSnapshot: 'majus1a' }],
      seasonArchives: [{ rosterPlayers: [{ id: 'player-4', displayName: 'bellatrix' }] }],
    };
    const captureRoster = captureRosterFromIdentity(data);
    expect(captureRoster.map(player => player.id)).toEqual(['player-1', 'player-2', 'player-3', 'player-4', 'player-5']);
    expect(captureRoster.find(player => player.id === 'player-1')!.aliases).toEqual(['Qwerty Main']);
    expect(captureRoster.find(player => player.id === 'player-2')!.aliases).toEqual(['dex']);
    expect(captureRoster.find(player => player.id === 'player-3')!.aliases).toEqual(['majus1a']);
  });

  it('drops an alias that also points at another player', () => {
    const data = { rosterPlayers: roster, identityCorrectionBatches: [correction('Shared', 'player-1'), correction('Shared', 'player-2')] };
    expect(captureRosterFromIdentity(data).flatMap(player => player.aliases)).not.toContain('Shared');
  });

  it('lets a coach correction resolve a VOD name the fuzzy match alone would reject', () => {
    const db: any = createSeed(); db.rosterPlayers = structuredClone(roster); db.matches = []; db.playerStats = [];
    const players = roster.map((player, index) => ({ observedName: index === 0 ? 'Qwerty Main' : player.displayName, agent: 'Jett', kills: 10, deaths: 10, assists: 2, acs: 200, adr: 130, hs: 20, fk: 1, fd: 1 }));
    const input: any = { vodUrl: 'https://example.test/vod/2', imageSha256: 'c'.repeat(64), playerId: 'player-1', date: '2026-10-18', map: 'Ascent', opponent: 'PYO', ourScore: 13, theirScore: 9, players };
    const ids = { submissionId: 'sub', matchId: 'vod-match', statId: (() => { let index = 0; return () => `vod-stat-${++index}`; })(), reviewId: 'rev' };
    expect(() => integrateVodSubmission(structuredClone(db), input, 'caelia', ids, '2026-10-18T14:00:00Z')).toThrow('must match exactly one active roster player');
    db.identityCorrectionBatches = [correction('unlinked-name:Qwerty Main', 'player-1')];
    integrateVodSubmission(db, input, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(db.playerStats.find((row: any) => row.playerId === 'player-1')).toBeTruthy();
  });
});
