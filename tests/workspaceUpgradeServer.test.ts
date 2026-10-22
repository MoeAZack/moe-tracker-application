import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { workspaceCounts, writeSchema14Workspace } from './helpers/schema14Workspace';

// Gate A1: a populated schema-14 workspace goes through the built server's
// first start (the same bundle the desktop app runs), not only readDB/saveDB.
const bundleDir = path.join(process.cwd(), 'node_modules', '.cache', 'workspace-upgrade-test');
const bundle = path.join(bundleDir, 'server.cjs');
const adminKey = 'upgrade-test-admin-key-123456';
let tempRoot = '';

beforeAll(async () => {
  // Same flags as `npm run build` for build/server.cjs. Inside node_modules so
  // the external packages resolve from the repository.
  await fs.mkdir(bundleDir, { recursive: true });
  await build({ entryPoints: ['server.ts'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: bundle, logLevel: 'silent' });
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-upgrade-'));
}, 120_000);

afterAll(async () => { if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true }); });

async function startServer(workspace: string, options: { established?: boolean } = { established: true }) {
  const port = 41000 + Math.floor(Math.random() * 8000);
  const child = spawn(process.execPath, [bundle], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port),
      DB_PATH: path.join(workspace, 'db.json'), PRIVATE_BACKUP_DIR: path.join(workspace, 'Backups'), PRIVATE_BACKUP_KEEP: '14',
      REPLAY_STORAGE_DIR: path.join(workspace, 'replays'), ADMIN_PASSWORD: adminKey, JWT_SECRET: 'upgrade-test-jwt-secret-123456',
      APP_DESKTOP: 'true', DESKTOP_DEVICE_ID: 'desktop-upgrade-test', DESKTOP_WORKSPACE_ESTABLISHED: options.established ? 'true' : 'false', VITEST: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; child.stdout!.on('data', chunk => { log += chunk; }); child.stderr!.on('data', chunk => { log += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* still starting */ }
    if (child.exitCode !== null) throw new Error(`Server exited during startup:\n${log}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const login = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: adminKey }) });
  expect(login.status).toBe(200);
  const token = (await login.json()).key as string;
  const call = (route: string, method = 'GET', body: unknown = {}) => fetch(`${origin}${route}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  return { child, call, log: () => log };
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill(); });
}

describe('schema-14 workspace through the built server', () => {
  for (const withArchive of [false, true]) {
    it(`keeps every count through first start, idle and restart${withArchive ? ' (with a season archive)' : ''}`, async () => {
      const workspace = path.join(tempRoot, withArchive ? 'with-archive' : 'plain');
      await fs.mkdir(workspace, { recursive: true });
      const { dbPath } = await writeSchema14Workspace(workspace, { withArchive });
      const before = await workspaceCounts(dbPath);
      expect(before).toMatchObject({ matches: 8, playerStats: 40, rounds: 176, coachingSignals: 8 });
      expect(before.calibratedPlayerRatings).toBeGreaterThan(0);
      expect(before.artifactsOnDisk).toBeGreaterThan(0);

      // The desktop app's first start: session, full data load, the startup recovery backup, then the views it opens.
      const first = await startServer(workspace);
      try {
        for (const [route, method] of [['/api/session', 'GET'], ['/api/data', 'GET'], ['/api/desktop/backup', 'POST'], ['/api/removed-matches', 'GET'], ['/api/data', 'GET']] as const) {
          const response = await first.call(route, method);
          expect(response.status, `${method} ${route}: ${await response.clone().text().then(text => text.slice(0, 300))}`).toBeLessThan(400);
          expect(await workspaceCounts(dbPath)).toEqual(before);
        }
        const data = await (await first.call('/api/data')).json();
        expect(data.matches).toHaveLength(8);
        expect(data.rounds).toHaveLength(176);
        expect(data.playerStats).toHaveLength(40);
        // Idle, as the app sits after opening.
        await new Promise(resolve => setTimeout(resolve, 1500));
        expect(await workspaceCounts(dbPath)).toEqual(before);
      } finally { await stop(first.child); }

      const second = await startServer(workspace);
      try {
        const response = await second.call('/api/data');
        expect(response.status).toBe(200);
        const data = await response.json();
        expect([data.matches.length, data.playerStats.length, data.rounds.length, data.coachingSignals.length]).toEqual([8, 40, 176, 8]);
        expect(await workspaceCounts(dbPath)).toEqual(before);
      } finally { await stop(second.child); }
    }, 120_000);
  }
});

// Gate E: the owner's own path on 0.2.1, a clean setup. Empty workspace, first
// start, import matches, restart: the counts stay the same at every step.
describe('fresh workspace through the built server', () => {
  it('starts empty, takes imported matches and keeps them across a restart', async () => {
    const workspace = path.join(tempRoot, 'fresh');
    await fs.mkdir(workspace, { recursive: true });
    const dbPath = path.join(workspace, 'db.json');

    const first = await startServer(workspace, { established: false });
    try {
      const empty = await first.call('/api/data');
      expect(empty.status).toBe(200);
      expect((await empty.json()).matches).toEqual([]);
      expect(await workspaceCounts(dbPath)).toMatchObject({ matches: 0, playerStats: 0, rounds: 0 });

      const playerIds: string[] = [];
      for (let index = 1; index <= 5; index += 1) {
        const created = await first.call('/api/roster/players', 'POST', { displayName: `Player${index}` });
        expect(created.status, await created.clone().text()).toBeLessThan(300);
        const id = (await created.json()).id as string; playerIds.push(id);
        expect((await first.call('/api/roster/core/add', 'POST', { playerId: id })).status).toBeLessThan(300);
      }
      for (let m = 1; m <= 3; m += 1) {
        const saved = await first.call('/api/save-match', 'POST', {
          match: { date: `2026-11-0${m}`, type: 'Scrim', opponent: `OpponentA${m}`, map: 'Ascent', attW: 7, attL: 5, defW: 6, defL: 4, rosterContext: { kind: 'core' } },
          statsUpdate: { operation: 'replace', stats: playerIds.map((playerId, index) => ({ rowOperation: 'create', playerId, appearanceType: 'core', agent: 'Jett', kills: 10 + index, deaths: 10, assists: index })) },
        });
        expect(saved.status, await saved.clone().text()).toBe(200);
        const matchId = (await saved.json()).match.id as string;
        const rounds = await first.call('/api/save-rounds', 'POST', { matchId, rows: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index % 2 ? 'L' : 'W', side: index < 12 ? 'Attack' : 'Defense' })) });
        expect(rounds.status, await rounds.clone().text()).toBe(200);
        expect(await workspaceCounts(dbPath)).toMatchObject({ matches: m, playerStats: m * 5, rounds: m * 22 });
      }
    } finally { await stop(first.child); }
    const imported = await workspaceCounts(dbPath);
    expect(imported).toMatchObject({ matches: 3, playerStats: 15, rounds: 66 });

    // Restart with the workspace now established, as the desktop app would.
    const second = await startServer(workspace);
    try {
      const data = await (await second.call('/api/data')).json();
      expect([data.matches.length, data.playerStats.length, data.rounds.length]).toEqual([3, 15, 66]);
      await new Promise(resolve => setTimeout(resolve, 1000));
      expect(await workspaceCounts(dbPath)).toEqual(imported);
    } finally { await stop(second.child); }
  }, 120_000);
});

describe('lost workspace through the built server', () => {
  it('still starts, reports the loss and creates nothing over it', async () => {
    const workspace = path.join(tempRoot, 'lost');
    await fs.mkdir(path.join(workspace, 'Backups', 'earlier'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'Backups', 'earlier', 'manifest.json'), '{}');
    const server = await startServer(workspace);
    try {
      const data = await server.call('/api/data');
      expect(data.status).toBe(503);
      expect((await data.json()).code).toBe('WORKSPACE_DATABASE_MISSING');
      expect((await (await server.call('/api/workspace/recovery')).json()).status).toBe('missing');
      await expect(fs.access(path.join(workspace, 'db.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await stop(server.child); }
  }, 60_000);
});
