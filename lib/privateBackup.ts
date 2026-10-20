import crypto from 'crypto';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { DB_PATH, hydrateFromEvidenceVault, missingEvidenceArtifacts, readDB, readDBIndex, replaceDB } from './store';
import { STORAGE_SCHEMA_VERSION, validateTrackerState } from './storageSchema';
import { assertSeasonArchivesStorageSize } from './roster';

export const PRIVATE_BACKUP_FORMAT = 'moetracker-private-backup/v1';

function sha256(value: string | Buffer) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function sha256File(file: string) {
  const hash = crypto.createHash('sha256');
  await pipeline(createReadStream(file), new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(); } }));
  return hash.digest('hex');
}

function backupRoot() { return path.resolve(process.env.PRIVATE_BACKUP_DIR || path.join(path.dirname(DB_PATH), 'private-backups')); }
function replayRoot() { return path.resolve(process.env.REPLAY_STORAGE_DIR || path.join(path.dirname(DB_PATH), 'private-replays')); }

async function replayInventory(state: any) {
  const records = Object.values(state.replayIntake?.blobs || {}) as any[];
  const inventory = [];
  for (const record of records.sort((a, b) => String(a.sha256).localeCompare(String(b.sha256)))) {
    const hash = String(record.sha256 || '');
    const byteRequirement = record.ingestionMode === 'local-evidence' ? 'none-evidence-only'
      : record.ingestionMode === 'coach-raw' && record.rawObject?.status === 'deleted' ? 'none-intentionally-deleted'
        : record.ingestionMode === 'coach-raw' ? 'external-active-raw' : 'local-required';
    if (!/^[a-f0-9]{64}$/.test(hash)) { inventory.push({ sha256: hash, metadataSize: Number(record.size || 0), byteRequirement, present: false, storedSize: null, checksumVerified: false, metadataValid: false }); continue; }
    const file = path.join(replayRoot(), hash.slice(0, 2), `${hash}.vrf`);
    const stat = await fs.stat(file).catch(() => null);
    let actualSha256: string | null = null;
    if (stat?.isFile()) actualSha256 = await sha256File(file);
    inventory.push({ sha256: hash, metadataSize: Number(record.size || 0), byteRequirement, present: !!stat?.isFile(), storedSize: stat?.size ?? null, checksumVerified: actualSha256 === hash, metadataValid: true });
  }
  return inventory;
}

const ENCRYPTED_STATE_FORMAT = 'moetracker-backup-aesgcm/v1';

/** Key from the desktop's OS-protected credential store, when configured. */
function backupKey(): Buffer | null {
  const material = process.env.PRIVATE_BACKUP_KEY;
  return material && material.length >= 16 ? crypto.createHash('sha256').update(`moetracker-backup:${material}`).digest() : null;
}

function encryptState(plaintext: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(ENCRYPTED_STATE_FORMAT));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({ format: ENCRYPTED_STATE_FORMAT, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
}

function decryptState(envelopeText: string, key: Buffer | null) {
  if (!key) throw Object.assign(new Error('This recovery backup is encrypted and this device has no backup key.'), { status: 409 });
  const envelope = JSON.parse(envelopeText);
  if (envelope?.format !== ENCRYPTED_STATE_FORMAT) throw Object.assign(new Error('Encrypted backup format is unsupported.'), { status: 400 });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(envelope.iv), 'base64'));
    decipher.setAAD(Buffer.from(ENCRYPTED_STATE_FORMAT));
    decipher.setAuthTag(Buffer.from(String(envelope.tag), 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(String(envelope.ciphertext), 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error('Encrypted backup could not be decrypted with this device key.'), { status: 422 });
  }
}

const isAutomaticReason = (reason: unknown) => /^(scheduled|desktop-daily)/.test(String(reason || ''));

/** Keep the newest N automatic backups; never touch pre-restore/pre-import safety copies. */
async function pruneAutomaticBackups(keep: number) {
  if (!Number.isInteger(keep) || keep < 1) return;
  const entries = await fs.readdir(backupRoot(), { withFileTypes: true }).catch(() => []);
  const automatic: Array<{ dir: string; createdAt: number }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(backupRoot(), entry.name);
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      if (manifest?.format === PRIVATE_BACKUP_FORMAT && isAutomaticReason(manifest.reason)) automatic.push({ dir, createdAt: Date.parse(manifest.createdAt) || 0 });
    } catch { /* unrelated or incomplete folder */ }
  }
  automatic.sort((a, b) => b.createdAt - a.createdAt);
  for (const stale of automatic.slice(keep)) await fs.rm(stale.dir, { recursive: true, force: true });
}

async function atomicWrite(file: string, contents: string) {
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(contents, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
}

export async function createPrivateBackup(options: { reason?: string; directory?: string; state?: any } = {}) {
  const state = options.state ?? await readDB(); validateTrackerState(state);
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, '-')}-${crypto.randomBytes(5).toString('hex')}`;
  const directory = path.resolve(options.directory || path.join(backupRoot(), id));
  if (!directory.startsWith(`${backupRoot()}${path.sep}`) && !options.directory) throw new Error('Backup path escaped its private root.');
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { recursive: false, mode: 0o700 });
  // Integration secrets live in the OS credential store on desktop; never copy
  // them into recovery files. Restore keeps the device's current secrets.
  const stateText = JSON.stringify({ ...state, secrets: {} });
  const key = backupKey();
  const stateFile = key ? 'state.json.enc' : 'state.json';
  await atomicWrite(path.join(directory, stateFile), key ? encryptState(stateText, key) : stateText);
  const inventory = await replayInventory(state);
  const manifest = {
    format: PRIVATE_BACKUP_FORMAT,
    id,
    createdAt,
    reason: options.reason || 'scheduled-private-recovery',
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    completeReplacement: true,
    files: [{ path: stateFile, bytes: Buffer.byteLength(stateText), sha256: sha256(stateText), ...(key ? { encrypted: ENCRYPTED_STATE_FORMAT } : {}) }],
    replayBlobs: { embedded: false, inventory },
  };
  const manifestText = JSON.stringify(manifest, null, 2);
  await atomicWrite(path.join(directory, 'manifest.json'), manifestText);
  if (isAutomaticReason(manifest.reason)) await pruneAutomaticBackups(Number(process.env.PRIVATE_BACKUP_KEEP || 0)).catch(() => {});
  return { id, directory, manifest };
}

export async function validatePrivateBackup(directory: string) {
  const root = path.resolve(directory);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest?.format !== PRIVATE_BACKUP_FORMAT || manifest?.completeReplacement !== true || !Array.isArray(manifest.files) || manifest.files.length !== 1) throw Object.assign(new Error('Private backup manifest is invalid or unsupported.'), { status: 400 });
  if (Number(manifest.storageSchemaVersion) > STORAGE_SCHEMA_VERSION) throw Object.assign(new Error('Private backup uses a newer storage schema.'), { status: 409 });
  const stateEntry = manifest.files[0];
  if ((stateEntry.path !== 'state.json' && stateEntry.path !== 'state.json.enc') || !/^[a-f0-9]{64}$/.test(String(stateEntry.sha256))) throw Object.assign(new Error('Private backup state entry is invalid.'), { status: 400 });
  const storedText = await fs.readFile(path.join(root, stateEntry.path), 'utf8');
  const stateText = stateEntry.path === 'state.json.enc' ? decryptState(storedText, backupKey()) : storedText;
  if (Buffer.byteLength(stateText) !== Number(stateEntry.bytes) || sha256(stateText) !== stateEntry.sha256) throw Object.assign(new Error('Private backup checksum validation failed.'), { status: 422 });
  const state = JSON.parse(stateText); assertSeasonArchivesStorageSize(state.seasonArchives || []); validateTrackerState(state, { jsonFile: true });
  if (!manifest.replayBlobs || manifest.replayBlobs.embedded !== false || !Array.isArray(manifest.replayBlobs.inventory)) throw Object.assign(new Error('Private backup replay inventory metadata is invalid.'), { status: 400 });
  const expectedHashes = Object.keys(state.replayIntake?.blobs || {}).sort();
  const manifestHashes = manifest.replayBlobs.inventory.map((item: any) => String(item?.sha256 || '')).sort();
  if (expectedHashes.length !== manifestHashes.length || expectedHashes.some((hash, index) => hash !== manifestHashes[index])) throw Object.assign(new Error('Private backup replay inventory does not match state metadata.'), { status: 422 });
  const currentInventory = await replayInventory(state);
  const manifestRequirements = new Map(manifest.replayBlobs.inventory.map((item: any) => [String(item?.sha256 || ''), item?.byteRequirement ? String(item.byteRequirement) : null]));
  if (currentInventory.some(item => manifestRequirements.get(item.sha256) && manifestRequirements.get(item.sha256) !== item.byteRequirement)) throw Object.assign(new Error('Private backup replay byte requirements do not match state metadata.'), { status: 422 });
  const missing = currentInventory.filter(item => item.byteRequirement === 'local-required' && !item.present).map(item => item.sha256);
  const corrupt = currentInventory.filter(item => item.byteRequirement === 'local-required' && item.present && (item.storedSize !== item.metadataSize || !item.checksumVerified)).map(item => item.sha256);
  const externalUnverified = currentInventory.filter(item => item.byteRequirement === 'external-active-raw').map(item => item.sha256);
  const intentionallyOmitted = currentInventory.filter(item => item.byteRequirement.startsWith('none-')).map(item => item.sha256);
  const invalidMetadata = currentInventory.filter(item => !item.metadataValid).map(item => item.sha256);
  const blobStatus = { complete: missing.length === 0 && corrupt.length === 0 && externalUnverified.length === 0 && invalidMetadata.length === 0, missing, corrupt, externalUnverified, intentionallyOmitted, invalidMetadata, checked: currentInventory.length };
  // An index-only backup carries artifact refs instead of evidence; it can be
  // restored only while the active vault still holds every one of them.
  const missingArtifacts = await missingEvidenceArtifacts(state);
  const evidenceStatus = { complete: missingArtifacts.length === 0, missing: missingArtifacts };
  return { manifest, state, metadataValid: true, blobStatus, evidenceStatus };
}

export async function restorePrivateBackup(directory: string, options: { dryRun?: boolean } = {}) {
  let validated: Awaited<ReturnType<typeof validatePrivateBackup>>;
  try { validated = await validatePrivateBackup(directory); }
  catch (error: any) {
    if (options.dryRun) return { dryRun: true, metadataValid: false, blobInventoryComplete: null, readyForRestore: false, blobStatus: null, backupId: null, preRestoreBackupId: null, metadataError: error?.message || 'Private backup metadata is invalid.' };
    throw error;
  }
  if (options.dryRun) return { dryRun: true, metadataValid: validated.metadataValid, blobInventoryComplete: validated.blobStatus.complete, readyForRestore: validated.metadataValid && validated.blobStatus.complete && validated.evidenceStatus.complete, blobStatus: validated.blobStatus, evidenceStatus: validated.evidenceStatus, backupId: validated.manifest.id, preRestoreBackupId: null };
  if (!validated.blobStatus.complete) throw Object.assign(new Error('Private backup metadata is valid, but its replay blob inventory is missing or corrupt.'), { status: 409, blobStatus: validated.blobStatus });
  if (!validated.evidenceStatus.complete) throw Object.assign(new Error(`Private backup references evidence artifacts that are not in the evidence vault: ${validated.evidenceStatus.missing.join(', ')}`), { status: 409, evidenceStatus: validated.evidenceStatus });
  await hydrateFromEvidenceVault(validated.state);
  // Restore is the recovery path for a workspace whose evidence is damaged, so
  // it must not depend on the current state hydrating. When an artifact is
  // missing or corrupt, the pre-restore snapshot keeps the stored index as-is.
  let current: any; let preRestoreScope: 'complete' | 'index-only' = 'complete';
  try { current = await readDB(); }
  catch (error: any) {
    if (!/Evidence artifact/.test(String(error?.message || ''))) throw error;
    current = await readDBIndex(); preRestoreScope = 'index-only';
  }
  const before = await createPrivateBackup({ reason: `pre-restore${preRestoreScope === 'index-only' ? '-index-only' : ''}:${validated.manifest.id}`, state: current });
  await replaceDB({ ...validated.state, secrets: { ...(validated.state.secrets || {}), ...(current.secrets || {}) } });
  return { dryRun: false, restored: true, backupId: validated.manifest.id, preRestoreBackupId: before.id, preRestoreScope, completeReplacement: true };
}

export async function reconcileReplayBlobInventory() {
  const state = await readDB(); const inventory = await replayInventory(state);
  return {
    checked: inventory.length,
    healthy: inventory.filter(item => item.byteRequirement.startsWith('none-') || (item.byteRequirement === 'local-required' && item.present && item.storedSize === item.metadataSize && item.checksumVerified)).length,
    missing: inventory.filter(item => item.byteRequirement === 'local-required' && !item.present).map(item => item.sha256),
    corrupt: inventory.filter(item => item.byteRequirement === 'local-required' && item.present && (item.storedSize !== item.metadataSize || !item.checksumVerified)).map(item => item.sha256),
    externalUnverified: inventory.filter(item => item.byteRequirement === 'external-active-raw').map(item => item.sha256),
    intentionallyOmitted: inventory.filter(item => item.byteRequirement.startsWith('none-')).map(item => item.sha256),
  };
}
