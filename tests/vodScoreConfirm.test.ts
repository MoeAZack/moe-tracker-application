import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

let tempDir: string; let dbPath: string; let server: Server; let origin: string;
const hud = { source: 'vod-hud', basis: 'final-read', reads: 9, orientation: 'left-is-ours', derivedAt: '2026-10-23T00:00:00.000Z' };
const vodMatch = { id: 'vod-m1', date: '2026-10-23', type: 'VOD submission', opponent: 'Unknown opponent', map: 'Haven', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9, source: 'vod-submission', rosterContext: { kind: 'mixed' }, scoreEvidence: hud };

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-score-confirm-'));
  dbPath = path.join(tempDir, 'db.json');
  vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', path.join(tempDir, 'evidence'));
  const { registerDataRoutes } = await import('../lib/routes/data');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { role: 'coach', username: 'Coach' }; next(); });
  registerDataRoutes(app);
  const { registerVodSubmissionRoutes } = await import('../lib/routes/vodSubmissions');
  registerVodSubmissionRoutes(app);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => { await fs.writeFile(dbPath, JSON.stringify({ ...createSeed(), matches: [vodMatch], playerStats: [] })); });

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  vi.unstubAllEnvs(); vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

const save = async (match: any) => {
  const response = await fetch(`${origin}/api/save-match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ match, statsUpdate: { operation: 'preserve' } }) });
  expect(response.status).toBe(200);
  return JSON.parse(await fs.readFile(dbPath, 'utf8')).matches.find((row: any) => row.id === 'vod-m1');
};

describe('a score read from the HUD stays unconfirmed until a coach saves it', () => {
  it('keeps the mark on a save that does not touch the score', async () => {
    const { scoreEvidence: _hud, ...clientCopy } = vodMatch;
    expect((await save({ ...clientCopy, map: 'Bind' })).scoreEvidence).toEqual(hud);
  });

  it('drops it when the coach confirms the score, or changes it', async () => {
    expect(await save({ ...vodMatch, scoreConfirmed: true })).not.toHaveProperty('scoreEvidence');
    await fs.writeFile(dbPath, JSON.stringify({ ...createSeed(), matches: [vodMatch], playerStats: [] }));
    const swapped = await save({ ...vodMatch, ourScore: 9, theirScore: 13 });
    expect(swapped).toMatchObject({ ourScore: 9, theirScore: 13 }); expect(swapped).not.toHaveProperty('scoreEvidence');
  });

  it('never takes the mark, or the confirm flag, from a client', async () => {
    const plain = { ...vodMatch, id: 'vod-m1' }; delete (plain as any).scoreEvidence;
    await fs.writeFile(dbPath, JSON.stringify({ ...createSeed(), matches: [plain], playerStats: [] }));
    const saved = await save({ ...plain, scoreEvidence: hud });
    expect(saved).not.toHaveProperty('scoreEvidence'); expect(saved).not.toHaveProperty('scoreConfirmed');
  });
});

describe('a score the coach cleared stays cleared', () => {
  it('marks the clear, so a later import of the same VOD does not read the HUD score back in', async () => {
    const cleared = await save({ ...vodMatch, ourScore: null, theirScore: null, scoreConfirmed: true });
    expect(cleared).toMatchObject({ ourScore: null, theirScore: null, scoreEvidence: { source: 'coach-cleared' } });
    const { applyVodHudScore } = await import('../lib/vodScore');
    const evidence = { observations: [[0, 0], [6, 4], [12, 7]].map((score, index) => ({ kind: 'round-state', timestampMs: (index + 1) * 100_000, score, scoreSource: 'hud' })) } as any;
    expect(applyVodHudScore(cleared, evidence)).toBeNull();
    expect(cleared).toMatchObject({ ourScore: null, theirScore: null });
    // Setting a score again replaces the mark.
    expect(await save({ ...cleared, ourScore: 13, theirScore: 4, scoreConfirmed: true })).not.toHaveProperty('scoreEvidence');
  });

  it('does not mark a match that never had a score', async () => {
    await fs.writeFile(dbPath, JSON.stringify({ ...createSeed(), matches: [{ ...vodMatch, ourScore: null, theirScore: null, scoreEvidence: undefined }], playerStats: [] }));
    expect(await save({ ...vodMatch, ourScore: null, theirScore: null, scoreEvidence: undefined, scoreConfirmed: true })).not.toHaveProperty('scoreEvidence');
  });
});

describe('POST /api/vod-hud-orientation', () => {
  it('turns a HUD-only game round from a scoreboard game of the same video and saves it', async () => {
    const reads = (pairs: number[][]) => ({ observations: pairs.map((score, index) => ({ kind: 'round-state', timestampMs: (index + 1) * 100_000, score, scoreSource: 'hud' })) });
    const fromBoard = { ...vodMatch, id: 'board-1', vod: 'https://example.test/vod', ourScore: 13, theirScore: 9, scoreEvidence: undefined, vodTimelineEvidence: reads([[0, 0], [5, 8], [9, 12]]) };
    const hudOnly = { ...vodMatch, vod: 'https://example.test/vod', ourScore: 13, theirScore: 7 };
    await fs.writeFile(dbPath, JSON.stringify({ ...createSeed(), matches: [fromBoard, hudOnly], playerStats: [] }));
    const response = await fetch(`${origin}/api/vod-hud-orientation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vodUrl: 'https://example.test/vod', matchIds: ['vod-m1'], fromMatchIds: ['board-1'] }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ orientation: 'right-is-ours', changed: [{ id: 'vod-m1', ourScore: 7, theirScore: 13 }] });
    const saved = JSON.parse(await fs.readFile(dbPath, 'utf8')).matches.find((row: any) => row.id === 'vod-m1');
    expect(saved).toMatchObject({ ourScore: 7, theirScore: 13, scoreEvidence: { orientation: 'right-is-ours', orientationFrom: 'board-1' } });
  });
});
