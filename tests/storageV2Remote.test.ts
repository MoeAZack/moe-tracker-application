import { afterEach, describe, expect, it, vi } from 'vitest';
import { createD1Fake, createFirestoreFake } from './helpers/storageFakes';

const firestoreHolder = vi.hoisted(() => ({ current: null as any }));
vi.mock('@google-cloud/firestore', () => ({ Firestore: class { constructor() { return firestoreHolder.current; } } }));

afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); firestoreHolder.current = null; });
const DAY = 24 * 60 * 60 * 1000;
const evidence = (fill: string) => ({ reviewStatus: 'confirmed', pixels: fill.repeat(20_000) });

describe('Storage v2 on D1', () => {
  it('batches artifact inserts and collects only artifacts orphaned past the window', async () => {
    vi.stubEnv('USE_FIRESTORE', 'false'); vi.stubEnv('EVIDENCE_GC_INTERVAL_MS', '0'); vi.stubEnv('EVIDENCE_ARTIFACT_RETENTION_DAYS', '1');
    const d1 = createD1Fake();
    const store = await import('../lib/store'); store.configureD1Store(d1);
    let db = await store.readDB();
    db.matches = [{ id: 'm1' }];
    db.rounds = Array.from({ length: 120 }, (_, index) => ({ id: `r${index}`, matchId: 'm1', roundNo: index + 1, screenshotEvidence: evidence(String.fromCharCode(65 + (index % 26)) + index) }));
    const before = d1.calls.run;
    await store.saveDB(db);
    // 120 artifacts went in as batches, not as 120 individual statements.
    expect(d1.calls.run - before).toBeLessThan(20);
    const count = () => Number((d1.sqlite.prepare('SELECT COUNT(*) AS n FROM tracker_evidence_artifacts').get() as any).n);
    const total = count(); expect(total).toBeGreaterThanOrEqual(120);

    // Drop half the rounds; their artifacts are still referenced by retained revisions.
    db = await store.readDB(); db.rounds = db.rounds.slice(0, 60); await store.saveDB(db);
    expect(count()).toBe(total);
    // Push the old revisions out of the rollback window: four more saves.
    for (let index = 0; index < 4; index += 1) { db = await store.readDB(); db.settings.season = `S${index}`; await store.saveDB(db); }
    expect(count()).toBe(total);
    const orphans = Number((d1.sqlite.prepare('SELECT COUNT(*) AS n FROM tracker_artifact_orphans').get() as any).n);
    expect(orphans).toBeGreaterThanOrEqual(60);
    // Once the orphan window has passed, the next write removes them and keeps everything referenced.
    d1.sqlite.prepare('UPDATE tracker_artifact_orphans SET orphaned_at = ?').run(Date.now() - 2 * DAY);
    db = await store.readDB(); db.settings.season = 'final'; await store.saveDB(db);
    expect(count()).toBe(total - orphans);
    expect((await store.readDB()).rounds).toHaveLength(60);
  });
});

describe('Storage v2 on Firestore', () => {
  it('keeps three inactive revisions and collects artifacts orphaned past the window', async () => {
    vi.stubEnv('USE_FIRESTORE', 'true'); vi.stubEnv('EVIDENCE_GC_INTERVAL_MS', '0'); vi.stubEnv('EVIDENCE_ARTIFACT_RETENTION_DAYS', '1');
    const fake = createFirestoreFake(); firestoreHolder.current = fake;
    const store = await import('../lib/store');
    let db = await store.readDB();
    db.matches = [{ id: 'm1' }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, screenshotEvidence: evidence('a') }];
    await store.saveDB(db);
    const metas = () => [...fake.collections.get('tracker_v2_evidence')!.values()].filter((doc: any) => doc.encoding === 'gzip-base64');
    expect(metas()).toHaveLength(1);
    db = await store.readDB(); db.rounds[0].screenshotEvidence = evidence('b'); await store.saveDB(db);
    for (let index = 0; index < 4; index += 1) { db = await store.readDB(); db.settings.season = `S${index}`; await store.saveDB(db); }
    const committed = fake.collections.get('tracker_v2_committed')!;
    expect(committed.size).toBe(4); // the active revision plus three inactive ones
    const revisionIds = new Set([...fake.collections.get('tracker_v2_revisions')!.values()].map((doc: any) => doc.revisionId));
    expect([...revisionIds].every(id => committed.has(id) || !committed.size)).toBe(true);
    const orphan = metas().find((doc: any) => Number.isFinite(doc.orphanedAt));
    expect(orphan).toBeTruthy();
    fake.collections.get('tracker_v2_evidence')!.set(orphan.sha256, { ...orphan, orphanedAt: Date.now() - 2 * DAY });
    db = await store.readDB(); db.settings.season = 'final'; await store.saveDB(db);
    expect(metas().map((doc: any) => doc.sha256)).not.toContain(orphan.sha256);
    expect([...fake.collections.get('tracker_v2_evidence')!.keys()].some(id => id.startsWith(`${orphan.sha256}_`))).toBe(false);
    expect((await store.readDB()).rounds[0].screenshotEvidence.pixels).toBe('b'.repeat(20_000));
  });
});
