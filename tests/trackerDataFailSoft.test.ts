import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

// Each derived builder can be made to throw; the core collections must still load.
const failing = vi.hoisted(() => new Set<string>());
const thrower = (name: string) => { if (failing.has(name)) throw new Error(`${name} exploded`); };
vi.mock('../lib/aggregateVersioning', async original => {
  const actual: any = await original();
  return { ...actual,
    buildAcceptedMatchAggregatePlan: (...args: any[]) => { thrower('aggregates'); return actual.buildAcceptedMatchAggregatePlan(...args); },
    buildCanonicalAnalyticsExport: (...args: any[]) => { thrower('canonicalAnalytics'); return actual.buildCanonicalAnalyticsExport(...args); } };
});
vi.mock('../lib/canonicalDataSpine', async original => {
  const actual: any = await original();
  return { ...actual, buildCanonicalDataSpine: (...args: any[]) => { thrower('canonicalDataSpine'); return actual.buildCanonicalDataSpine(...args); } };
});
vi.mock('../lib/roster', async original => {
  const actual: any = await original();
  return { ...actual, purgeExpiredRosterPlayers: (...args: any[]) => { thrower('retention'); return actual.purgeExpiredRosterPlayers(...args); } };
});

let tempDir: string; let server: Server; let origin: string;
const PLAYER = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-fail-soft-'));
  const dbPath = path.join(tempDir, 'db.json');
  vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', path.join(tempDir, 'evidence'));
  const seed = createSeed();
  await fs.writeFile(dbPath, JSON.stringify({
    ...seed,
    workspace: { schemaVersion: 1, id: 'ws_failSoftWorkspace0001', createdAt: '2026-10-20T00:00:00.000Z' },
    settings: { ...seed.settings, featureFlags: { canonicalDataSpine: true } },
    rosterPlayers: [{ id: PLAYER, displayName: 'Player1', createdAt: '2026-10-01T00:00:00.000Z' }],
    matches: [{ id: 'm1', date: '2026-10-20', map: 'Ascent', opponent: 'OpponentA', sourceMetadata: { method: 'manual', capturedAt: '2026-10-20T10:00:00.000Z', externalId: 'manual-1' } }],
    rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', result: 'W' }],
    playerStats: [{ id: 's1', matchId: 'm1', player: 'Player1', playerId: PLAYER, displayNameSnapshot: 'Player1', agent: 'Omen', kills: 20, deaths: 10, assists: 5, sourceMetadata: { method: 'manual', capturedAt: '2026-10-20T10:00:00.000Z' } }],
  }));
  const { registerDataRoutes } = await import('../lib/routes/data');
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { (req as any).user = { role: 'coach', username: 'Coach' }; next(); });
  registerDataRoutes(app);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => { failing.clear(); vi.restoreAllMocks(); });

afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  vi.unstubAllEnvs(); vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

const load = async () => {
  const response = await fetch(`${origin}/api/data`);
  return { status: response.status, data: await response.json() };
};
const expectCore = (data: any) => {
  expect(data.matches.map((row: any) => row.id)).toEqual(['m1']);
  expect(data.playerStats.map((row: any) => row.id)).toEqual(['s1']);
  expect(data.rosterPlayers.map((row: any) => row.id)).toEqual([PLAYER]);
};

describe('GET /api/data when a derived section cannot be built', () => {
  it('sends every derived section when nothing fails', async () => {
    const { status, data } = await load();
    expect(status).toBe(200); expectCore(data);
    expect(data.canonicalAnalytics).toHaveLength(1);
    expect(data.canonicalDataSpine.matches.map((row: any) => row.id)).toEqual(['m1']);
  });

  it.each([
    ['canonicalAnalytics', 'canonicalAnalytics'],
    ['canonicalDataSpine', 'canonicalDataSpine'],
  ])('leaves out %s, logs it, and still loads the workspace', async (builder, section) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failing.add(builder);
    const { status, data } = await load();
    expect(status).toBe(200); expectCore(data);
    expect(data).not.toHaveProperty(section);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`${builder} exploded`));
  });

  it('sends a match as its stored rows when its aggregates cannot be rebuilt', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failing.add('aggregates');
    const { status, data } = await load();
    expect(status).toBe(200); expectCore(data);
    expect(data.matches[0]).not.toHaveProperty('roundAnalytics');
    expect(data.playerStats[0]).toMatchObject({ kills: 20, deaths: 10, assists: 5 });
    expect(data.playerStats[0]).not.toHaveProperty('screenshotMetrics');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('aggregates for match m1 left out'));
  });

  it('skips roster retention when it fails and loads the stored workspace', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    failing.add('retention');
    const { status, data } = await load();
    expect(status).toBe(200); expectCore(data);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('roster retention skipped'));
  });

  it('loads the core collections when every derived section fails at once', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const builder of ['aggregates', 'canonicalAnalytics', 'canonicalDataSpine', 'retention']) failing.add(builder);
    const { status, data } = await load();
    expect(status).toBe(200); expectCore(data);
    expect(log).toHaveBeenCalledTimes(4);
  });
});
