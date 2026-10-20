import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createSeed } from './seed';
import { assertSeasonArchivesStorageSize } from './roster';
import { ensureWorkspaceIdentity } from './evidenceReference';
import { decodeFirestoreDocuments, encodeFirestoreDocuments, ensureStorageSchema, migrateHydratedEvidence, planFirestoreWriteBatches, planRevisionActivation, STORAGE_SCHEMA_VERSION, validateTrackerState } from './storageSchema';
import { evidenceArtifactReferences, externalizeEvidenceArtifacts, hydrateEvidenceArtifacts, type EvidenceArtifact } from './evidenceArtifacts';

// Runtime state never defaults to the repository's historical/demo db.json.
// Existing deployments keep their explicit DB_PATH; a fresh local install gets
// an empty structural seed under the private runtime data directory.
export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'db.json');
export const EVIDENCE_ARTIFACT_DIR = process.env.EVIDENCE_ARTIFACT_DIR || `${DB_PATH}.evidence`;
const USE_FIRESTORE = process.env.USE_FIRESTORE === 'true';
let firestore: any = null;
async function getFirestore() {
  if (!USE_FIRESTORE) return null;
  if (!firestore) {
    const packageName = '@google-cloud/firestore';
    const module = await import(packageName);
    firestore = new module.Firestore({ ignoreUndefinedProperties: true });
  }
  return firestore;
}
const LEGACY_COLLECTION = 'tracker';
const META_COLLECTION = 'tracker_v2';
const REVISION_COLLECTION = 'tracker_v2_revisions';
const ARTIFACT_COLLECTION = 'tracker_v2_evidence';
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
  if (USE_FIRESTORE) { const store = await getFirestore(); const snapshot = await store.collection('tracker_login_throttle').doc(keyHash).get(); const lockedUntil = Number(snapshot.data()?.lockedUntil || 0); return lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0; }
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
  if (USE_FIRESTORE) { const store = await getFirestore(); const ref = store.collection('tracker_login_throttle').doc(keyHash); await store.runTransaction(async (transaction: any) => { const snapshot = await transaction.get(ref); const record = snapshot.data() || {}; const nextFails = Number(record.fails || 0) + 1; const lock = nextFails >= LOGIN_THROTTLE_MAX_FAILS ? now + LOGIN_THROTTLE_LOCK_MS : 0; transaction.set(ref, { fails: lock ? 0 : nextFails, lockedUntil: lock, updatedAt: now }); }); return; }
  const operation = loginThrottleQueue.then(async () => { let state: any = {}; try { state = JSON.parse(await fs.readFile(loginThrottlePath(), 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; } const nextFails = Number(state[keyHash]?.fails || 0) + 1; const lock = nextFails >= LOGIN_THROTTLE_MAX_FAILS ? now + LOGIN_THROTTLE_LOCK_MS : 0; state[keyHash] = { fails: lock ? 0 : nextFails, lockedUntil: lock, updatedAt: now }; for (const [id, record] of Object.entries(state) as any) if (Number(record.updatedAt || 0) < now - 24 * 60 * 60 * 1000) delete state[id]; await fs.mkdir(path.dirname(loginThrottlePath()), { recursive: true }); await fs.writeFile(loginThrottlePath(), JSON.stringify(state), { encoding: 'utf8', mode: 0o600 }); }); loginThrottleQueue = operation.catch(() => undefined); await operation;
}

export async function clearLoginThrottle(key: string) {
  const keyHash = loginThrottleHash(key);
  if (d1) { await ensureD1LoginThrottleTable(); await d1.prepare('DELETE FROM login_throttle WHERE key_hash = ?').bind(keyHash).run(); return; }
  if (USE_FIRESTORE) { const store = await getFirestore(); await store.collection('tracker_login_throttle').doc(keyHash).delete(); return; }
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
  if (verifiedLocalArtifacts.has(target)) return true;
  try { const intact = hashText(gunzipSync(await fs.readFile(target)).toString('utf8')) === sha256; if (intact) verifiedLocalArtifacts.add(target); return intact; }
  catch (error: any) { if (error?.code === 'ENOENT') return null; return false; }
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
  const days = Math.max(1, Math.min(365, Number(process.env.EVIDENCE_ARTIFACT_RETENTION_DAYS || 30)));
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const ledgerPath = path.join(EVIDENCE_ARTIFACT_DIR, ORPHAN_LEDGER);
  let ledger: Record<string, number> = {};
  try { const parsed = JSON.parse(await fs.readFile(ledgerPath, 'utf8')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ledger = parsed; } catch { /* first run or unreadable: start a fresh window */ }
  const next: Record<string, number> = {};
  for (const entry of await fs.readdir(EVIDENCE_ARTIFACT_DIR, { withFileTypes: true }).catch(() => [])) {
    const match = /^([a-f0-9]{64})\.json\.gz$/.exec(entry.name); if (!entry.isFile() || !match || active.has(match[1])) continue;
    const since = Number.isFinite(ledger[match[1]]) ? ledger[match[1]] : now;
    if (since < cutoff) { const target = path.join(EVIDENCE_ARTIFACT_DIR, entry.name); verifiedLocalArtifacts.delete(target); await fs.unlink(target).catch(() => {}); }
    else next[match[1]] = since;
  }
  const temp = `${ledgerPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
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

async function stageFirestoreRevision(data: any, revisionId: string) {
  const firestore = await getFirestore();
  const planned = externalizeEvidenceArtifacts(data);
  for (const item of planned.artifacts) {
    const compressed = gzipSync(Buffer.from(item.json, 'utf8')).toString('base64');
    const chunks = compressed.match(/[\s\S]{1,600000}/g) || [''];
    const metaRef = firestore!.collection(ARTIFACT_COLLECTION).doc(item.sha256);
    if ((await metaRef.get()).exists) continue;
    const batch = firestore!.batch();
    batch.create(metaRef, { sha256: item.sha256, bytes: item.bytes, chunks: chunks.length, encoding: 'gzip-base64' });
    chunks.forEach((payload, ordinal) => batch.create(firestore!.collection(ARTIFACT_COLLECTION).doc(`${item.sha256}_${ordinal}`), { sha256: item.sha256, ordinal, payload }));
    try { await batch.commit(); }
    catch (error) { if (!(await metaRef.get()).exists) throw error; }
  }
  const encoded = encodeFirestoreDocuments(planned.state);
  for (const documents of planFirestoreWriteBatches(encoded, revisionId)) {
    const batch = firestore!.batch();
    for (const doc of documents) batch.create(firestore!.collection(REVISION_COLLECTION).doc(`${revisionId}_${doc.id}`), { revisionId, ...doc.payload });
    await batch.commit();
  }
  return encoded.length;
}

async function loadFirestoreArtifact(sha256: string) {
  const firestore = await getFirestore(); const meta = await firestore!.collection(ARTIFACT_COLLECTION).doc(sha256).get();
  if (!meta.exists) throw new Error(`Evidence artifact ${sha256} is missing.`);
  const chunks: string[] = [];
  for (let ordinal = 0; ordinal < Number(meta.data()?.chunks || 0); ordinal += 1) {
    const part = await firestore!.collection(ARTIFACT_COLLECTION).doc(`${sha256}_${ordinal}`).get();
    if (!part.exists) throw new Error(`Evidence artifact ${sha256} is incomplete.`);
    chunks.push(String(part.data()?.payload || ''));
  }
  return gunzipSync(Buffer.from(chunks.join(''), 'base64')).toString('utf8');
}

async function deleteFirestoreRevision(revisionId: string) {
  const firestore = await getFirestore();
  const snapshot = await firestore!.collection(REVISION_COLLECTION).where('revisionId', '==', revisionId).get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = firestore!.batch();
    snapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function activateFirestoreRevision(data: any, expected: number | undefined, mode: 'ordinary' | 'initialize' | 'replace') {
  const firestore = await getFirestore();
  removeLegacySecrets(data); ensureStorageSchema(data); ensureWorkspaceIdentity(data); assertSeasonArchivesStorageSize(data.seasonArchives || []); validateTrackerState(data);
  if (mode === 'ordinary' && expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
  const revisionId = crypto.randomUUID();
  const metaRef = firestore!.collection(META_COLLECTION).doc('meta');
  try {
    const documentCount = await stageFirestoreRevision(data, revisionId);
    return await firestore!.runTransaction(async transaction => {
      const snapshot = await transaction.get(metaRef); const current = Number(snapshot.data()?.version || 0);
      const version = planRevisionActivation(snapshot.exists ? current : null, expected, mode);
      transaction.set(metaRef, { schemaVersion: STORAGE_SCHEMA_VERSION, version, activeRevision: revisionId, documentCount, updatedAt: new Date().toISOString() });
      return version;
    });
  } catch (error) {
    await deleteFirestoreRevision(revisionId).catch(() => {});
    throw error;
  }
}

async function readLegacyFirestore() {
  const firestore = await getFirestore();
  const snapshot = await firestore!.collection(LEGACY_COLLECTION).get();
  const docs = snapshot.docs.filter(doc => doc.id !== '_meta');
  if (!docs.length) return null;
  const legacy: any = {};
  docs.forEach(doc => { legacy[doc.id] = doc.data().v; });
  return legacy;
}

async function initializeFirestore() {
  // This is the only legacy migration branch. Ordinary saves can never infer a first boot.
  let initial = await readLegacyFirestore();
  if (!initial && process.env.FIRESTORE_IMPORT_JSON_ON_FIRST_BOOT === 'true') {
    try { initial = JSON.parse(await fs.readFile(DB_PATH, 'utf8')); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  }
  if (!initial) initial = createSeed();
  ensureStorageSchema(initial); assertSeasonArchivesStorageSize(initial.seasonArchives || []); validateTrackerState(initial);
  try { await activateFirestoreRevision(initial, undefined, 'initialize'); }
  catch (error: any) { if (error?.status !== 409) throw error; }
}

async function readDBFirestore() {
  const firestore = await getFirestore();
  const metaRef = firestore!.collection(META_COLLECTION).doc('meta');
  const readMeta = async () => typeof (metaRef as any).get === 'function' ? (metaRef as any).get() : ({ exists: false, data: () => undefined });
  let meta = await readMeta();
  if (!meta.exists) { await initializeFirestore(); meta = await readMeta(); }
  const metadata = meta.data()!;
  if (Number(metadata.schemaVersion) > STORAGE_SCHEMA_VERSION) throw Object.assign(new Error('Firestore schema is newer than this server supports.'), { status: 409 });
  const revisionId = String(metadata.activeRevision || '');
  if (!revisionId) throw new Error('Firestore metadata has no active revision.');
  const snapshot = await firestore!.collection(REVISION_COLLECTION).where('revisionId', '==', revisionId).get();
  if (snapshot.empty || snapshot.size !== Number(metadata.documentCount)) throw new Error('Active Firestore revision is incomplete.');
  const docs = snapshot.docs.map(doc => ({ id: doc.id, payload: doc.data() }));
  const state = decodeFirestoreDocuments(docs);
  await hydrateEvidenceArtifacts(state, loadFirestoreArtifact);
  migrateHydratedEvidence(state, storedSchemaVersion(state));
  const seed = createSeed();
  for (const key of Object.keys(seed)) if (state[key] === undefined) state[key] = (seed as any)[key];
  return attachVersion(state, Number(metadata.version));
}

export async function readDB() {
  if (d1) return readDBD1();
  if (USE_FIRESTORE) return readDBFirestore();
  let storedText: string;
  try { storedText = await fs.readFile(DB_PATH, 'utf8'); }
  catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    const seed = ensureStorageSchema(createSeed());
    const version = await writeJsonFile(seed, undefined, true);
    return attachVersion(seed, version);
  }
  const data = JSON.parse(storedText); const declared = storedSchemaVersion(data); ensureStorageSchema(data); await hydrateEvidenceArtifacts(data, loadLocalArtifact); migrateHydratedEvidence(data, declared); validateTrackerState(data, { jsonFile: true });
  return attachVersion(data, hashText(storedText));
}

let writeQueue: Promise<void> = Promise.resolve();

export async function saveDB(data: any) {
  const run = writeQueue.then(async () => {
    const expected = data[VERSION];
    if (expected === undefined) throw Object.assign(new Error('Database revision is required for ordinary writes.'), { status: 409 });
    removeLegacySecrets(data); ensureStorageSchema(data);
    if (d1) await activateD1Revision(data, Number(expected), 'ordinary');
    else if (USE_FIRESTORE) await activateFirestoreRevision(data, Number(expected), 'ordinary');
    else await writeJsonFile(data, String(expected), false);
  });
  writeQueue = run.catch(() => {});
  return run;
}

/** Complete replacement for validated recovery/migration paths only. */
export async function replaceDB(data: any) {
  const replacement = structuredClone(data); removeLegacySecrets(replacement); ensureStorageSchema(replacement); validateTrackerState(replacement, { jsonFile: !USE_FIRESTORE && !d1 });
  const run = writeQueue.then(async () => {
    if (d1) await activateD1Revision(replacement, undefined, 'replace');
    else if (USE_FIRESTORE) await activateFirestoreRevision(replacement, undefined, 'replace');
    else {
      let current: string | undefined;
      try { current = hashText(await fs.readFile(DB_PATH, 'utf8')); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      await writeJsonFile(replacement, current, current === undefined);
    }
  });
  writeQueue = run.catch(() => {});
  return run;
}

export const storeInternals = { VERSION, writeJsonFile, stageFirestoreRevision, activateFirestoreRevision };

const D1_CHUNK_CHARS = 200_000;
const D1_MAX_CHUNKS = 32;
let d1TablesReady = false;

async function ensureD1Tables() {
  if (d1TablesReady) return;
  await d1.exec(`CREATE TABLE IF NOT EXISTS tracker_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, active_revision TEXT NOT NULL, chunk_count INTEGER NOT NULL, sha256 TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tracker_revisions (revision_id TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (revision_id, ordinal)); CREATE INDEX IF NOT EXISTS tracker_revisions_created ON tracker_revisions(created_at); CREATE TABLE IF NOT EXISTS tracker_committed_revisions (revision_id TEXT PRIMARY KEY, committed_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS tracker_evidence_artifacts (sha256 TEXT PRIMARY KEY, bytes INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);`);
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

async function readDBD1() {
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
  const state = JSON.parse(serialized); const declared = storedSchemaVersion(state); ensureStorageSchema(state); await hydrateEvidenceArtifacts(state, loadD1Artifact); migrateHydratedEvidence(state, declared); validateTrackerState(state);
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
  for (const item of planned.artifacts) await d1.prepare('INSERT OR IGNORE INTO tracker_evidence_artifacts (sha256, bytes, payload, created_at) VALUES (?, ?, ?, ?)').bind(item.sha256, item.bytes, gzipSync(Buffer.from(item.json, 'utf8')).toString('base64'), now).run();
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
  return Number(expected || 0) + 1;
}
