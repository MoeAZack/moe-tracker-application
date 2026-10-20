import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';
import { recaptureMatch, recaptureRoster, recaptureRounds, recaptureStats } from './fixtures/sameGameRecapture';

const adminKey = 'test-master-secret-at-least-24-characters';
const playerKey = 'test-player-access-key';
let tempDir: string; let dbPath: string; let server: Server; let origin: string;

function fixture() {
  return {
    ...createSeed(),
    matches: [recaptureMatch('a', 'first')],
    rounds: recaptureRounds('a', 'first'),
    playerStats: recaptureStats('a'),
    rosterPlayers: recaptureRoster(),
    authKeys: [{ id: 'player-1', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Read only player', role: 'player' }],
  };
}
const withoutIds = (rows: any[]) => rows.map(({ id: _id, matchId: _matchId, ...row }) => row);
const newStats = () => recaptureStats('x').map(({ id: _id, matchId: _matchId, ...row }) => row);

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
async function reset(mutate?: (db: any) => void) { const db: any = fixture(); mutate?.(db); await fs.writeFile(dbPath, JSON.stringify(db)); }

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-integrity-http-'));
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

describe('H0 integrity over HTTP', () => {
  it('quarantines an OCR-variant re-capture saved with its rounds instead of rejecting it', async () => {
    await reset(); const token = await login(adminKey);
    const { id: _id, ...match } = recaptureMatch('b', 'second');
    const response = await post(token, '/api/save-match', { match, statsUpdate: { operation: 'replace', stats: newStats() }, rounds: withoutIds(recaptureRounds('b', 'second')) });
    const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.duplicateReview).toMatchObject({ status: 'quarantined', candidateMatchIds: ['a'] });
    expect(result.roundsUpdate).toMatchObject({ count: 24, screenshotSummary: null });
    const db = await stored(token);
    expect(db.matches).toHaveLength(2); expect(db.rounds.filter((row: any) => row.matchId === result.match.id)).toHaveLength(24);

    // The review state is server-owned: echoing a forged decision back does not clear it.
    const forged = await post(token, '/api/save-match', { match: { ...result.match, duplicateReview: { ...result.duplicateReview, status: 'kept-distinct' } } });
    expect(forged.status).toBe(200); expect((await forged.json()).duplicateReview.status).toBe('quarantined');
  });

  it('saves nothing when the rounds in a combined save are rejected', async () => {
    await reset(); const token = await login(adminKey);
    const { id: _id, ...match } = recaptureMatch('b', 'first');
    match.screenshotEvidence = { ...match.screenshotEvidence, captureId: 'a-different-capture-folder' };
    const response = await post(token, '/api/save-match', { match, statsUpdate: { operation: 'replace', stats: newStats() }, rounds: withoutIds(recaptureRounds('b', 'first')) });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ existingMatchId: 'a' });
    const db = await stored(token); expect(db.matches.map((row: any) => row.id)).toEqual(['a']); expect(db.playerStats).toHaveLength(5);
  });

  it('does not block a new match on date, map, opponent, score and roster agreement alone', async () => {
    await reset(db => { db.matches[0].screenshotEvidence = undefined; db.rounds = []; });
    const token = await login(adminKey);
    const { id: _id, screenshotEvidence: _evidence, ...match } = recaptureMatch('b', 'first');
    const response = await post(token, '/api/save-match', { match, statsUpdate: { operation: 'replace', stats: newStats() } });
    expect(response.status).toBe(200); expect((await response.json()).duplicateReview).toBeNull();
  });

  it('rejects a stale round id with 409 and keeps the stored rounds', async () => {
    await reset(); const token = await login(adminKey);
    const response = await post(token, '/api/save-rounds', { matchId: 'a', rows: [{ id: 'not-a-round-of-this-match', roundNo: 1, result: 'W' }] });
    expect(response.status).toBe(409);
    expect((await stored(token)).rounds).toHaveLength(24);
  });

  it('keeps a coach-entered FD through a round save and fills unknown FD from complete evidence', async () => {
    await reset(db => { db.playerStats[0].fd = 7; });
    const token = await login(adminKey);
    const response = await post(token, '/api/save-rounds', { matchId: 'a', rows: recaptureRounds('a', 'first').map(({ matchId: _matchId, ...row }) => row) });
    const result = await response.json(); expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.playerStats[0].fd).toBe(7); expect(result.playerStats[0]).not.toHaveProperty('fdDerivedFrom');
    expect(result.playerStats.slice(1).every((row: any) => Number.isInteger(row.fd) && row.fdDerivedFrom === 'round-evidence')).toBe(true);
  });

  it('lets only a coach keep or discard a quarantined copy', async () => {
    await reset(db => { db.matches.push(recaptureMatch('b', 'second')); db.rounds.push(...recaptureRounds('b', 'second')); db.playerStats.push(...recaptureStats('b')); });
    const coach = await login(adminKey);
    expect((await post(await login(playerKey), '/api/match-duplicate-review', { matchId: 'b', decision: 'keep-both' })).status).toBe(403);
    // Loading flags the pre-existing pair through the schema-15 migration.
    expect((await stored(coach)).matches.find((row: any) => row.id === 'b').duplicateReview.status).toBe('quarantined');
    const kept = await post(coach, '/api/match-duplicate-review', { matchId: 'b', decision: 'keep-both' });
    expect(kept.status).toBe(200); expect((await kept.json()).duplicateReview).toMatchObject({ status: 'kept-distinct', resolvedBy: expect.any(String) });
    expect((await post(coach, '/api/match-duplicate-review', { matchId: 'b', decision: 'discard-this' })).status).toBe(409);

    await reset(db => { db.matches.push(recaptureMatch('b', 'second')); db.rounds.push(...recaptureRounds('b', 'second')); db.playerStats.push(...recaptureStats('b')); });
    await stored(coach);
    const discarded = await post(coach, '/api/match-duplicate-review', { matchId: 'b', decision: 'discard-this' });
    expect(discarded.status).toBe(200);
    const db = await stored(coach);
    expect(db.matches.map((row: any) => row.id)).toEqual(['a']); expect(db.rounds.every((row: any) => row.matchId === 'a')).toBe(true);
  });
  it('releases the quarantined copy in the same write that deletes the original', async () => {
    await reset(db => { db.matches.push(recaptureMatch('b', 'second')); db.rounds.push(...recaptureRounds('b', 'second')); db.playerStats.push(...recaptureStats('b')); });
    const coach = await login(adminKey);
    expect((await stored(coach)).matches.find((row: any) => row.id === 'b').duplicateReview.status).toBe('quarantined');
    const removed = await post(coach, '/api/remove', { sheet: 'Matches', id: 'a' });
    expect(removed.status).toBe(200);
    const persisted = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(persisted.matches.map((row: any) => row.id)).toEqual(['b']); expect(persisted.matches[0]).not.toHaveProperty('duplicateReview');
  });

  it('keeps a quarantined copy out of the website summary', async () => {
    await reset(db => { db.matches.push(recaptureMatch('b', 'second')); db.rounds.push(...recaptureRounds('b', 'second')); db.playerStats.push(...recaptureStats('b')); });
    const response = await fetch(`${origin}/api/website-summary`, { headers: { Authorization: `Bearer ${await login(adminKey)}` } });
    expect(response.status).toBe(200);
    const summary = await response.json();
    expect(summary.matches.map((row: any) => row.id)).toEqual(['a']);
    expect(new Set(summary.playerStats.map((row: any) => row.matchId))).toEqual(new Set(['a']));
  });
  it('rejects a crafted evidence reference and keeps the workspace readable', async () => {
    await reset(); const token = await login(adminKey);
    const response = await post(token, '/api/save-rounds', { matchId: 'a', rows: [{ roundNo: 1, result: 'W', screenshotEvidence: { __moeEvidenceArtifact: 1, sha256: 'f'.repeat(64), bytes: 10 } }] });
    expect(response.status).toBe(400);
    expect((await stored(token)).rounds).toHaveLength(24);
  });
});
