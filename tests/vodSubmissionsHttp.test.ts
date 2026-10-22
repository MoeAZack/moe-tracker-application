import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

const coachKey = 'vod-coach-secret-at-least-24-characters'; const playerKey = 'vod-player-key'; const otherKey = 'vod-other-key';
const roster = ['caelia', 'dexle', 'majusIa', 'bellatrix', 'Sandra'].map((displayName, index) => ({ id: `player-${index + 1}`, displayName, createdAt: '2026-10-18T10:00:00Z' }));
let folder = ''; let server: Server; let origin = '';

async function login(key: string) { const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }); expect(response.status).toBe(200); return (await response.json()).key; }
const call = (token: string, method: string, body?: unknown) => fetch(`${origin}/api/vod-submissions`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeAll(async () => {
  vi.resetModules(); folder = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-http-')); const dbPath = path.join(folder, 'db.json');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', DB_PATH: dbPath, ADMIN_PASSWORD: coachKey, JWT_SECRET: 'vod-session-secret-at-least-24-characters' })) vi.stubEnv(key, value);
  const db: any = createSeed(); db.rosterPlayers = roster; db.authKeys = [
    { id: 'p1', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), credentialType: 'access-key', label: 'caelia', role: 'player', playerId: 'player-1' },
    { id: 'p2', keyHash: crypto.createHash('sha256').update(otherKey).digest('hex'), credentialType: 'access-key', label: 'dexle', role: 'player', playerId: 'player-2' },
  ];
  db.matches = [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'PYO', map: 'Ascent', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9, sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-18T12:00:00Z' } }];
  db.playerStats = roster.map((player, index) => ({ id: `s${index}`, matchId: 'm1', playerId: player.id, player: player.displayName, agent: 'Unknown', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: null, deaths: null, assists: null }));
  await fs.writeFile(dbPath, JSON.stringify(db)); const { createApp } = await import('../server'); const app = await createApp(false); server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 15_000);
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(folder, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('VOD submission HTTP workflow', () => {
  it('lets a linked player submit five-name OCR evidence while keeping it private from other players', async () => {
    const player = await login(playerKey); const body = { vodUrl: 'https://example.test/vod/1', imageSha256: 'b'.repeat(64), matchId: 'm1', date: '2026-10-18', map: 'Ascent', opponent: 'PYO', ourScore: 13, theirScore: 9, players: roster.map((item, index) => ({ observedName: item.displayName, agent: null, kills: 20 - index, deaths: 10 + index, assists: 3, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null })), timelineEvidence: { schema: 'moetracker.vod-timeline-evidence/v1', grade: 'video-observation', source: { kind: 'youtube', videoId: 'abcdefghijk', sha256: 'c'.repeat(64), width: 1920, height: 1080, durationMs: 60000, analyzedAt: '2026-10-18T14:00:00Z' }, coverage: { durationMs: 60000, killFeedSnapshots: 1, objectiveSnapshots: 0, ultimateSnapshots: 0, resolvedEliminations: 1, inferredRoundGroups: 1, signals: { eliminations: 'partial', trades: 'partial', kast: 'partial', objectives: 'unsupported', ultimateUse: 'unsupported', orbCapture: 'unsupported', throws: 'unsupported' } }, observations: [{ id: 'obs-1', kind: 'elimination', timestampMs: 1000, confidence: .9, grade: 'video-observation', killer: 'caelia', victim: 'Enemy' }], rounds: [], playerMetrics: [{ playerName: 'caelia', team: 'ours', kills: 1, deaths: 0, trades: 0, ultimateUses: null, orbCaptures: null, kastSuccessful: null, kastCovered: null, kastRate: null }], throwCandidates: [], limitations: ['Partial HUD coverage.'] } };
    const submitted = await call(player, 'POST', body); expect(submitted.status).toBe(201); expect((await submitted.json()).submission).toMatchObject({ submittedByPlayerId: 'player-1', linkedMatchId: 'm1', rosterMatchCount: 5, timelineEvidence: { coverage: { resolvedEliminations: 1 } } });
    const own = await call(player, 'GET'); expect((await own.json()).submissions).toHaveLength(1);
    const other = await login(otherKey); expect((await (await call(other, 'GET')).json()).submissions).toEqual([]);
    const coach = await login(coachKey); expect((await (await call(coach, 'GET')).json()).submissions).toHaveLength(1);
  });

  it('lets a coach integrate team VOD evidence without pretending to be a player', async () => {
    const coach = await login(coachKey); const body = { vodUrl: 'https://www.youtube.com/live/6sx2Wpl0cHc', imageSha256: 'd'.repeat(64), matchId: 'm1', coachTeamEvidence: true, date: '2026-10-18', map: 'Ascent', opponent: 'PYO', ourScore: 13, theirScore: 9, players: roster.map((item, index) => ({ observedName: item.displayName, agent: null, kills: 18 - index, deaths: 9 + index, assists: 4, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null })), timelineEvidence: null };
    const submitted = await call(coach, 'POST', body); expect(submitted.status).toBe(201); expect((await submitted.json()).submission).toMatchObject({ submittedByPlayerId: null, submittedByName: 'Coach team VOD', linkedMatchId: 'm1', rosterMatchCount: 5 });
  });
});
