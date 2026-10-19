import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addTryoutCandidate,
  archiveAndResetTryoutBatch,
  createRosterPlayer,
  createTryoutBatch,
  promoteTryoutCandidate,
  removeTryoutAlias,
  retireRosterPlayer,
  restoreRosterPlayer,
  deleteRosterPlayer,
  purgeExpiredRosterPlayers,
  restoreTryoutBatch,
  setTryoutAlias,
  setTryoutsMode,
  setObservedRosterStatus,
  correctObservedIdentity,
  revertObservedIdentityCorrection,
} from '../lib/roster';
import { createSeed } from '../lib/seed';

const ids = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
];
const now = () => '2026-10-12T10:00:00.000Z';

function rosterDb() {
  return {
    settings: { players: ['legacy-name'], inactivePlayers: ['other-legacy-name'] },
    rosterPlayers: [],
    coreMemberships: [],
    tryoutBatches: [],
    playerStats: [{ id: 'stat-1', player: 'legacy-name', kills: 9 }],
  };
}

describe('roster domain', () => {
  it('records a reversible batch when observed evidence is linked to a roster identity', () => {
    const db: any = rosterDb();
    db.playerStats = [
      { id: 'stat-1', matchId: 'm1', player: 'Observed Name', displayNameSnapshot: 'Observed Name', kills: 10 },
      { id: 'stat-2', matchId: 'm2', player: 'Observed Name', displayNameSnapshot: 'Observed Name', kills: 12 },
    ];
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]);
    const player = createRosterPlayer(db, 'Canonical Name', idFactory, now);
    const linked = correctObservedIdentity(db, { sourceIdentity: 'unlinked-name:observed name', targetPlayerId: player.id, reason: 'Coach verified both match rows.' }, 'Coach', idFactory, now);
    expect(linked).toMatchObject({ affectedRows: 2, correction: { id: ids[1], targetPlayerId: ids[0] } });
    expect(db.playerStats.map((row: any) => row.playerId)).toEqual([ids[0], ids[0]]);
    expect(db.playerStats[0].corrections.at(-1)).toMatchObject({ fields: ['playerId'], reason: 'Coach verified both match rows.' });

    const reverted = revertObservedIdentityCorrection(db, ids[1], 'The evidence belonged to another account.', 'Coach', now);
    expect(reverted.reverted).toBe(true);
    expect(db.playerStats.map((row: any) => row.playerId)).toEqual([undefined, undefined]);
    expect(db.identityCorrectionBatches[0]).toMatchObject({ revertedAt: now(), revertReason: 'The evidence belonged to another account.' });
  });

  it('refuses to reverse an identity batch after a later correction changed an affected row', () => {
    const db: any = rosterDb();
    db.playerStats = [{ id: 'stat-1', matchId: 'm1', player: 'Observed', kills: 10 }];
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const first = createRosterPlayer(db, 'First', idFactory, now);
    const second = createRosterPlayer(db, 'Second', idFactory, now);
    const linked = correctObservedIdentity(db, { sourceIdentity: 'unlinked-name:observed', targetPlayerId: first.id, reason: 'Initial coach verification.' }, 'Coach', idFactory, now);
    db.playerStats[0].playerId = second.id;
    expect(() => revertObservedIdentityCorrection(db, linked.correction.id, 'Undo stale correction.', 'Coach', now)).toThrow('corrected again later');
  });

  it('starts a fresh database with no invented core membership', () => {
    const seed = createSeed();
    expect(seed.rosterPlayers).toEqual([]);
    expect(seed.coreMemberships).toEqual([]);
    expect(seed.tryoutBatches).toEqual([]);
    expect(seed.settings.players).toEqual([]);
    expect(seed.matches).toEqual([]);
    expect(seed.playerStats).toEqual([]);
    expect(seed.rounds).toEqual([]);
    expect(seed.schedule).toEqual([]);
    expect(seed.goals).toEqual([]);
    expect(seed.strats).toEqual([]);
    expect(JSON.stringify(seed)).not.toMatch(/Player1|Player2|OpponentA|OpponentC|OpponentB/);
  });

  it('archives a candidate list and creates an empty batch without touching core or statistics', () => {
    const db = rosterDb();
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const player = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const batch = createTryoutBatch(db, 'October trials', idFactory, now);
    addTryoutCandidate(db, batch.id, player.id);
    const statsBefore = structuredClone(db.playerStats);
    const coreBefore = structuredClone(db.coreMemberships);

    const result = archiveAndResetTryoutBatch(db, batch.id, 'November trials', idFactory, now);

    expect(result.archived).toMatchObject({ id: batch.id, status: 'archived', candidatePlayerIds: [player.id] });
    expect(result.replacement).toMatchObject({ id: ids[2], status: 'active', candidatePlayerIds: [] });
    expect(db.playerStats).toEqual(statsBefore);
    expect(db.coreMemberships).toEqual(coreBefore);
    expect(() => promoteTryoutCandidate(db, batch.id, player.id)).toThrow('active tryout batch');
    expect(restoreTryoutBatch(db, batch.id).batch.id).toBe(batch.id);
    expect(batch.candidatePlayerIds).toEqual([player.id]);
  });

  it('promotes idempotently while retaining candidate and source-batch history', () => {
    const db = rosterDb();
    const idFactory = vi.fn()
      .mockReturnValueOnce(ids[0])
      .mockReturnValueOnce(ids[1])
      .mockReturnValueOnce(ids[2]);
    const player = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const batch = createTryoutBatch(db, 'October trials', idFactory, now);
    addTryoutCandidate(db, batch.id, player.id);

    const first = promoteTryoutCandidate(db, batch.id, player.id, idFactory, now);
    const second = promoteTryoutCandidate(db, batch.id, player.id, idFactory, now);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.membership.id).toBe(first.membership.id);
    expect(db.coreMemberships).toHaveLength(1);
    expect(first.membership.sourceTryoutBatchId).toBe(batch.id);
    expect(batch.candidatePlayerIds).toEqual([player.id]);
    expect(db.settings.players).toEqual(['Candidate A']);
    expect(db.settings.inactivePlayers).toEqual([]);
  });

  it('removes an active identity while preserving historical match evidence and revoking active links', () => {
    const db: any = rosterDb(); db.authKeys = []; db.allowedUsers = []; db.replayIntake = { devices: {} }; db.engineAdapters = { ranked: { consents: {} } };
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const player: any = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const batch = createTryoutBatch(db, 'October trials', idFactory, now); addTryoutCandidate(db, batch.id, player.id);
    promoteTryoutCandidate(db, batch.id, player.id, idFactory, now);
    db.authKeys.push({ id: 'key', playerId: player.id });
    db.authKeys.push({ id: 'legacy-name-key', role: 'player', label: 'Candidate A' }, { id: 'other-key', role: 'player', label: 'Different Player' });
    db.allowedUsers.push({ email: 'player@example.com', playerId: player.id, role: 'player' });
    db.allowedUsers.push({ email: 'legacy@example.com', name: 'Candidate A', role: 'player' }, { email: 'other@example.com', name: 'Different Player', role: 'player' });
    db.replayIntake.devices.device = { owner: { playerId: player.id }, revokedAt: null };
    db.engineAdapters.ranked.consents.consent = { playerId: player.id, revokedAt: null };
    db.playerStats.push({ id: 'historical', playerId: player.id, matchId: 'm1', kills: 10 });

    expect(retireRosterPlayer(db, player.id, now)).toMatchObject({ changed: true });
    expect(player.retiredAt).toBe(now());
    expect(player.purgeAfter).toBe('2026-12-11T10:00:00.000Z');
    expect(db.coreMemberships[0].endedAt).toBe(now());
    expect(batch.candidatePlayerIds).toEqual([player.id]);
    expect(db.authKeys).toEqual([{ id: 'other-key', role: 'player', label: 'Different Player' }]);
    expect(db.allowedUsers).toEqual([{ email: 'other@example.com', name: 'Different Player', role: 'player' }]);
    expect(db.replayIntake.devices.device.revokedAt).toBe(now());
    expect(db.engineAdapters.ranked.consents.consent.revokedAt).toBe(now());
    expect(db.playerStats).toContainEqual(expect.objectContaining({ id: 'historical', playerId: player.id }));
    expect(db.settings.players).toEqual([]);
  });

  it('recovers an archived player before retention expires', () => {
    const db: any = rosterDb(); db.authKeys = []; db.allowedUsers = [];
    const player: any = createRosterPlayer(db, 'Recover Me', () => ids[0], now);
    retireRosterPlayer(db, player.id, now);
    expect(restoreRosterPlayer(db, player.id)).toMatchObject({ changed: true, player: { id: player.id } });
    expect(player.retiredAt).toBeUndefined();
    expect(player.purgeAfter).toBeUndefined();
  });

  it('permanently deletes only archived identities and their linked player data', () => {
    const db: any = rosterDb(); db.authKeys = []; db.allowedUsers = []; db.schedule = []; db.rounds = []; db.coachingSignals = []; db.coachingActions = [];
    const player = createRosterPlayer(db, 'Erase Me', () => ids[0], now);
    db.playerStats.push({ id: 'owned', matchId: 'm1', playerId: player.id, player: 'Erase Me' });
    db.schedule.push({ id: 'event', requiredPlayerIds: [player.id], attendanceCheckIns: [{ playerId: player.id }], attendance: { [player.id]: 'late' } });
    expect(() => deleteRosterPlayer(db, player.id)).toThrow('Archive this player');
    retireRosterPlayer(db, player.id, now);
    expect(deleteRosterPlayer(db, player.id)).toMatchObject({ deleted: true, playerId: player.id });
    expect(db.rosterPlayers).toEqual([]);
    expect(db.playerStats.some((row: any) => row.playerId === player.id)).toBe(false);
    expect(db.schedule[0].requiredPlayerIds).toEqual([]);
    expect(db.schedule[0].attendanceCheckIns).toEqual([]);
  });

  it('automatically purges archived players after 60 days', () => {
    const db: any = rosterDb(); db.authKeys = []; db.allowedUsers = [];
    const player = createRosterPlayer(db, 'Expired', () => ids[0], now);
    retireRosterPlayer(db, player.id, now);
    expect(purgeExpiredRosterPlayers(db, '2026-12-11T09:59:59.000Z').purged).toEqual([]);
    expect(purgeExpiredRosterPlayers(db, '2026-12-11T10:00:00.000Z').purged).toEqual([{ id: player.id, displayName: 'Expired' }]);
    expect(db.rosterPlayers).toEqual([]);
  });

  it('creates a stable classified player without guessing links for earlier name-only rows', () => {
    const db: any = rosterDb();
    db.playerStats.push({ id: 'stat-2', player: 'Legacy-Name', matchId: 'm2', kills: 11 });
    const result = setObservedRosterStatus(db, { displayName: 'legacy-name', status: 'standIn' }, () => ids[0], now);
    expect(result).toMatchObject({ status: 'standIn', player: { id: ids[0], displayName: 'legacy-name', rosterStatus: 'standIn' } });
    expect(db.playerStats.map((row: any) => ({ id: row.id, playerId: row.playerId }))).toEqual([
      { id: 'stat-1', playerId: undefined },
      { id: 'stat-2', playerId: undefined },
    ]);
    expect(db.coreMemberships).toEqual([]);
    setObservedRosterStatus(db, { playerId: ids[0], displayName: 'legacy-name', status: 'core' }, () => ids[1], now);
    expect(db.coreMemberships).toHaveLength(1);
  });

  it('supports repeatable tryout phases without changing core membership or historical phases', () => {
    const db = rosterDb();
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const core = createRosterPlayer(db, 'Core Player', idFactory, now);
    db.coreMemberships.push({ id: ids[1], playerId: core.id, joinedAt: now() });
    const coreBefore = structuredClone(db.coreMemberships);

    const first = setTryoutsMode(db, true, undefined, idFactory, now);
    const repeated = setTryoutsMode(db, true, 'Ignored while active', idFactory, now);
    expect(repeated).toMatchObject({ created: false, batch: { id: first.batch.id } });
    expect(db.settings).toMatchObject({ tryoutsMode: true, activeTryoutBatchId: first.batch.id });
    expect(first.batch.name).toContain('2026-10-12');

    const disabled = setTryoutsMode(db, false, undefined, idFactory, now);
    expect(disabled).toMatchObject({ archived: true, batch: { id: first.batch.id, status: 'archived', archivedReason: 'tryouts-mode-disabled' } });
    expect(db.settings).toMatchObject({ tryoutsMode: false, activeTryoutBatchId: null });
    const second = setTryoutsMode(db, true, undefined, idFactory, now);
    expect(second.batch.id).not.toBe(first.batch.id);
    expect(second.batch.name).not.toBe(first.batch.name);
    expect(first.batch.status).toBe('archived');
    expect(db.coreMemberships).toEqual(coreBefore);
  });

  it('creates a fresh phase when enabling from off instead of adopting a legacy active batch', () => {
    const db: any = rosterDb();
    db.settings.tryoutsMode = false;
    db.settings.activeTryoutBatchId = null;
    db.tryoutBatches.push({
      id: 'legacy-active',
      name: 'Legacy active phase',
      status: 'active',
      candidatePlayerIds: ['legacy-candidate'],
      aliases: [],
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const idFactory = vi.fn().mockReturnValue(ids[0]);

    const enabled = setTryoutsMode(db, true, 'Fresh phase', idFactory, now);
    const repeated = setTryoutsMode(db, true, 'Must be ignored', idFactory, now);

    expect(enabled).toMatchObject({
      created: true,
      batch: { id: ids[0], name: 'Fresh phase', status: 'active', candidatePlayerIds: [] },
    });
    expect(enabled.batch.id).not.toBe('legacy-active');
    expect(db.settings).toMatchObject({ tryoutsMode: true, activeTryoutBatchId: ids[0] });
    expect(repeated).toMatchObject({ created: false, batch: { id: ids[0] } });
    expect(idFactory).toHaveBeenCalledTimes(1);
    expect(db.tryoutBatches.find((batch: any) => batch.id === 'legacy-active')).toMatchObject({
      status: 'active',
      candidatePlayerIds: ['legacy-candidate'],
    });
  });

  it('keeps aliases phase-scoped and rejects case-normalized collisions', () => {
    const db = rosterDb();
    const idFactory = vi.fn().mockReturnValueOnce(ids[0]).mockReturnValueOnce(ids[1]).mockReturnValueOnce(ids[2]);
    const first = createRosterPlayer(db, 'Candidate A', idFactory, now);
    const second = createRosterPlayer(db, 'Candidate B', idFactory, now);
    const batch = createTryoutBatch(db, 'Phase', idFactory, now);
    addTryoutCandidate(db, batch.id, first.id); addTryoutCandidate(db, batch.id, second.id);
    expect(setTryoutAlias(db, batch.id, first.id, 'Ahmed')).toMatchObject({ playerId: first.id, alias: 'Ahmed', created: true });
    expect(() => setTryoutAlias(db, batch.id, second.id, ' ahmed ')).toThrow('already assigned');
    expect(setTryoutAlias(db, batch.id, first.id, 'Ahmed 2')).toMatchObject({ alias: 'Ahmed 2', created: true });
    expect(setTryoutAlias(db, batch.id, first.id, ' ahmed ')).toMatchObject({ alias: 'Ahmed', created: false });
    expect(batch.aliases).toEqual([{ playerId: first.id, alias: 'Ahmed' }, { playerId: first.id, alias: 'Ahmed 2' }]);
    expect(removeTryoutAlias(db, batch.id, first.id, 'AHMED')).toMatchObject({ alias: 'Ahmed', removed: true });
    expect(removeTryoutAlias(db, batch.id, first.id, 'missing')).toMatchObject({ removed: false });
    expect(batch.aliases).toEqual([{ playerId: first.id, alias: 'Ahmed 2' }]);
    batch.status = 'archived';
    expect(() => setTryoutAlias(db, batch.id, first.id, 'Late')).toThrow('active tryout phase');
    expect(() => removeTryoutAlias(db, batch.id, first.id, 'Ahmed 2')).toThrow('active tryout phase');
  });
});

describe('roster HTTP and concurrency boundary', () => {
  let server: Server | undefined;
  let tempDir = '';

  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
      server = undefined;
    }
    vi.unstubAllEnvs();
    vi.resetModules();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('keeps player sessions read-only while a coach can create a stable identity', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-roster-http-'));
    const dbPath = path.join(tempDir, 'db.json');
    const playerKey = 'test-player-access-key';
    const adminKey = 'test-master-secret-at-least-24-characters';
    const base = createSeed();
    base.matches.push({ id: 'observed-match', date: '2026-10-18', type: 'Scrim', opponent: 'Team', map: 'Ascent', attW: null, attL: null, defW: null, defL: null });
    base.playerStats.push({ id: 'observed-stat', matchId: 'observed-match', player: 'Observed Alias', agent: 'Sova', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: 10, deaths: 8, assists: 4 });
    await fs.writeFile(dbPath, JSON.stringify({
      ...base,
      authKeys: [{
        id: 'player-1',
        keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'),
        label: 'Read only player',
        role: 'player',
      }],
    }));
    for (const [key, value] of Object.entries({
      NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath,
      ADMIN_PASSWORD: adminKey, JWT_SECRET: 'test-session-secret-at-least-24-characters',
      GEMINI_API_KEY: 'test-no-external-calls', GOOGLE_CLIENT_ID: '',
    })) vi.stubEnv(key, value);
    const { createApp } = await import('../server');
    const app = await createApp(false);
    server = await new Promise<Server>(resolve => {
      const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = async (key: string) => {
      const response = await fetch(`${origin}/api/login-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
      });
      return (await response.json()).key as string;
    };
    const postPlayer = async (token: string) => fetch(`${origin}/api/roster/players`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Stable Name' }),
    });

    const playerToken = await login(playerKey);
    expect((await postPlayer(playerToken)).status).toBe(403);
    expect((await fetch(`${origin}/api/roster/tryouts/mode`, { method: 'POST', headers: { Authorization: `Bearer ${playerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).status).toBe(403);
    const coachToken = await login(adminKey);
    const modeResponse = await fetch(`${origin}/api/roster/tryouts/mode`, { method: 'POST', headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, name: 'Manager phase' }) });
    expect(modeResponse.status).toBe(200);
    const modeResult = await modeResponse.json();
    expect(modeResult).toMatchObject({ enabled: true, created: true, batch: { name: 'Manager phase', aliases: [] } });
    const coachResponse = await postPlayer(coachToken);
    expect(coachResponse.status).toBe(200);
    const created = await coachResponse.json();
    expect(created).toMatchObject({ displayName: 'Stable Name' });
    const coachPost = (route: string, body: unknown) => fetch(`${origin}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await coachPost('/api/roster/tryouts/candidates', { batchId: modeResult.batch.id, playerId: created.id })).status).toBe(200);
    expect(await (await coachPost('/api/roster/tryouts/aliases', { batchId: modeResult.batch.id, playerId: created.id, alias: 'First account' })).json()).toMatchObject({ created: true });
    expect(await (await coachPost('/api/roster/tryouts/aliases', { batchId: modeResult.batch.id, playerId: created.id, alias: 'Second account' })).json()).toMatchObject({ created: true });
    expect(await (await coachPost('/api/roster/tryouts/aliases/remove', { batchId: modeResult.batch.id, playerId: created.id, alias: 'First account' })).json()).toMatchObject({ removed: true });
    expect((await fetch(`${origin}/api/roster/core/add`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: created.id }),
    })).status).toBe(200);
    expect((await fetch(`${origin}/api/settings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: ['divergent legacy edit'] }),
    })).status).toBe(200);
    expect((await fetch(`${origin}/api/roster/identity-corrections`, { method: 'POST', headers: { Authorization: `Bearer ${playerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceIdentity: 'unlinked-name:observed alias', targetPlayerId: created.id, reason: 'Coach checked the account.' }) })).status).toBe(403);
    const correctionResponse = await coachPost('/api/roster/identity-corrections', { sourceIdentity: 'unlinked-name:observed alias', targetPlayerId: created.id, reason: 'Coach checked the account.' });
    expect(correctionResponse.status).toBe(200);
    const correctionResult = await correctionResponse.json();
    expect(correctionResult).toMatchObject({ affectedRows: 1, correction: { targetPlayerId: created.id } });
    expect((await coachPost('/api/roster/identity-corrections/revert', { correctionId: correctionResult.correction.id, reason: 'Account mapping was incorrect.' })).status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rosterPlayers).toHaveLength(1);
    expect(stored.settings.players).toEqual(['Stable Name']);
    expect(stored.playerStats[0].playerId).toBeUndefined();
    expect(stored.identityCorrectionBatches[0]).toMatchObject({ revertedBy: 'Administrator (Master)' });

    expect((await coachPost('/api/access/add', { email: 'player@example.com', role: 'player' })).status).toBe(400);
    const googleAccessResponse = await coachPost('/api/access/add', { email: 'player@example.com', role: 'player', playerId: created.id });
    expect(googleAccessResponse.status).toBe(200);
    expect(await googleAccessResponse.json()).toContainEqual(expect.objectContaining({ email: 'player@example.com', role: 'player', playerId: created.id }));
    const keyResponse = await fetch(`${origin}/api/keys/create`, { method: 'POST', headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Stable player', role: 'player', playerId: created.id }) });
    expect(keyResponse.status).toBe(200); const playerAccess = await keyResponse.json(); const activePlayerSession = await login(playerAccess.key);
    expect((await fetch(`${origin}/api/data`, { headers: { Authorization: `Bearer ${activePlayerSession}` } })).status).toBe(200);
    expect((await postPlayer(activePlayerSession)).status).toBe(403);
    expect((await fetch(`${origin}/api/roster/tryouts/mode`, { method: 'POST', headers: { Authorization: `Bearer ${activePlayerSession}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).status).toBe(403);
    expect((await fetch(`${origin}/api/roster/players/remove`, { method: 'POST', headers: { Authorization: `Bearer ${coachToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: created.id }) })).status).toBe(200);
    expect((await fetch(`${origin}/api/data`, { headers: { Authorization: `Bearer ${activePlayerSession}` } })).status).toBe(401);
    expect((await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: playerAccess.key }) })).status).toBe(401);
  }, 15_000);

  it('rejects a stale whole-database roster write with 409', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-roster-stale-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify(createSeed()));
    vi.stubEnv('USE_FIRESTORE', 'false');
    vi.stubEnv('DB_PATH', dbPath);
    const { readDB, saveDB } = await import('../lib/store');
    const first = await readDB();
    const stale = await readDB();
    createRosterPlayer(first, 'First writer');
    await saveDB(first);
    createRosterPlayer(stale, 'Stale writer');
    await expect(saveDB(stale)).rejects.toMatchObject({ status: 409 });
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rosterPlayers.map((player: any) => player.displayName)).toEqual(['First writer']);
  });
});
