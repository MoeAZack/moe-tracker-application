import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';
import { recaptureMatch, recaptureRoster, recaptureRounds, recaptureStats } from './fixtures/sameGameRecapture';

let tempDir: string; let server: Server; let origin: string;

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-website-data-'));
  const dbPath = path.join(tempDir, 'db.json');
  vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', path.join(tempDir, 'evidence')); 
  await fs.writeFile(dbPath, JSON.stringify({
    ...createSeed(), rosterPlayers: recaptureRoster(),
    matches: [recaptureMatch('a', 'first'), recaptureMatch('b', 'second')],
    rounds: [...recaptureRounds('a', 'first'), ...recaptureRounds('b', 'second')],
    playerStats: [...recaptureStats('a'), ...recaptureStats('b')],
  }));
  const { registerDataRoutes } = await import('../lib/routes/data');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { role: 'coach', username: 'Coach' }; next(); });
  // The Cloudflare website registers the data routes in summary-only mode.
  registerDataRoutes(app, { websiteSummaryOnly: true });
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  vi.unstubAllEnvs(); vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('website /api/data and duplicate quarantine', () => {
  it('sends each game once while a re-capture waits on a coach decision', async () => {
    const response = await fetch(`${origin}/api/data`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matches.map((row: any) => row.id)).toEqual(['a']);
    expect(data.playerStats).toHaveLength(5);
    expect(data.playerStats.every((row: any) => row.matchId === 'a')).toBe(true);
    expect(data.rounds).toEqual([]);
  });
});
