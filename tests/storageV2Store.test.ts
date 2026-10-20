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

  it('removes only expired unreferenced artifacts after an index commit', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-storage-v2-retention-')); dirs.push(dir);
    const dbPath = path.join(dir, 'db.json'); const evidenceDir = path.join(dir, 'evidence');
    vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('EVIDENCE_ARTIFACT_DIR', evidenceDir); vi.stubEnv('EVIDENCE_ARTIFACT_RETENTION_DAYS', '1'); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, saveDB } = await import('../lib/store'); let db = await readDB();
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: { pixels: 'a'.repeat(20_000) } }]; await saveDB(db);
    const [oldArtifact] = await fs.readdir(evidenceDir); const stale = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); await fs.utimes(path.join(evidenceDir, oldArtifact), stale, stale);
    db = await readDB(); db.rounds[0].screenshotEvidence = { pixels: 'b'.repeat(20_000) }; await saveDB(db);
    const retained = await fs.readdir(evidenceDir);
    expect(retained).not.toContain(oldArtifact); expect(retained).toHaveLength(1);
  });
});
