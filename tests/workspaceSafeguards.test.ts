import fs from 'fs/promises';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeSchema14Workspace } from './helpers/schema14Workspace';

const adminKey = 'safeguards-admin-key-1234567';
let tempDir = '';
let dbPath = '';
let backupDir = '';
let server: Server | undefined;
let origin = '';

/** Six matches with stats and rounds; m6 is a quarantined second capture of m5. */
function fixture() {
  const matches = Array.from({ length: 6 }, (_, index) => ({
    id: `m${index + 1}`, date: `2026-10-1${index}`, map: 'Ascent', opponent: `OpponentA${index + 1}`, type: 'Scrim',
    attW: 7, attL: 5, defW: 6, defL: 4, ourScore: 13, theirScore: 9, rosterContext: { kind: 'mixed' }, source: 'manual',
  })) as any[];
  matches[5].duplicateReview = { schema: 'moetracker.duplicate-review/v1', status: 'quarantined', fingerprint: 'f'.repeat(64), candidateMatchIds: ['m5'], detectedAt: '2026-10-20T00:00:00.000Z' };
  return {
    settings: { teamName: 'Test team', confirmOnDelete: false },
    matches,
    playerStats: matches.flatMap(match => [1, 2].map(player => ({ id: `${match.id}-s${player}`, matchId: match.id, player: `Player${player}`, kills: 10, deaths: 9, assists: 3 }))),
    rounds: matches.flatMap(match => [1, 2, 3].map(roundNo => ({ id: `${match.id}-r${roundNo}`, matchId: match.id, roundNo, result: 'W' }))),
    vetos: [{ id: 'v1', matchId: 'm1', seq: 1, action: 'ban', map: 'Bind' }],
    // Stored at the current schema, so no migration re-checks the quarantine flag on read.
    _storage: { schemaVersion: 15, migratedAt: '2026-10-20T00:00:00.000Z', migrationLedger: [] },
    rosterPlayers: [], coreMemberships: [], schedule: [{ id: 'keep-schedule', date: '2026-10-30', title: 'Practice' }],
  };
}

async function request(route: string, token: string, body?: unknown) {
  return fetch(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login() {
  const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: adminKey }) });
  expect(response.status).toBe(200);
  return (await response.json()).key as string;
}

const stored = async () => JSON.parse(await fs.readFile(dbPath, 'utf8'));

async function backups() {
  const entries = await fs.readdir(backupDir).catch(() => [] as string[]);
  const found: Array<{ reason: string; state: any }> = [];
  for (const name of entries) {
    const manifest = JSON.parse(await fs.readFile(path.join(backupDir, name, 'manifest.json'), 'utf8'));
    found.push({ reason: manifest.reason, state: JSON.parse(await fs.readFile(path.join(backupDir, name, 'state.json'), 'utf8')) });
  }
  return found;
}

describe('match removal safeguards over HTTP', () => {
  beforeAll(async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-safeguards-'));
    dbPath = path.join(tempDir, 'db.json'); backupDir = path.join(tempDir, 'Backups');
    for (const [key, value] of Object.entries({
      NODE_ENV: 'test', DB_PATH: dbPath, PRIVATE_BACKUP_DIR: backupDir,
      ADMIN_PASSWORD: adminKey, JWT_SECRET: 'safeguards-session-secret-123456', GEMINI_API_KEY: 'test-no-external-calls',
    })) vi.stubEnv(key, value);
    await fs.writeFile(dbPath, JSON.stringify(fixture()));
    const { createApp } = await import('../server');
    const app = await createApp(false);
    server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 15_000);

  beforeEach(async () => {
    for (const name of await fs.readdir(tempDir)) if (name !== 'db.json') await fs.rm(path.join(tempDir, name), { recursive: true, force: true });
    await fs.writeFile(dbPath, JSON.stringify(fixture()));
  });

  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    vi.unstubAllEnvs(); vi.resetModules();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Gate A2. On 0.2.0 each of these deletes left no audit entry, no backup and no undo.
  it('audits every purge in a delete burst, backs up before the last match goes, and can undo all of it', async () => {
    const token = await login();
    const discard = await request('/api/match-duplicate-review', token, { matchId: 'm6', decision: 'discard-this' });
    expect(discard.status).toBe(200);
    for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) expect((await request('/api/remove', token, { sheet: 'Matches', id })).status).toBe(200);

    const after = await stored();
    expect([after.matches.length, after.playerStats.length, after.rounds.length]).toEqual([0, 0, 0]);
    expect(after.schedule).toEqual([{ id: 'keep-schedule', date: '2026-10-30', title: 'Practice' }]);

    // One durable audit line per purge: who, which match, when, and through which route.
    const log = (await fs.readFile(`${dbPath}.match-removals.log`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(log.map(line => [line.action, line.matchId, line.route])).toEqual([
      ['removed', 'm6', 'duplicate-discard'], ...['m1', 'm2', 'm3', 'm4', 'm5'].map(id => ['removed', id, 'remove']),
    ]);
    for (const line of log) { expect(line.actor).toBeTruthy(); expect(Number.isNaN(Date.parse(line.at))).toBe(false); }

    // A backup was written before the last match went, and it still holds that match.
    const kept = await backups();
    const lastMatch = kept.find(item => item.reason === 'pre-match-removal-last-match');
    expect(lastMatch?.state.matches.map((match: any) => match.id)).toEqual(['m5']);
    expect(lastMatch?.state.rounds).toHaveLength(3);
    // The burst itself (a second removal within minutes) took one backup too, with everything still in it.
    const burst = kept.filter(item => item.reason === 'pre-match-removal-burst');
    expect(burst).toHaveLength(1);
    expect(burst[0].state.matches).toHaveLength(5);

    // Every removed match is kept whole in "Recently deleted" and restores with its rows.
    const listed = await (await request('/api/removed-matches', token)).json();
    expect(listed.removedMatches.map((entry: any) => entry.matchId).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    for (const entry of listed.removedMatches) expect((await request('/api/removed-matches/restore', token, { entryId: entry.id })).status).toBe(200);
    const restored = await stored();
    expect(restored.matches.map((match: any) => match.id).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect([restored.playerStats.length, restored.rounds.length, restored.vetos.length]).toEqual([12, 18, 1]);
    expect((await (await request('/api/removed-matches', token)).json()).removedMatches).toEqual([]);
    const restoreLines = (await fs.readFile(`${dbPath}.match-removals.log`, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(line => line.action === 'restored');
    expect(restoreLines).toHaveLength(6);
  });

  it('never sends the kept copies in the tracker payload, and only coaches can list or restore them', async () => {
    const token = await login();
    expect((await request('/api/remove', token, { sheet: 'Matches', id: 'm1' })).status).toBe(200);
    const data = await (await request('/api/data', token)).json();
    expect(data.removedMatches).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('m1-r1');
  });

  it('a metrics reset takes a recovery backup first and fails closed when it cannot', async () => {
    const token = await login();
    const reset = await request('/api/reset-metrics', token, {});
    expect(reset.status).toBe(200);
    const { backupId } = await reset.json();
    expect(backupId).toBeTruthy();
    const [backup] = await backups();
    expect(backup.reason).toBe('pre-reset-metrics');
    expect(backup.state.matches).toHaveLength(6);
    expect((await stored()).matches).toEqual([]);

    // Backup location unusable: nothing is erased.
    await fs.writeFile(dbPath, JSON.stringify(fixture()));
    await fs.rm(backupDir, { recursive: true, force: true }); await fs.writeFile(backupDir, 'not a folder');
    const before = await fs.readFile(dbPath, 'utf8');
    const refused = await request('/api/reset-metrics', token, {});
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await fs.readFile(dbPath, 'utf8')).toBe(before);
  });
});

describe('store guards', () => {
  let dir = '';
  beforeEach(async () => {
    vi.resetModules();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-guards-'));
    vi.stubEnv('DB_PATH', path.join(dir, 'db.json'));
    vi.stubEnv('PRIVATE_BACKUP_DIR', path.join(dir, 'Backups'));
    vi.stubEnv('DESKTOP_WORKSPACE_ESTABLISHED', '');
  });
  afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

  it('refuses an ordinary save that empties matches, rounds or player stats, and allows it with the destructive flag', async () => {
    await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify(fixture()));
    const { readDB, saveDB } = await import('../lib/store');
    const { markDestructiveSave } = await import('../lib/destructiveSave');
    for (const key of ['matches', 'rounds', 'playerStats']) {
      const db = await readDB(); db[key] = [];
      await expect(saveDB(db)).rejects.toMatchObject({ status: 409, code: 'WORKSPACE_EMPTYING_REFUSED', emptied: [key] });
    }
    expect(JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8')).matches).toHaveLength(6);
    // Removing some rows is ordinary.
    const partial = await readDB(); partial.rounds = partial.rounds.slice(1); await saveDB(partial);
    const flagged = await readDB(); flagged.rounds = []; markDestructiveSave(flagged); await saveDB(flagged);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8')).rounds).toEqual([]);
  });

  it('keeps the exact stored bytes before the first save from an older schema, once', async () => {
    const { dbPath: file } = await writeSchema14Workspace(dir);
    const original = await fs.readFile(file, 'utf8');
    const { readDB, saveDB } = await import('../lib/store');
    await saveDB(await readDB());
    const copies = (await fs.readdir(dir)).filter(name => name.startsWith('db.json.pre-migration-v14-'));
    expect(copies).toHaveLength(1);
    expect(await fs.readFile(path.join(dir, copies[0]), 'utf8')).toBe(original);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))._storage.schemaVersion).toBe(15);
    await saveDB(await readDB());
    expect((await fs.readdir(dir)).filter(name => name.startsWith('db.json.pre-migration-'))).toHaveLength(1);
  });

  it('loads evidence before migrating, so a schema-14 workspace with a season archive opens intact', async () => {
    const { dbPath: file } = await writeSchema14Workspace(dir, { withArchive: true });
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB();
    expect([db.matches.length, db.rounds.length, db.seasonArchives.length]).toEqual([8, 176, 1]);
    expect(db.seasonArchives[0].matches).toHaveLength(3);
    expect(db.rounds[0].screenshotEvidence.note).toMatch(/^round-m1-1/);
    // The archive itself was migrated (its aggregates rebuilt), which needs its evidence loaded first.
    expect(Object.values(db.seasonArchives[0].analyticsBuilds || {}).map((build: any) => typeof build.status)).toEqual(['string', 'string', 'string']);
    expect(Object.values(db.analyticsBuilds).every((build: any) => typeof build.status === 'string')).toBe(true);
    await saveDB(db);
    const reread = await readDB();
    expect([reread.matches.length, reread.rounds.length, reread.seasonArchives[0].matches.length]).toEqual([8, 176, 3]);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))._storage.schemaVersion).toBe(15);
  });

  it('does not sweep evidence in the process that migrated, when the index references nothing, or when most references vanish', async () => {
    const { dbPath: file, evidenceDir } = await writeSchema14Workspace(dir);
    const ledger = path.join(evidenceDir, '.orphaned-since.json');
    const { readDB, saveDB, storeInternals } = await import('../lib/store');
    const { markDestructiveSave } = await import('../lib/destructiveSave');
    // Migration process: a small removal does not start any orphan clock.
    const migrated = await readDB(); migrated.rounds = migrated.rounds.filter((round: any) => round.matchId !== 'm1'); await saveDB(migrated);
    await expect(fs.access(ledger)).rejects.toMatchObject({ code: 'ENOENT' });

    storeInternals.resetMigrationMark();
    // Most references vanish at once: no sweep.
    const most = await readDB(); const keep = new Set(['m7', 'm8']);
    for (const key of ['matches', 'rounds', 'playerStats']) most[key] = most[key].filter((row: any) => keep.has(row.matchId ?? row.id));
    most.analyticsBuilds = {}; await saveDB(most);
    await expect(fs.access(ledger)).rejects.toMatchObject({ code: 'ENOENT' });
    // Nothing referenced: no sweep.
    const none = await readDB(); for (const key of ['matches', 'rounds', 'playerStats']) none[key] = []; none.analyticsBuilds = {}; markDestructiveSave(none); await saveDB(none);
    await expect(fs.access(ledger)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(evidenceDir)).filter(name => name.endsWith('.json.gz')).length).toBeGreaterThan(0);

    // An ordinary small change still sweeps: the guard is not a blanket off switch.
    const back = await readDB();
    back.matches = [{ id: 'x1', date: '2026-11-01', map: 'Ascent', opponent: 'OpponentB', roundAnalytics: { note: 'a'.padEnd(1100, '.') } }, { id: 'x2', date: '2026-11-02', map: 'Ascent', opponent: 'OpponentC', roundAnalytics: { note: 'b'.padEnd(1100, '.') } }];
    back.rounds = Array.from({ length: 8 }, (_, index) => ({ id: `x1-r${index}`, matchId: 'x1', roundNo: index + 1, screenshotEvidence: { reviewStatus: 'pending', players: [], events: [], note: `x${index}`.padEnd(1100, '.') } }));
    await saveDB(back);
    const small = await readDB(); small.rounds = small.rounds.slice(1); await saveDB(small);
    expect(Object.keys(JSON.parse(await fs.readFile(ledger, 'utf8'))).length).toBeGreaterThan(0);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).matches).toHaveLength(2);
  });

  it('keeps a deleted match out of the active index as evidence artifacts and restores it exactly', async () => {
    await writeSchema14Workspace(dir);
    const { readDB, saveDB } = await import('../lib/store');
    const { quarantineMatch, restoreRemovedMatch } = await import('../lib/matchRemoval');
    const { markDestructiveSave } = await import('../lib/destructiveSave');
    const db = await readDB();
    db.engineAdapters = { ...(db.engineAdapters || {}), replay: { 'draft-m3': { matchId: 'm3', draft: { note: 'keep' } }, other: { matchId: 'm4' } } };
    await saveDB(db);
    const original = await readDB();
    const expected = { match: original.matches.find((match: any) => match.id === 'm3'), rounds: original.rounds.filter((round: any) => round.matchId === 'm3'), stats: original.playerStats.filter((stat: any) => stat.matchId === 'm3') };

    const working = await readDB();
    const entry = quarantineMatch(working, 'm3', { actor: 'Coach', route: 'remove' }); markDestructiveSave(working); await saveDB(working);
    const index = JSON.parse(await fs.readFile(path.join(dir, 'db.json'), 'utf8'));
    expect(index.matches.map((match: any) => match.id)).not.toContain('m3');
    expect(index.engineAdapters.replay['draft-m3']).toBeUndefined();
    expect(index.removedMatches[0].graph.rounds.__moeEvidenceArtifact).toBe(1);
    expect(index.removedMatches[0].graph.playerStats.__moeEvidenceArtifact).toBe(1);

    const reread = await readDB();
    restoreRemovedMatch(reread, entry.id, { actor: 'Coach' }); await saveDB(reread);
    const back = await readDB();
    expect(back.matches.find((match: any) => match.id === 'm3')).toEqual(expected.match);
    expect(back.rounds.filter((round: any) => round.matchId === 'm3')).toEqual(expected.rounds);
    expect(back.playerStats.filter((stat: any) => stat.matchId === 'm3')).toEqual(expected.stats);
    expect(back.engineAdapters.replay['draft-m3']).toEqual({ matchId: 'm3', draft: { note: 'keep' } });
    expect(back.removedMatches[0]).toMatchObject({ matchId: 'm3', restoredBy: 'Coach' });
    expect(back.removedMatches[0].graph).toBeUndefined();
  });

  it('never replaces a missing database with an empty one when the workspace existed before', async () => {
    const backupFolder = path.join(dir, 'Backups', 'one');
    await fs.mkdir(backupFolder, { recursive: true });
    await fs.writeFile(path.join(backupFolder, 'manifest.json'), '{}');
    const { readDB } = await import('../lib/store');
    await expect(readDB()).rejects.toMatchObject({ status: 503, code: 'WORKSPACE_DATABASE_MISSING' });
    await expect(fs.access(path.join(dir, 'db.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a desktop app that was set up before as an existing workspace', async () => {
    vi.stubEnv('DESKTOP_WORKSPACE_ESTABLISHED', 'true');
    const { readDB } = await import('../lib/store');
    await expect(readDB()).rejects.toMatchObject({ code: 'WORKSPACE_DATABASE_MISSING' });
  });

  it('still creates a new workspace on a true first start', async () => {
    const { readDB } = await import('../lib/store');
    const db = await readDB();
    expect(db.matches).toEqual([]);
    await expect(fs.access(path.join(dir, 'db.json'))).resolves.toBeUndefined();
  });
});

describe('match delete in Match Review', () => {
  const source = readFileSync('src/components/MatchLogRounds.tsx', 'utf8');
  const handler = source.slice(source.indexOf('const handleDeleteMatch'), source.indexOf('// --- ROUND LOG MUTATIONS'));

  it('always asks before deleting a match, whatever the confirmation setting says', () => {
    expect(handler).toContain('confirmDialog(');
    expect(handler).not.toContain('confirmOnDelete');
    expect(handler).toContain('Recently deleted');
  });

  it('selects the first match only once, so the Delete button never lands on the next match', () => {
    expect(source).toContain('!selectedMatch && !autoSelected.current');
    expect(source).toContain('<RecentlyDeletedMatches');
  });
});

describe('recovering a lost workspace in the desktop app', () => {
  let dir = ''; let app: Server | undefined; let base = '';
  const call = async (route: string, token: string, body?: unknown) => fetch(`${base}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  beforeEach(async () => {
    vi.resetModules();
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-recovery-'));
    for (const [key, value] of Object.entries({ NODE_ENV: 'test', APP_DESKTOP: 'true', DB_PATH: path.join(dir, 'db.json'), PRIVATE_BACKUP_DIR: path.join(dir, 'Backups'), ADMIN_PASSWORD: adminKey, JWT_SECRET: 'recovery-session-secret-1234567', GEMINI_API_KEY: 'test-no-external-calls' })) vi.stubEnv(key, value);
    await fs.writeFile(path.join(dir, 'db.json'), JSON.stringify(fixture()));
    const { createPrivateBackup } = await import('../lib/privateBackup');
    await createPrivateBackup({ reason: 'desktop-daily-recovery' });
    await fs.rm(path.join(dir, 'db.json'));
    const { createApp } = await import('../server');
    const instance = await createApp(false);
    app = await new Promise<Server>(resolve => { const listening = instance.listen(0, '127.0.0.1', () => resolve(listening)); });
    base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    if (app) { app.closeAllConnections(); await new Promise<void>(resolve => app!.close(() => resolve())); app = undefined; }
    vi.unstubAllEnvs(); vi.resetModules(); if (dir) await fs.rm(dir, { recursive: true, force: true });
  });
  const coach = async () => (await (await fetch(`${base}/api/login-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: adminKey }) })).json()).key as string;

  it('reports the lost workspace and restores the chosen backup', async () => {
    const token = await coach();
    const data = await call('/api/data', token);
    expect(data.status).toBe(503);
    expect((await data.json()).code).toBe('WORKSPACE_DATABASE_MISSING');
    const status = await (await call('/api/workspace/recovery', token)).json();
    expect(status.status).toBe('missing');
    expect(status.backups).toHaveLength(1);
    expect((await call('/api/workspace/recovery/restore', token, { backupId: status.backups[0].id })).status).toBe(200);
    const restored = await (await call('/api/data', token)).json();
    expect(restored.matches).toHaveLength(6);
    // With the workspace open again, recovery actions are refused.
    expect((await call('/api/workspace/recovery/start-empty', token, {})).status).toBe(409);
  });

  it('starts an empty workspace only when the coach asks, and keeps the backups', async () => {
    const token = await coach();
    expect((await call('/api/workspace/recovery/start-empty', token, {})).status).toBe(201);
    expect((await (await call('/api/data', token)).json()).matches).toEqual([]);
    expect((await fs.readdir(path.join(dir, 'Backups')))).toHaveLength(1);
  });
});
