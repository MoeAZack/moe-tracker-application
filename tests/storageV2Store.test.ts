import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dirs: string[] = [];
afterEach(async () => { vi.resetModules(); vi.unstubAllEnvs(); await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

describe('Storage v2 local store', () => {
  it('commits artifacts before the small index and transparently hydrates reads', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store');
    const db = await readDB();
    db.matches = [{ id: 'm1', date: '2026-10-20', map: 'Ascent' }];
    db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: { reviewStatus: 'confirmed', pixels: 'x'.repeat(20_000) } }];
    await saveDB(db);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rounds[0].screenshotEvidence).toMatchObject({ __moeEvidenceArtifact: 1, bytes: expect.any(Number) });
    expect((await fs.readdir(evidenceDir)).length).toBeGreaterThan(0);
    const hydrated = await readDB();
    expect(hydrated.rounds[0].screenshotEvidence.pixels).toHaveLength(20_000);
  });

  it('fails closed instead of silently dropping a missing artifact', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-missing-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store'); const db = await readDB();
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: { pixels: 'x'.repeat(20_000) } }]; await saveDB(db);
    for (const file of await fs.readdir(evidenceDir)) await fs.unlink(path.join(evidenceDir, file));
    await expect(readDB()).rejects.toThrow(/Evidence artifact/);
  });

  it('counts retention from when an artifact was orphaned, not from when it was written', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-retention-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('EVIDENCE_ARTIFACT_RETENTION_DAYS', '1'); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store'); let db = await readDB();
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: { pixels: 'a'.repeat(20_000) } }]; await saveDB(db);
    const artifacts = async () => (await fs.readdir(evidenceDir)).filter(name => name.endsWith('.json.gz'));
    const [oldArtifact] = await artifacts(); const stale = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); await fs.utimes(path.join(evidenceDir, oldArtifact), stale, stale);
    // Written two days ago but orphaned only now: it keeps the full recovery window.
    db = await readDB(); db.rounds[0].screenshotEvidence = { pixels: 'b'.repeat(20_000) }; await saveDB(db);
    expect(await artifacts()).toContain(oldArtifact); expect(await artifacts()).toHaveLength(2);
    const ledgerPath = path.join(evidenceDir, '.orphaned-since.json');
    const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); const sha = oldArtifact.replace('.json.gz', '');
    expect(Object.keys(ledger)).toEqual([sha]);
    // Once it has been orphaned longer than the window, the next commit removes it.
    await fs.writeFile(ledgerPath, JSON.stringify({ [sha]: stale.getTime() }));
    db = await readDB(); db.settings.season = 'Next'; await saveDB(db);
    const retained = await artifacts();
    expect(retained).not.toContain(oldArtifact); expect(retained).toHaveLength(1);
  });

  it('rewrites a truncated artifact instead of trusting an index that points at it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-truncated-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store'); const db = await readDB();
    const evidence = { pixels: 'x'.repeat(20_000) };
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: evidence }]; await saveDB(db);
    // Simulate a power loss that left an empty file behind a later index.
    const [artifact] = (await fs.readdir(evidenceDir)).filter(name => name.endsWith('.json.gz'));
    await fs.writeFile(path.join(evidenceDir, artifact), '');
    vi.resetModules();
    const fresh = await import('../lib/store');
    await expect(fresh.readDB()).rejects.toThrow(/Evidence artifact/);
    const repaired = JSON.parse(await fs.readFile(dbPath, 'utf8')); repaired.rounds[0].screenshotEvidence = evidence;
    await fs.writeFile(dbPath, JSON.stringify(repaired));
    const reread = await fresh.readDB(); await fresh.saveDB(reread);
    expect((await fresh.readDB()).rounds[0].screenshotEvidence.pixels).toHaveLength(20_000);
  });
  it('flags same-game pairs on a schema-14 database whose round evidence is externalized', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-schema14-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('USE_FIRESTORE', 'false');
    const { recaptureMatch, recaptureRounds } = await import('./fixtures/sameGameRecapture');
    const { readDB, saveDB } = await import('../lib/store'); const db = await readDB();
    db.matches = [recaptureMatch('a', 'first'), recaptureMatch('b', 'second')];
    db.rounds = [...recaptureRounds('a', 'first'), ...recaptureRounds('b', 'second')];
    await saveDB(db);
    // Rewind the stored index to schema 14 without the flag, as an upgrade would find it.
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rounds[0].screenshotEvidence).toMatchObject({ __moeEvidenceArtifact: 1 });
    stored._storage.schemaVersion = 14; for (const match of stored.matches) delete match.duplicateReview;
    await fs.writeFile(dbPath, JSON.stringify(stored));
    const upgraded = await readDB();
    expect(upgraded.matches.map((match: any) => match.duplicateReview?.status || null)).toEqual([null, 'quarantined']);
    expect(upgraded.rounds).toHaveLength(48);
  });
  it('restores a backup over a workspace whose evidence artifact is missing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-restore-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('PRIVATE_BACKUP_DIR', path.join(dir, 'backups')); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store'); const { createPrivateBackup, restorePrivateBackup } = await import('../lib/privateBackup');
    let db = await readDB();
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: { pixels: 'good'.repeat(5_000) } }]; await saveDB(db);
    const backup = await createPrivateBackup({ reason: 'manual-test' });
    db = await readDB(); db.rounds[0].screenshotEvidence = { pixels: 'later'.repeat(5_000) }; await saveDB(db);
    // Lose the current round artifact: reads now fail closed.
    const current = JSON.parse(await fs.readFile(dbPath, 'utf8')).rounds[0].screenshotEvidence.sha256;
    await fs.unlink(path.join(evidenceDir, `${current}.json.gz`));
    await expect(readDB()).rejects.toThrow(/Evidence artifact/);
    const result = await restorePrivateBackup(backup.directory);
    expect(result).toMatchObject({ restored: true, preRestoreScope: 'index-only' });
    expect((await readDB()).rounds[0].screenshotEvidence.pixels).toBe('good'.repeat(5_000));
  });

  it('lets offline audits read hydrated evidence instead of artifact stubs', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-offline-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', ''); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store'); const db = await readDB();
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: { pixels: 'z'.repeat(20_000) } }]; await saveDB(db);
    const { readOfflineSnapshot } = await import('../lib/offlineSnapshot');
    const snapshot = await readOfflineSnapshot(dbPath);
    expect(snapshot.index.rounds[0].screenshotEvidence.__moeEvidenceArtifact).toBe(1);
    expect(snapshot.state.rounds[0].screenshotEvidence.pixels).toHaveLength(20_000);
    expect(JSON.parse(await fs.readFile(dbPath, 'utf8'))).toEqual(snapshot.index);
  });
});
