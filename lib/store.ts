import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createSeed } from './seed';
import { assertSeasonArchivesStorageSize } from './roster';
import { ensureWorkspaceIdentity } from './evidenceReference';
import { ensureStorageSchema, migrateHydratedEvidence, validateTrackerState } from './storageSchema';
import { artifactRetentionMs, evidenceArtifactReferences, externalizeEvidenceArtifacts, hydrateEvidenceArtifacts, planArtifactCollection, type EvidenceArtifact } from './evidenceArtifacts';

// Runtime state never defaults to the repository's historical/demo db.json.
// Existing deployments keep their explicit DB_PATH; a fresh local install gets
// an empty structural seed under the private runtime data directory.
export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');
export const EVIDENCE_ARTIFACT_DIR = process.env.EVIDENCE_ARTIFACT_DIR || `${DB_PATH}.evidence`;
// The Google Cloud Firestore backend was removed. A deployment that still asks
// for it must stop loudly rather than quietly start an empty local workspace.
if (process.env.USE_FIRESTORE === 'true') throw new Error('USE_FIRESTORE is no longer supported: the Firestore backend was removed. Use the local workspace or Cloudflare D1.');
/** Remote artifact collection reads every retained revision, so it runs at most this often per process. */
const remoteGcIntervalMs = () => Math.max(0, Number(process.env.EVIDENCE_GC_INTERVAL_MS ?? 10 * 60 * 1000));
let lastRemoteGcAt = -Infinity;
const remoteGcDue = (now = Date.now()) => { if (now - lastRemoteGcAt < remoteGcIntervalMs()) return false; lastRemoteGcAt = now; return true; };
const VERSION = Symbol('tracker-version');
let d1: any = null;
const LOGIN_THROTTLE_MAX_FAILS = 5;
const LOGIN_THROTTLE_LOCK_MS = 10 * 60 * 1000;
let loginThrottleQueue: Promise<void> = Promise.resolve();

/** Cloudflare Worker entrypoint injects its D1 binding before the first request. */
export function configureD1Store(binding: any) { d1 = binding; }

async function ensureD1LoginThrottleTable() {
  await d1.exec('CREATE TABLE IF NOT EXISTS login_throttle (key_hash TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
}

function loginThrottlePath() { return `${DB_PATH}.login-throttle.json`; }
function loginThrottleHash(key: string) { return crypto.createHash('sha256').update(key).digest('hex'); }

export async function loginThrottleRemaining(key: string, now = Date.now()) {
  const keyHash = loginThrottleHash(key);
  if (d1) { await ensureD1LoginThrottleTable(); const row: any = await d1.prepare('SELECT locked_until FROM login_throttle WHERE key_hash = ?').bind(keyHash).first(); return row?.locked_until > now ? Math.ceil((row.locked_until - now) / 1000) : 0; }
  try { const state = JSON.parse(await fs.readFile(loginThrottlePath(), 'utf8')); const lockedUntil = Number(state[keyHash]?.lockedUntil || 0); return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0; } catch (error: any) { if (error?.code !== 'ENOENT') throw error; return 0; }
}

export async function recordLoginThrottleFailure(key: string, now = Date.now()) {
  const keyHash = loginThrottleHash(key);
  if (d1) {
    await ensureD1LoginThrottleTable();
    const lockUntil = now + LOGIN_THROTTLE_LOCK_MS;
    await d1.prepare(`INSERT INTO login_throttle (key_hash, fails, locked_until, updated_at) VALUES (?, 1, 0, ?)
      ON CONFLICT(key_hash) DO UPDATE SET
        fails = CASE WHEN login_throttle.locked_until > ? THEN login_throttle.fails WHEN login_throttle.fails + 1 >= ? THEN 0 ELSE login_throttle.fails + 1 END,
        locked_until = CASE WHEN login_throttle.locked_until > ? THEN login_throttle.locked_until WHEN login_throttle.fails + 1 >= ? THEN ? ELSE 0 END,
        updated_at = excluded.updated_at`).bind(keyHash, now, now, LOGIN_THROTTLE_MAX_FAILS, now, LOGIN_THROTTLE_MAX_FAILS, lockUntil).run();
    return;
  }
  const operation = loginThrottleQueue.then(async () => { let state: any = {}; try { state = JSON.parse(await fs.readFile(loginThrottlePath(), 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; } const nextFails = Number(state[keyHash]?.fails || 0) + 1; const lock = nextFails >= LOGIN_THROTTLE_MAX_FAILS ? now + LOGIN_THROTTLE_LOCK_MS : 0; state[keyHash] = { fails: lock ? 0 : nextFails, lockedUntil: lock, updatedAt: now }; for (const [id, record] of Object.entries(state) as any) if (Number(record.updatedAt || 0) < now - 24 * 60 * 60 * 1000) delete state[id]; await fs.mkdir(path.dirname(loginThrottlePath()), { recursive: true }); await fs.writeFile(loginThrottlePath(), JSON.stringify(state), { encoding: 'utf8', mode: 0o600 }); }); loginThrottleQueue = operation.catch(() => undefined); await operation;
}

export async function clearLoginThrottle(key: string) {
  const keyHash = loginThrottleHash(key);
  if (d1) { await ensureD1LoginThrottleTable(); await d1.prepare('DELETE FROM login_throttle WHERE key_hash = ?').bind(keyHash).run(); return; }
  const operation = loginThrottleQueue.then(async () => { let state: any = {}; try { state = JSON.parse(await fs.readFile(loginThrottlePath(), 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; return; } delete state[keyHash]; await fs.writeFile(loginThrottlePath(), JSON.stringify(state), { encoding: 'utf8', mode: 0o600 }); }); loginThrottleQueue = operation.catch(() => undefined); await operation;
}

function removeLegacySecrets(data: any) {
  delete data.secretValues;
  if (data.settings) {
    delete data.settings.discordWebhook;
    delete data.settings.gridApiKey;
    delete data.settings.henrikApiKey;
  }
}

function attachVersion<T extends Record<string, any>>(data: T, version: string | number): T {
  Object.defineProperty(data, VERSION, { value: version, enumerable: false, configurable: true });
  return data;
}

const storedSchemaVersion = (state: any) => Number(state?._storage?.schemaVersion || 1);

function hashText(text: string) { return crypto.createHash('sha256').update(text).digest('hex'); }

async function syncDirectory(dir: string) {
  // Directory fsync makes the rename itself durable. Windows cannot open a
  // directory handle for sync, so there the file-level fsync is the guarantee.
  if (process.platform === 'win32') return;
  const handle = await fs.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

const verifiedLocalArtifacts = new Set<string>();
async function localArtifactIsIntact(target: string, sha256: string) {
  try {
    // The cache only skips re-hashing; a file deleted outside this process
    // must still be rewritten, so existence is always checked.
    if (verifiedLocalArtifacts.has(target)) { await fs.stat(target); return true; } const intact = hashText(gunzipSync(await fs.readFile(target)).toString('utf8')) === sha256; if (intact) verifiedLocalArtifacts.add(target); return intact; }
  catch (error: any) { verifiedLocalArtifacts.delete(target); if (error?.code === 'ENOENT') return null; return false; }
}

/** Artifacts are durable on disk before the index that references them is activated. */
async function storeLocalArtifacts(artifacts: EvidenceArtifact[]) {
  if (!artifacts.length) return;
  await fs.mkdir(EVIDENCE_ARTIFACT_DIR, { recursive: true });
  let wrote = false;
  for (const item of artifacts) {
    const target = path.join(EVIDENCE_ARTIFACT_DIR, `${item.sha256}.json.gz`);
    // An existing file is reused only when it still decodes to its own hash; a
    // file truncated by an earlier power loss is rewritten instead of trusted.
    const intact = await localArtifactIsIntact(target, item.sha256);
    if (intact) continue;
    const temp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(gzipSync(Buffer.from(item.json, 'utf8'))); await handle.sync(); } finally { await handle.close(); }
    if (intact === false) await fs.unlink(target).catch(() => {});
    try { await fs.rename(temp, target); } catch (error: any) { if (error?.code !== 'EEXIST') throw error; await fs.unlink(temp).catch(() => {}); }
    verifiedLocalArtifacts.add(target); wrote = true;
  }
  if (wrote) await syncDirectory(EVIDENCE_ARTIFACT_DIR);
}

async function loadLocalArtifact(sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Evidence artifact reference is invalid.');
  try { return gunzipSync(await fs.readFile(path.join(EVIDENCE_ARTIFACT_DIR, `${sha256}.json.gz`))).toString('utf8'); }
  catch (error: any) { throw new Error(`Evidence artifact ${sha256} could not be loaded: ${error?.message || error}`); }
}

const ORPHAN_LEDGER = '.orphaned-since.json';

/** Retention counts from when an artifact stopped being referenced, not from
 * when it was written, so a long-lived artifact released today keeps the full
 * recovery window. */
async function pruneLocalArtifacts(active: ReadonlySet<string>, now = Date.now()) {
  const ledgerPath = path.join(EVIDENCE_ARTIFACT_DIR, ORPHAN_LEDGER);
  let ledger: Record<string, number> = {};
  try { const parsed = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ledger = parsed; } catch { /* first run or unreadable: start a fresh window */ }
  const stored = (await fs.readdir(EVIDENCE_ARTIFACT_DIR, { withFileTypes: true }).catch(() => []))
    .map(entry => entry.isFile() ? /^([a-f0-9]{64})\.json\.gz$/.exec(entry.name)?.[1] : undefined).filter((sha): sha is string => !!sha);
  const plan = planArtifactCollection(stored, active, ledger, now, artifactRetentionMs());
  for (const sha256 of plan.remove) { const target = path.join(EVIDENCE_ARTIFACT_DIR, `${sha256}.json.gz`); verifiedLocalArtifacts.delete(target); await fs.unlink(target).catch(() => {}); }
  const temp = `${ledgerPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(plan.orphanedSince), { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temp, ledgerPath);
}

async function writeJsonFile(data: any, expected: string | undefined, allowCreate: boolean) {
  ensureWorkspaceIdentity(data);
  assertSeasonArchivesStorageSize(data.seasonArchives || []);
  validateTrackerState(data, { jsonFile: true });
  let currentText: string | null = null;
  try { currentText = await fs.readFile(DB_PATH, 'utf8'); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  if (currentText === null && !allowCreate) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  if (currentText !== null && expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  if (currentText !== null && hashText(currentText) !== expected) throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const tempPath = `${DB_PATH}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const planned = externalizeEvidenceArtifacts(data);
  await storeLocalArtifacts(planned.artifacts);
  const serialized = JSON.stringify(planned.state, null, 2);
  const handle = await fs.open(tempPath, 'wx', 0o600);
  try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tempPath, DB_PATH);
  await syncDirectory(path.dirname(DB_PATH)).catch(() => {});
  await pruneLocalArtifacts(evidenceArtifactReferences(planned.state)).catch(() => {});
  return hashText(serialized);
}

export async function readDB() { return readStoredState(true); }

/**
 * The active index exactly as stored, with artifact references left in place.
 * Recovery uses it when hydration fails closed (a missing or corrupt artifact),
 * so a restore can still snapshot and replace a damaged workspace.
 */
export async function readDBIndex() { return readStoredState(false); }

function activeArtifactLoader() { return d1 ? loadD1Artifact : loadLocalArtifact; }

/** Artifact refs in `state` that the active evidence vault cannot serve intact. */
export async function missingEvidenceArtifacts(state: any) {
  const load = activeArtifactLoader(); const missing: string[] = [];
  for (const sha256 of evidenceArtifactReferences(state)) {
    try { if (hashText(await load(sha256)) !== sha256) missing.push(sha256); } catch { missing.push(sha256); }
  }
  return missing.sort();
}

/** Resolves an index-only state (for example an index-only backup) against the
 * active evidence vault, failing closed with the first unavailable artifact. */
export async function hydrateFromEvidenceVault(state: any) {
  return hydrateEvidenceArtifacts(state, activeArtifactLoader());
}

async function readStoredState(hydrate: boolean) {
  if (d1) return readDBD1(hydrate);
  let storedText: string;
  try { storedText = await fs.readFile(DB_PATH, 'utf8'); }
  catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const seed = ensureStorageSchema(createSeed());
    const version = await writeJsonFile(seed, undefined, true);
    return attachVersion(seed, version);
  }
  const data = JSON.parse(storedText); const declared = storedSchemaVersion(data); ensureStorageSchema(data);
  if (hydrate) { await hydrateEvidenceArtifacts(data, loadLocalArtifact); migrateHydratedEvidence(data, declared); }
  validateTrackerState(data, { jsonFile: true });
  return attachVersion(data, hashText(storedText));
}

let writeQueue: Promise<void> = Promise.resolve();

export async function saveDB(data: any) {
  const run = writeQueue.then(async () => {
    const expected = data[VERSION];
    if (expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
    removeLegacySecrets(data); ensureStorageSchema(data);
    if (d1) await activateD1Revision(data, Number(expected), 'ordinary');
    else await writeJsonFile(data, String(expected), false);
  });
  writeQueue = run.catch(() => {});
  return run;
}

/** Complete replacement for validated recovery/migration paths only. */
export async function replaceDB(data: any) {
  const replacement = structuredClone(data); removeLegacySecrets(replacement); ensureStorageSchema(replacement); validateTrackerState(replacement, { jsonFile: !d1 });
  const run = writeQueue.then(async () => {
    if (d1) await activateD1Revision(replacement, undefined, 'replace');
    else {
      let current: string | undefined;
      try { current = hashText(await fs.readFile(DB_PATH, 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      await writeJsonFile(replacement, current, current === undefined);
    }
  });
  writeQueue = run.catch(() => {});
  return run;
}

export const storeInternals = { VERSION, writeJsonFile };

const D1_CHUNK_CHARS = 200_000;
const D1_MAX_CHUNKS = 32;
const D1_ARTIFACT_BATCH = 50;
let d1TablesReady = false;

async function ensureD1Tables() {
  if (d1TablesReady) return;
  await d1.exec(`CREATE TABLE IF NOT EXISTS tracker_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, active_revision TEXT NOT NULL, chunk_count INTEGER NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tracker_revisions (revision_id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (revision_id, ordinal)); CREATE INDEX IF NOT EXISTS tracker_revisions_created ON tracker_revisions(created_at); CREATE TABLE IF NOT EXISTS tracker_committed_revisions (revision_id TEXT PRIMARY KEY, committed_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tracker_evidence_artifacts (sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tracker_artifact_orphans (sha256 TEXT PRIMARY KEY, orphaned_at INTEGER NOT NULL);`);
  d1TablesReady = true;
}

function d1Chunks(data: any, stored = false) {
  removeLegacySecrets(data); ensureStorageSchema(data); ensureWorkspaceIdentity(data); assertSeasonArchivesStorageSize(data.seasonArchives || []); if (!stored) validateTrackerState(data);
  const serialized = JSON.stringify(data);
  const chunks: string[] = [];
  for (let offset = 0; offset < serialized.length;) {
    let end = Math.min(serialized.length, offset + D1_CHUNK_CHARS);
    if (end < serialized.length && serialized.charCodeAt(end - 1) >= 0xD800 && serialized.charCodeAt(end - 1) <= 0xDBFF
      && serialized.charCodeAt(end) >= 0xDC00 && serialized.charCodeAt(end) <= 0xDFFF) end -= 1;
    chunks.push(serialized.slice(offset, end));
    offset = end;
  }
  if (chunks.length > D1_MAX_CHUNKS) throw Object.assign(new Error('Active data exceeds the Cloudflare Free safety budget. Archive older matches before saving.'), { status: 413 });
  return { chunks, sha256: hashText(serialized) };
}

async function readDBD1(hydrate = true) {
  await ensureD1Tables();
  let meta: any = await d1.prepare('SELECT version, active_revision, chunk_count, sha256 FROM tracker_meta WHERE id = 1').first();
  if (!meta) {
    const seed = ensureStorageSchema(createSeed());
    await activateD1Revision(seed, undefined, 'initialize');
    meta = await d1.prepare('SELECT version, active_revision, chunk_count, sha256 FROM tracker_meta WHERE id = 1').first();
  }
  const result = await d1.prepare(`SELECT m.version, m.active_revision, m.chunk_count, m.sha256, r.ordinal, r.payload
    FROM tracker_meta m JOIN tracker_revisions r ON r.revision_id = m.active_revision
    WHERE m.id = 1 ORDER BY r.ordinal`).all();
  const rows = result.results || [];
  if (!rows.length) throw new Error('Active D1 revision is missing.');
  meta = rows[0];
  if (rows.length !== Number(meta.chunk_count)) throw new Error('Active D1 revision is incomplete.');
  const serialized = rows.map((row: any) => row.payload).join('');
  if (hashText(serialized) !== meta.sha256) throw new Error('Active D1 revision failed integrity validation.');
  const state = JSON.parse(serialized); const declared = storedSchemaVersion(state); ensureStorageSchema(state);
  if (hydrate) { await hydrateEvidenceArtifacts(state, loadD1Artifact); migrateHydratedEvidence(state, declared); }
  validateTrackerState(state);
  return attachVersion(state, Number(meta.version));
}

async function loadD1Artifact(sha256: string) {
  const row: any = await d1.prepare('SELECT payload FROM tracker_evidence_artifacts WHERE sha256 = ?').bind(sha256).first();
  if (!row) throw new Error(`Evidence artifact ${sha256} is missing.`);
  return gunzipSync(Buffer.from(String(row.payload), 'base64')).toString('utf8');
}

async function activateD1Revision(data: any, expected: number | undefined, mode: 'ordinary' | 'initialize' | 'replace') {
  if (mode === 'ordinary' && expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  await ensureD1Tables();
  removeLegacySecrets(data); ensureStorageSchema(data); ensureWorkspaceIdentity(data); assertSeasonArchivesStorageSize(data.seasonArchives || []); validateTrackerState(data);
  const planned = externalizeEvidenceArtifacts(data); const now = new Date().toISOString();
  // Batched: one round trip per D1_ARTIFACT_BATCH artifacts instead of one per artifact.
  // Reuse also clears any orphan mark, restarting the retention clock.
  for (let offset = 0; offset < planned.artifacts.length; offset += D1_ARTIFACT_BATCH) {
    await d1.batch(planned.artifacts.slice(offset, offset + D1_ARTIFACT_BATCH).flatMap(item => [
      d1.prepare('INSERT OR IGNORE INTO tracker_evidence_artifacts (sha256, bytes, payload, created_at) VALUES (?, ?, ?, ?)').bind(item.sha256, item.bytes, gzipSync(Buffer.from(item.json, 'utf8')).toString('base64'), now),
      d1.prepare('DELETE FROM tracker_artifact_orphans WHERE sha256 = ?').bind(item.sha256),
    ]));
  }
  const { chunks, sha256 } = d1Chunks(planned.state, true);
  const revisionId = crypto.randomUUID();
  await d1.batch(chunks.map((payload, ordinal) => d1.prepare('INSERT INTO tracker_revisions (revision_id, ordinal, payload, created_at) VALUES (?, ?, ?, ?)').bind(revisionId, ordinal, payload, now)));
  let result: any;
  if (mode === 'initialize') result = await d1.prepare('INSERT OR IGNORE INTO tracker_meta (id, version, active_revision, chunk_count, sha256, updated_at) VALUES (1, 1, ?, ?, ?, ?)').bind(revisionId, chunks.length, sha256, now).run();
  else if (mode === 'replace') result = await d1.prepare('INSERT INTO tracker_meta (id, version, active_revision, chunk_count, sha256, updated_at) VALUES (1, 1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET version = tracker_meta.version + 1, active_revision = excluded.active_revision, chunk_count = excluded.chunk_count, sha256 = excluded.sha256, updated_at = excluded.updated_at').bind(revisionId, chunks.length, sha256, now).run();
  else result = await d1.prepare('UPDATE tracker_meta SET version = version + 1, active_revision = ?, chunk_count = ?, sha256 = ?, updated_at = ? WHERE id = 1 AND version = ?').bind(revisionId, chunks.length, sha256, now, expected).run();
  if (!result?.meta?.changes) {
    await d1.prepare('DELETE FROM tracker_revisions WHERE revision_id = ?').bind(revisionId).run();
    throw Object.assign(new Error('Data changed while this request was being processed. Please retry.'), { status: 409 });
  }
  // A revision becomes cleanup-eligible only after its activation succeeded.
  // Staged/in-flight candidates are deliberately absent from this ledger.
  await d1.prepare('INSERT OR IGNORE INTO tracker_committed_revisions (revision_id, committed_at) VALUES (?, ?)').bind(revisionId, now).run();
  await d1.prepare(`DELETE FROM tracker_revisions WHERE revision_id IN (
    SELECT c.revision_id FROM tracker_committed_revisions c
    WHERE c.revision_id != (SELECT active_revision FROM tracker_meta WHERE id = 1)
    ORDER BY c.committed_at DESC LIMIT -1 OFFSET 3
  )`).run().catch((error: any) => console.warn('[d1] inactive revision cleanup failed:', error?.message || error));
  await d1.prepare('DELETE FROM tracker_committed_revisions WHERE revision_id NOT IN (SELECT DISTINCT revision_id FROM tracker_revisions)').run().catch(() => {});
  if (remoteGcDue()) await collectD1Artifacts().catch((error: any) => console.warn('[d1] evidence cleanup failed:', error?.message || error));
  return Number(expected || 0) + 1;
}

/** Remove artifacts that no stored revision (active, retained or still staging) references. */
async function collectD1Artifacts(now = Date.now()) {
  const rows: any[] = (await d1.prepare('SELECT revision_id, ordinal, payload FROM tracker_revisions ORDER BY revision_id, ordinal').all()).results || [];
  const revisions = new Map<string, string[]>();
  for (const row of rows) revisions.set(row.revision_id, [...(revisions.get(row.revision_id) || []), String(row.payload)]);
  const referenced = new Set<string>();
  for (const chunks of revisions.values()) {
    // A revision that is still being written cannot be parsed yet; skip collection rather than guess.
    let state: any; try { state = JSON.parse(chunks.join('')); } catch { return; }
    for (const sha256 of evidenceArtifactReferences(state)) referenced.add(sha256);
  }
  const stored = ((await d1.prepare('SELECT sha256 FROM tracker_evidence_artifacts').all()).results || []).map((row: any) => String(row.sha256));
  const ledger = Object.fromEntries(((await d1.prepare('SELECT sha256, orphaned_at FROM tracker_artifact_orphans').all()).results || []).map((row: any) => [String(row.sha256), Number(row.orphaned_at)]));
  const plan = planArtifactCollection(stored, referenced, ledger, now, artifactRetentionMs());
  const statements = [
    ...plan.remove.flatMap(sha256 => [
      // Guarded by the ledger row so a writer that just reused the artifact (and cleared its row) keeps it.
      d1.prepare('DELETE FROM tracker_evidence_artifacts WHERE sha256 = ? AND EXISTS (SELECT 1 FROM tracker_artifact_orphans WHERE sha256 = ? AND orphaned_at = ?)').bind(sha256, sha256, ledger[sha256]),
      d1.prepare('DELETE FROM tracker_artifact_orphans WHERE sha256 = ?').bind(sha256),
    ]),
    ...Object.entries(plan.orphanedSince).filter(([sha256]) => ledger[sha256] === undefined).map(([sha256, since]) => d1.prepare('INSERT OR IGNORE INTO tracker_artifact_orphans (sha256, orphaned_at) VALUES (?, ?)').bind(sha256, since)),
    ...Object.keys(ledger).filter(sha256 => referenced.has(sha256)).map(sha256 => d1.prepare('DELETE FROM tracker_artifact_orphans WHERE sha256 = ?').bind(sha256)),
  ];
  for (let offset = 0; offset < statements.length; offset += D1_ARTIFACT_BATCH * 2) await d1.batch(statements.slice(offset, offset + D1_ARTIFACT_BATCH * 2));
}
