import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildReviewInbox } from '../lib/reviewInbox';
import { createSeed } from '../lib/seed';

const adminKey = 'test-master-secret-at-least-24-characters';
const playerKey = 'test-player-access-key';
let tempDir: string; let dbPath: string; let server: Server; let origin: string;

const events = [
  { sequence: 1, victimTeam: 'theirs', killerPlayerId: 'p-a', victimPlayerId: 'p-f', sourceRow: 0 },
  { sequence: 2, victimTeam: 'theirs', killerPlayerId: 'p-b', victimPlayerId: 'p-g', sourceRow: 1 },
];
const evidence = (reviewStatus: string) => ({
  schemaVersion: 1, reviewStatus, confidence: 'medium', ourAverageLoadout: 4800, enemyAverageLoadout: 900, eventsComplete: true, openingEventComplete: true, events,
  players: [{ playerId: 'p-a', displayName: 'Alpha' }, { playerId: 'p-f', displayName: 'Foxtrot' }, { playerId: 'p-b', displayName: 'Bravo' }, { playerId: 'p-g', displayName: 'Golf' }],
});
function fixture() {
  return {
    ...createSeed(),
    matches: [{ id: 'auto-1', date: '2026-10-21', opponent: 'Nova', map: 'Lotus', type: 'Scrim', automation: { mode: 'partial-round-review', roundsNeedingReview: [2] } }],
    rounds: [
      { id: 'r1', matchId: 'auto-1', roundNo: 1, side: 'Att', result: 'W', screenshotEvidence: evidence('confirmed') },
      { id: 'r2', matchId: 'auto-1', roundNo: 2, side: 'Att', result: 'W', buy: '', enemyBuy: 'Coach note', screenshotEvidence: evidence('review-required'), advantageEvidence: { schemaVersion: 1, source: 'screenshot', status: 'partial', states: [] } },
    ],
    authKeys: [{ id: 'player-1', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Read only player', role: 'player' }],
  };
}

async function login(key: string) {
  const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  expect(response.status).toBe(200);
  return (await response.json()).key as string;
}
const post = (token: string, route: string, body: unknown) => fetch(`${origin}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function stored(token: string) {
  const response = await fetch(`${origin}/api/data`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return response.json();
}
async function reset() { await fs.writeFile(dbPath, JSON.stringify(fixture())); }

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-round-accept-http-'));
  dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath,
    ADMIN_PASSWORD: adminKey, JWT_SECRET: 'test-session-secret-at-least-24-characters',
    CRON_SECRET: 'test-cron-secret-at-least-24-characters', GEMINI_API_KEY: 'test-no-external-calls', GOOGLE_CLIENT_ID: '',
  })) vi.stubEnv(key, value);
  await reset();
  const { createApp } = await import('../server');
  const app = await createApp(false);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 15_000);

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  vi.unstubAllEnvs(); vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('accepting a deferred round over HTTP', () => {
  it('confirms the round, clears its inbox item and re-derives its advantage states', async () => {
    await reset(); const token = await login(adminKey);
    expect(buildReviewInbox(await stored(token)).map(item => item.id)).toEqual(['rounds:auto-1']);
    const response = await post(token, '/api/round-evidence-accept', { matchId: 'auto-1', roundNo: 2 });
    const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200);
    const db = await stored(token);
    const round = db.rounds.find((row: any) => row.matchId === 'auto-1' && row.roundNo === 2);
    expect(round).toMatchObject({
      id: 'r2', firstKillBy: 'Alpha', firstDeathBy: 'Foxtrot', buy: 'Full', enemyBuy: 'Coach note',
      screenshotEvidence: { reviewStatus: 'confirmed', acceptedBy: expect.any(String), acceptedAt: expect.any(String) },
      advantageEvidence: { status: 'complete', source: 'screenshot' },
    });
    expect(db.rounds.find((row: any) => row.roundNo === 1).id).toBe('r1');
    expect(buildReviewInbox(db).some(item => item.kind === 'rounds')).toBe(false);
    // Accepting again is refused rather than silently rewriting accepted evidence.
    expect((await post(token, '/api/round-evidence-accept', { matchId: 'auto-1', roundNo: 2 })).status).toBe(409);
  });

  it('is coach-only and refuses unknown matches or rounds', async () => {
    await reset(); const coach = await login(adminKey); const player = await login(playerKey);
    expect((await post(player, '/api/round-evidence-accept', { matchId: 'auto-1', roundNo: 2 })).status).toBe(403);
    expect((await post(coach, '/api/round-evidence-accept', { matchId: 'missing', roundNo: 2 })).status).toBe(404);
    expect((await post(coach, '/api/round-evidence-accept', { matchId: 'auto-1', roundNo: 7 })).status).toBe(409);
    expect((await stored(coach)).rounds.find((row: any) => row.roundNo === 2).screenshotEvidence.reviewStatus).toBe('review-required');
  });
});
