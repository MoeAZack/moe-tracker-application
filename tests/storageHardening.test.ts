import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeStorageDocuments, ensureStorageSchema, MAX_ENTITY_BYTES, STORAGE_SCHEMA_VERSION, validateTrackerState} from '../lib/storageSchema';
import { DurableFilesystemReplayStorage } from '../lib/replayIntakeSafety';
import { replayIntakeInternals } from '../lib/routes/replayIntake';
import { assertSeasonArchivesStorageSize } from '../lib/roster';

const tempDirs: string[] = [];
afterEach(async () => { delete process.env.PRIVATE_BACKUP_KEY; delete process.env.PRIVATE_BACKUP_KEEP; delete process.env.DB_PATH; delete process.env.REPLAY_STORAGE_DIR; delete process.env.PRIVATE_BACKUP_DIR; vi.resetModules(); await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

function state() {
  return ensureStorageSchema({ settings: {}, matches: [], playerStats: [], seasonArchives: [], replayIntake: { schemaVersion: 4, devices: {}, blobs: {}, associations: {}, parserJobs: {}, reviews: {} }, engineAdapters: { replay: {}, ratings: { records: {} } } });
}

describe('storage record bounds', () => {
  it('splits a representative aggregate over 1 MiB into bounded documents', () => {
    const input = state();
    input.matches = Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, notes: 'x'.repeat(100_000) }));
    expect(Buffer.byteLength(JSON.stringify(input.matches))).toBeGreaterThan(1024 * 1024);
    const encoded = encodeStorageDocuments(input);
    expect(encoded.filter(doc => doc.payload.topKey === 'matches').length).toBe(13);
    expect(Math.max(...encoded.map(doc => Buffer.byteLength(JSON.stringify(doc.payload))))).toBeLessThan(1024 * 1024);
    input.seasonArchives = Array.from({ length: 4 }, (_, index) => ({ id: `s${index}`, snapshot: 'y'.repeat(300_000) }));
    expect(() => assertSeasonArchivesStorageSize(input.seasonArchives)).not.toThrow();
    expect(encodeStorageDocuments(input).filter(doc => doc.payload.topKey === 'seasonArchives')).toHaveLength(5);
  });

  it('rejects a too-large entity and a newer schema', () => {
    const input = state(); input.matches = [{ id: 'oversized', notes: 'x'.repeat(MAX_ENTITY_BYTES + 1000) }];
    expect(() => encodeStorageDocuments(input)).toThrow(/entity limit/);
    expect(() => ensureStorageSchema({ _storage: { schemaVersion: STORAGE_SCHEMA_VERSION + 1 } })).toThrow(/newer/);
  });

  it('preserves the coach-selected active and inactive agent catalogs', () => {
    const input: any = state(); input.settings = { agents: ['Omen', 'Custom Agent'], inactiveAgents: ['Jett'] };
    const normalized = ensureStorageSchema(input);
    expect(normalized.settings.agents).toEqual(['Omen', 'Custom Agent']); expect(normalized.settings.inactiveAgents).toEqual(['Jett']);
  });

  it.each([
    [{ settings: null }, /settings/],
    [{ rounds: {} }, /rounds/],
    [{ schedule: 'bad' }, /schedule/],
    [{ authKeys: {} }, /authKeys/],
    [{ goals: {} }, /goals/],
  ])('rejects structurally invalid core state %#', (invalid, message) => {
    expect(() => validateTrackerState(invalid)).toThrow(message);
  });

  it('omits undefined parser-job failure consistently through validation and encoding', () => {
    const input = state(); input.replayIntake.parserJobs.completed = {
      id: 'completed', sha256: 'a'.repeat(64), status: 'completed', result: { scoreboard: [] }, failure: undefined,
    };
    expect(() => validateTrackerState(input)).not.toThrow();
    const job = encodeStorageDocuments(input).filter(doc => doc.payload.topKey === 'replayIntake' && JSON.stringify((doc.payload.path as unknown[]).slice(0, 2)) === JSON.stringify(['parserJobs', 'completed']));
    const leaves = Object.fromEntries(job.filter(doc => doc.payload.kind === 'value').map(doc => [String((doc.payload.path as unknown[])[2]), doc.payload.value]));
    expect(leaves).toMatchObject({ id: 'completed', status: 'completed' });
    expect(leaves).not.toHaveProperty('failure');
  });
});

describe('persisted parser lease fencing', () => {
  const job = () => ({ id: 'j1', sha256: 'a'.repeat(64), requestedBy: 'coach', status: 'queued', sourceDeviceIds: ['d1'], createdAt: '2026-01-01T00:00:00.000Z', startedAt: null, completedAt: null, parser: { name: 'vrfkit', version: '0.2.5' }, reviewStatus: 'review-required' });
  it('allows one owner, preserves a live lease across restart, and recovers only expiry', () => {
    const store: any = { parserJobs: { j1: job() } };
    const first = replayIntakeInternals.claimParserLease(store, 'instance-a', Date.now());
    const expiresAt = Date.parse(first!.job.lease.expiresAt);
    expect(first?.job.lease.owner).toBe('instance-a');
    expect(replayIntakeInternals.claimParserLease(store, 'instance-b', Date.now())).toBeNull();
    expect(replayIntakeInternals.recoverExpiredParserLeases(store, Date.now())).toBe(0);
    expect(replayIntakeInternals.recoverExpiredParserLeases(store, expiresAt + 1)).toBe(1);
    const second = replayIntakeInternals.claimParserLease(store, 'instance-b', expiresAt + 2);
    expect(second?.job.lease.owner).toBe('instance-b');
    expect(second!.fence).toBeGreaterThan(first!.fence);
    expect(replayIntakeInternals.leaseMatches(second?.job, 'instance-a', first!.fence)).toBe(false);
  });

  it('arms a deterministic startup wakeup for an unexpired foreign lease', () => {
    vi.useFakeTimers();
    try {
      const now = Date.now(); const store: any = { parserJobs: { j1: job() } };
      replayIntakeInternals.claimParserLease(store, 'foreign-instance', now);
      const callback = vi.fn(); const delay = replayIntakeInternals.nextParserLeaseRecoveryDelay(store, now)!;
      replayIntakeInternals.scheduleParserLeaseRecovery(store, callback, now);
      vi.advanceTimersByTime(delay - 1); expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1); expect(callback).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});

describe('undefined parser persistence', () => {
  it('saves and reloads a successful parser job with failure undefined', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-parser-save-')); tempDirs.push(dir); vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json');
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB(); db.replayIntake = { schemaVersion: 4, devices: {}, blobs: {}, associations: {}, reviews: {}, parserJobs: {
      completed: { id: 'completed', sha256: 'a'.repeat(64), status: 'completed', result: { scoreboard: [] }, failure: undefined },
    } };
    await expect(saveDB(db)).resolves.toBeUndefined();
    const recovered = await readDB(); expect(recovered.replayIntake.parserJobs.completed).not.toHaveProperty('failure');
  });
});

describe('durable replay publication', () => {
  it('publishes and verifies through the no-hardlink fallback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-')); tempDirs.push(dir);
    const temp = path.join(dir, 'upload'); const final = path.join(dir, 'objects', 'blob.vrf'); const body = Buffer.from('verified replay bytes');
    await fs.writeFile(temp, body); const hash = crypto.createHash('sha256').update(body).digest('hex');
    const operations: any = { ...fs, link: async () => { throw Object.assign(new Error('no hardlinks'), { code: 'ENOTSUP' }); } };
    const storage = new DurableFilesystemReplayStorage(operations);
    await expect(storage.publishVerified(temp, final, hash, body.length)).resolves.toBe(true);
    await expect(storage.verify(final, hash, body.length)).resolves.toBe(true);
  });

  it('fails closed on corruption and copy failure without publishing a final object', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-')); tempDirs.push(dir);
    const temp = path.join(dir, 'upload'); const final = path.join(dir, 'objects', 'blob.vrf'); await fs.writeFile(temp, 'bad');
    const storage = new DurableFilesystemReplayStorage();
    await expect(storage.publishVerified(temp, final, '0'.repeat(64), 3)).rejects.toMatchObject({ status: 422 });
    await expect(fs.stat(final)).rejects.toMatchObject({ code: 'ENOENT' });
    const good = Buffer.from('good'); await fs.writeFile(temp, good); const hash = crypto.createHash('sha256').update(good).digest('hex');
    const failing: any = { ...fs,
      link: async () => { throw Object.assign(new Error('no hardlinks'), { code: 'ENOTSUP' }); },
      copyFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); },
    };
    await expect(new DurableFilesystemReplayStorage(failing).publishVerified(temp, final, hash, good.length)).rejects.toMatchObject({ code: 'ENOSPC' });
    await expect(fs.stat(final)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(temp)).resolves.toEqual(good);
  });

  it('recovers an expired owned publication lock but preserves a live foreign lock', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-lock-')); tempDirs.push(dir);
    const final = path.join(dir, 'objects', 'blob.vrf'); const lock = `${final}.publish.lock`; const recoveryLock = `${lock}.recovery`; await fs.mkdir(path.dirname(final), { recursive: true });
    const body = Buffer.from('lock recovery'); const hash = crypto.createHash('sha256').update(body).digest('hex');
    const operations: any = { ...fs, link: async () => { throw Object.assign(new Error('no hardlinks'), { code: 'ENOTSUP' }); } };
    const storage = new DurableFilesystemReplayStorage(operations);
    await fs.writeFile(lock, JSON.stringify({ owner: 'dead-owner', expiresAt: new Date(Date.now() - 1_000).toISOString() }));
    await fs.writeFile(recoveryLock, JSON.stringify({ owner: 'dead-recovery', expiresAt: new Date(Date.now() - 1_000).toISOString() }));
    const first = path.join(dir, 'first.upload'); await fs.writeFile(first, body);
    await expect(storage.publishVerified(first, final, hash, body.length)).resolves.toBe(true);
    await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(recoveryLock)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(final); await fs.writeFile(lock, JSON.stringify({ owner: 'live-owner', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    const second = path.join(dir, 'second.upload'); await fs.writeFile(second, body);
    await expect(storage.publishVerified(second, final, hash, body.length)).rejects.toMatchObject({ status: 423, code: 'REPLAY_PUBLICATION_LOCKED' });
    expect(JSON.parse(await fs.readFile(lock, 'utf8')).owner).toBe('live-owner');
    await fs.writeFile(lock, JSON.stringify({ owner: 'dead-owner-2', expiresAt: new Date(Date.now() - 1_000).toISOString() }));
    await fs.writeFile(recoveryLock, JSON.stringify({ owner: 'live-recovery', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await expect(storage.publishVerified(second, final, hash, body.length)).rejects.toMatchObject({ status: 423, code: 'REPLAY_PUBLICATION_LOCKED' });
    expect(JSON.parse(await fs.readFile(recoveryLock, 'utf8')).owner).toBe('live-recovery');
  });
});

describe('private backup and exact restore', () => {
  it('encrypts recovery state, never stores secrets, restores with the device key and prunes old automatic copies', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-enc-')); tempDirs.push(dir);
    vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    process.env.PRIVATE_BACKUP_KEY = 'device-key-material-0123456789'; process.env.PRIVATE_BACKUP_KEEP = '2';
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB(); db.matches = [{ id: 'kept' }]; db.secrets = { HENRIK_API_KEY: 'super-secret-value' }; await saveDB(db);
    const backup = await import('../lib/privateBackup');
    const made = await backup.createPrivateBackup({ reason: 'scheduled-private-recovery' });
    const files = await fs.readdir(made.directory);
    expect(files).toContain('state.json.enc'); expect(files).not.toContain('state.json');
    const stored = await fs.readFile(path.join(made.directory, 'state.json.enc'), 'utf8');
    expect(stored).not.toContain('kept'); expect(stored).not.toContain('super-secret-value');
    const changed = await readDB(); changed.matches = []; await saveDB(changed);
    await expect(backup.restorePrivateBackup(made.directory)).resolves.toMatchObject({ restored: true });
    const restored = await readDB(); expect(restored.matches).toEqual([{ id: 'kept' }]); expect(restored.secrets).toMatchObject({ HENRIK_API_KEY: 'super-secret-value' });
    process.env.PRIVATE_BACKUP_KEY = 'a-different-device-key-material';
    await expect(backup.validatePrivateBackup(made.directory)).rejects.toThrow(/decrypt/);
    process.env.PRIVATE_BACKUP_KEY = 'device-key-material-0123456789';
    for (let index = 0; index < 3; index += 1) await backup.createPrivateBackup({ reason: 'scheduled-private-recovery' });
    const automatic = [];
    for (const entry of await fs.readdir(path.join(dir, 'backups'))) {
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'backups', entry, 'manifest.json'), 'utf8'));
      if (String(manifest.reason).startsWith('scheduled')) automatic.push(entry);
    }
    expect(automatic).toHaveLength(2);
  });
  it('validates checksums, supports dry-run, snapshots before replacement, and deletes omissions', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-')); tempDirs.push(dir);
    vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB(); db.matches = [{ id: 'kept' }]; db.playerStats = [{ id: 'omitted-later', matchId: 'kept' }]; await saveDB(db);
    const backup = await import('../lib/privateBackup');
    const made = await backup.createPrivateBackup({ reason: 'test' });
    expect(made.manifest.replayBlobs).toMatchObject({ embedded: false });
    const changed = await readDB(); changed.matches.push({ id: 'delete-on-restore' }); changed.playerStats = []; await saveDB(changed);
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ dryRun: true, metadataValid: true, blobInventoryComplete: true, readyForRestore: true });
    await expect(backup.restorePrivateBackup(made.directory)).resolves.toMatchObject({ restored: true, completeReplacement: true });
    const restored = await readDB(); expect(restored.matches).toEqual([{ id: 'kept' }]); expect(restored.playerStats).toEqual([{ id: 'omitted-later', matchId: 'kept' }]);
    const statePath = path.join(made.directory, 'state.json'); await fs.appendFile(statePath, 'corrupt');
    await expect(backup.validatePrivateBackup(made.directory)).rejects.toThrow(/checksum/);
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ metadataValid: false, blobInventoryComplete: null, readyForRestore: false });
  });

  it('separates valid backup metadata from an incomplete replay blob inventory', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-blobs-')); tempDirs.push(dir); vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    const { readDB, saveDB } = await import('../lib/store'); const backup = await import('../lib/privateBackup');
    const db = await readDB(); db.replayIntake = { schemaVersion: 4, devices: {}, associations: {}, parserJobs: {}, reviews: {}, blobs: { ['a'.repeat(64)]: { sha256: 'a'.repeat(64), size: 3 } } }; await saveDB(db);
    const made = await backup.createPrivateBackup({ reason: 'missing-blob-test' });
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ metadataValid: true, blobInventoryComplete: false, readyForRestore: false, blobStatus: { missing: ['a'.repeat(64)] } });
    await expect(backup.restorePrivateBackup(made.directory)).rejects.toMatchObject({ status: 409 });
    await expect(backup.reconcileReplayBlobInventory()).resolves.toMatchObject({ checked: 1, healthy: 0, missing: ['a'.repeat(64)] });
  });

  it('accepts intentional no-byte evidence states but rejects unverified active cloud raw bytes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-backup-hybrid-')); tempDirs.push(dir); vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json'); process.env.REPLAY_STORAGE_DIR = path.join(dir, 'replays'); process.env.PRIVATE_BACKUP_DIR = path.join(dir, 'backups');
    const { readDB, saveDB } = await import('../lib/store'); const backup = await import('../lib/privateBackup'); const db = await readDB();
    const evidence = 'b'.repeat(64); const deleted = 'c'.repeat(64); const active = 'd'.repeat(64);
    db.replayIntake = { schemaVersion: 5, devices: {}, associations: {}, parserJobs: {}, reviews: {}, rawSessions: {}, rawReceipts: {}, blobs: {
      [evidence]: { sha256: evidence, size: 10, ingestionMode: 'local-evidence', parserStatus: 'parsed-review-required' },
      [deleted]: { sha256: deleted, size: 11, ingestionMode: 'coach-raw', rawObject: { status: 'deleted' }, parserStatus: 'parsed-review-required' },
      [active]: { sha256: active, size: 12, ingestionMode: 'coach-raw', rawObject: { status: 'parse-failed' }, parserStatus: 'failed' },
    } }; await saveDB(db);
    const made = await backup.createPrivateBackup({ reason: 'hybrid-inventory' });
    await expect(backup.restorePrivateBackup(made.directory, { dryRun: true })).resolves.toMatchObject({ metadataValid: true, readyForRestore: false, blobStatus: { missing: [], intentionallyOmitted: [evidence, deleted], externalUnverified: [active] } });
    const reconciled = await backup.reconcileReplayBlobInventory(); expect(reconciled).toMatchObject({ healthy: 2, missing: [], intentionallyOmitted: [evidence, deleted], externalUnverified: [active] });
  });
});

describe('shareable import safety', () => {
  it('clears stale private evidence and still uses the read revision', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-import-')); tempDirs.push(dir); vi.resetModules();
    process.env.DB_PATH = path.join(dir, 'db.json');
    const { readDB, saveDB } = await import('../lib/store'); const { prepareShareableImport } = await import('../lib/routes/extras');
    const seeded = await readDB(); seeded.replayIntake = { blobs: { stale: true } }; seeded.engineAdapters = { replay: { stale: true } }; seeded.authKeys = [{ id: 'keep-access' }]; await saveDB(seeded);
    const importing = await readDB();
    prepareShareableImport(importing, { settings: {}, matches: [{ id: 'imported' }], playerStats: [], rounds: [], schedule: [], goals: [], replayIntake: { attacker: true }, engineAdapters: { attacker: true } });
    expect(importing).not.toHaveProperty('replayIntake'); expect(importing).not.toHaveProperty('engineAdapters'); expect(importing.authKeys).toEqual([{ id: 'keep-access' }]);
    const winner = await readDB(); winner.matches = [{ id: 'concurrent' }]; await saveDB(winner);
    await expect(saveDB(importing)).rejects.toMatchObject({ status: 409 });
  });
});
