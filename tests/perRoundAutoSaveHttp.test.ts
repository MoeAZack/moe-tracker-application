import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';
import { buildAutomaticCaptureImport } from '../lib/automaticCaptureImport';

const adminKey = 'per-round-master-secret-at-least-24-characters';
let tempDir: string; let dbPath: string; let server: Server; let origin: string;
async function login() { const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: adminKey }) }); expect(response.status).toBe(200); return (await response.json()).key as string; }
async function request(token: string, url: string, body?: unknown) { return fetch(`${origin}${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

beforeAll(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-per-round-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: 'per-round-session-secret-at-least-24-characters', GEMINI_API_KEY: 'test' })) vi.stubEnv(key, value);
  const db: any = createSeed(); db.matches = []; db.playerStats = []; db.rounds = []; await fs.writeFile(dbPath, JSON.stringify(db));
  const { createApp } = await import('../server'); const app = await createApp(false);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 15_000);
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(tempDir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

const names = ['Ally A', 'Ally B', 'Ally C', 'Ally D', 'Ally E', 'Foe A', 'Foe B', 'Foe C', 'Foe D', 'Foe E'];
// Every round carries a complete opening (Foe A kills Ally A) and a plant, so
// only the review status decides whether those facts may be derived.
const roundEvidence = (reviewStatus: string, confidence: string) => ({
  schemaVersion: 1, reviewStatus, confidence, openingEventComplete: true, eventsComplete: false,
  players: names.map((displayName, index) => ({ playerId: `name:${displayName.toLowerCase().replace(' ', '')}`, displayName, team: index < 5 ? 'ours' : 'theirs' })),
  events: [{ sequence: 1, killerPlayerId: 'name:foea', victimPlayerId: 'name:allya', killerTeam: 'theirs', victimTeam: 'ours' }],
  objectives: [{ type: 'plant' }],
});

describe('rounds deferred by an automatic save', () => {
  it('stay out of the round log, plants and first deaths until a coach confirms them', async () => {
    const coach = await login(); const current = await (await request(coach, '/api/data')).json();
    const extracted = {
      meta: { map: current.settings.maps[0], ourScore: 13, theirScore: 9 }, startingSide: { firstHalf: 'Att' }, reconciled: { missing: [] },
      sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-20T18:30:00.000Z', provider: 'tesseract-local', model: 'tesseract/eng-1.0.0/parser-v1' },
      players: names.map((name, index) => ({ include: index < 5, matchedPlayerId: null, extractedName: name, agent: 'Jett', kills: 10 + index, deaths: 8, assists: 4, fd: null })),
      rounds: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index < 13 ? 'W' : 'L', extractionIssues: index === 6 ? ['economy'] : [], screenshotEvidence: index === 6 ? roundEvidence('review-required', 'medium') : roundEvidence('confirmed', 'high') })),
    };
    const { payload } = buildAutomaticCaptureImport(extracted, current, 'deferred-capture');
    expect(payload!.match.automation).toMatchObject({ roundsNeedingReview: [7] });
    const match = payload!.match;
    const response = await request(coach, '/api/save-match', { match, statsUpdate: { operation: 'replace', stats: payload!.stats }, rounds: payload!.roundRows });
    expect(response.status).toBe(200); const saved = (await response.json()).match;
    const data = await (await request(coach, '/api/data')).json();
    const rounds = data.rounds.filter((round: any) => round.matchId === saved.id);
    const deferredRound = rounds.find((round: any) => round.roundNo === 7); const confirmedRound = rounds.find((round: any) => round.roundNo === 8);
    expect(confirmedRound).toMatchObject({ firstKillBy: 'Foe A', firstDeathBy: 'Ally A', plant: 'TRUE' });
    expect(deferredRound.firstKillBy || null).toBeNull(); expect(deferredRound.firstDeathBy || null).toBeNull(); expect(deferredRound.plant ?? null).toBeNull();
    // First deaths need every round; one deferred round keeps FD unknown, never zero.
    const ally = data.playerStats.find((row: any) => row.matchId === saved.id && row.player === 'Ally A');
    expect(ally.fd ?? null).toBeNull();
  });
});
