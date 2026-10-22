import crypto from 'crypto';
import { assertWorkspaceIdentityShape } from './evidenceReference';
import { migrateAcceptedMatchAggregates, withCurrentScreenshotMetrics } from './aggregateVersioning';
import { materializeFirstDeathsFromRoundEvidence, materializeRoundOpeningsFromScreenshotEvidence, materializeRoundPlantsFromScreenshotEvidence } from './scrimRoundAnalytics';
import { ensureScheduleCalendars } from './schedule';
import { buildAllPracticeBlockSummaries, migrateLegacyActionChecks } from './coachingWorkflow';
import { repairOrphanMatchReferences, refreshDuplicateQuarantine } from './matchIntegrity';

export const STORAGE_SCHEMA_VERSION = 15;
export const MAX_ENTITY_BYTES = 840 * 1024;
export const MAX_DOCUMENT_BYTES = 900 * 1024;
export const MAX_JSON_DATABASE_BYTES = 64 * 1024 * 1024;
export const STORAGE_CHUNK_BYTES = 480 * 1024;

const GROWTH_ARRAYS = new Set(['matches', 'playerStats', 'vodSubmissions', 'seasonArchives']);
const GROWTH_TREES = new Set(['replayIntake', 'engineAdapters', 'analyticsBuilds']);
const CORE_ARRAYS = [
  'matches', 'playerStats', 'seasonArchives', 'rounds', 'schedule', 'authKeys', 'allowedUsers',
  'goals', 'soloq', 'vetos', 'strats', 'stratRuns', 'rosterPlayers', 'coreMemberships',
  'tryoutBatches', 'vodReviews', 'lineups', 'practiceBlocks', 'tryoutDecisionNotes', 'identityCorrectionBatches',
  'vodSubmissions',
  'attendanceCredits',
  'coachingSignals', 'coachingActions', 'dashboardViews',
  'evidenceFusionResolutions', 'calibratedPlayerRatings', 'removedMatches',
] as const;

export type StorageMetadata = {
  schemaVersion: number;
  migratedAt: string;
  migrationLedger: Array<{ from: number; to: number; at: string }>;
  integrityRepair?: { at: string; removed: Record<string, number> };
  evidenceArtifacts?: { schemaVersion: number; count: number; logicalBytes: number };
};

export type EncodedDocument = {
  id: string;
  payload: Record<string, unknown>;
};

function bytes(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized, 'utf8');
}

const OMIT = Symbol('omit-undefined-json-value');

function normalizeJsonValue(value: unknown): unknown | typeof OMIT {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? OMIT : JSON.parse(serialized);
}

function storageError(message: string, status = 413) {
  return Object.assign(new Error(message), { status });
}

function stableId(parts: unknown[]) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function assertEntity(value: unknown, label: string) {
  const size = bytes(value);
  if (size > MAX_ENTITY_BYTES) {
    throw storageError(`${label} is ${size} bytes and exceeds the conservative ${MAX_ENTITY_BYTES}-byte entity limit.`);
  }
}

export function ensureStorageSchema(input: any, now = new Date().toISOString()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw storageError('Database state must be an object.', 400);
  const declared = Number(input._storage?.schemaVersion || 1);
  if (!Number.isSafeInteger(declared) || declared < 1) throw storageError('Database storage schema is invalid.', 400);
  if (declared > STORAGE_SCHEMA_VERSION) throw storageError(`Database schema ${declared} is newer than this server supports (${STORAGE_SCHEMA_VERSION}).`, 409);
  const ledger = Array.isArray(input._storage?.migrationLedger) ? input._storage.migrationLedger.filter((item: any) =>
    Number.isSafeInteger(item?.from) && Number.isSafeInteger(item?.to) && typeof item?.at === 'string') : [];
  let integrityRepair = input._storage?.integrityRepair;
  if (declared < STORAGE_SCHEMA_VERSION) {
    materializeRoundOpeningsFromScreenshotEvidence(input);
    materializeRoundPlantsFromScreenshotEvidence(input);
    materializeFirstDeathsFromRoundEvidence(input, { overwrite: false });
    // An archive read as a stored index (evidence not loaded) holds stubs in
    // place of its collections; only loaded archives can be migrated.
    const loadedArchives = (Array.isArray(input.seasonArchives) ? input.seasonArchives : []).filter((archive: any) => Array.isArray(archive?.matches) && Array.isArray(archive?.rounds ?? []) && Array.isArray(archive?.playerStats ?? []));
    for (const archive of loadedArchives) {
      materializeRoundOpeningsFromScreenshotEvidence(archive);
      materializeRoundPlantsFromScreenshotEvidence(archive);
      materializeFirstDeathsFromRoundEvidence(archive, { overwrite: false });
    }
    migrateAcceptedMatchAggregates(input);
    for (const archive of loadedArchives) migrateAcceptedMatchAggregates(archive);
    if (!Array.isArray(input.attendanceCredits)) input.attendanceCredits = [];
    if (!Array.isArray(input.coachingSignals)) input.coachingSignals = [];
    if (!Array.isArray(input.coachingActions)) input.coachingActions = [];
    input.coachingActions = migrateLegacyActionChecks(input.coachingActions, input.coachingSignals, 'storage-migration', now, buildAllPracticeBlockSummaries(withCurrentScreenshotMetrics(input), now));
    if (!Array.isArray(input.vodSubmissions)) input.vodSubmissions = [];
    if (!Array.isArray(input.dashboardViews)) input.dashboardViews = [];
    if (!Array.isArray(input.evidenceFusionResolutions)) input.evidenceFusionResolutions = [];
    if (!Array.isArray(input.calibratedPlayerRatings)) input.calibratedPlayerRatings = [];
    if (declared < 13) integrityRepair = { at: now, removed: repairOrphanMatchReferences(input) };
    // Schema 15 flags existing same-game re-captures for coach review. Nothing is deleted.
    if (declared < 15) refreshDuplicateQuarantine(input, now);
    ledger.push({ from: declared, to: STORAGE_SCHEMA_VERSION, at: now });
  }
  const evidenceArtifacts = input._storage?.evidenceArtifacts;
  input._storage = { schemaVersion: STORAGE_SCHEMA_VERSION, migratedAt: declared < STORAGE_SCHEMA_VERSION ? now : String(input._storage?.migratedAt || now), migrationLedger: ledger, ...(integrityRepair ? { integrityRepair } : {}), ...(evidenceArtifacts ? { evidenceArtifacts } : {}) } satisfies StorageMetadata;
  if (input.settings) ensureScheduleCalendars(input.settings);
  return input;
}

/**
 * Migrations that read round evidence must run on hydrated state: a stored
 * index carries artifact stubs, so ensureStorageSchema alone cannot see it.
 * `declared` is the schema version the stored payload had before ensureStorageSchema.
 */
export function migrateHydratedEvidence(input: any, declared: number, now = new Date().toISOString()) {
  if (declared < 15) refreshDuplicateQuarantine(input, now);
  return input;
}

export function validateTrackerState(input: any, options: { jsonFile?: boolean } = {}) {
  ensureStorageSchema(input);
  if ('settings' in input && (!input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings))) throw storageError('settings must be an object.', 400);
  for (const key of CORE_ARRAYS) if (key in input && !Array.isArray(input[key])) throw storageError(`${key} must be an array.`, 400);
  assertWorkspaceIdentityShape(input.workspace);
  for (const key of GROWTH_ARRAYS) {
    const collection = input[key];
    if (collection !== undefined && !Array.isArray(collection)) throw storageError(`${key} must be an array.`, 400);
    for (let index = 0; index < (collection || []).length; index += 1) assertEntity(collection[index], `${key}[${index}]`);
  }
  for (const key of GROWTH_TREES) {
    const tree = input[key];
    if (tree !== undefined && (!tree || typeof tree !== 'object' || Array.isArray(tree))) throw storageError(`${key} must be an object.`, 400);
  }
  const total = bytes(input);
  if (options.jsonFile && total > MAX_JSON_DATABASE_BYTES) throw storageError(`JSON database exceeds the ${MAX_JSON_DATABASE_BYTES}-byte development limit.`);
  // Encoding performs the final per-record and per-document size checks.
  encodeStorageDocuments(input);
  return input;
}

function emitValue(docs: EncodedDocument[], topKey: string, path: Array<string | number>, value: unknown) {
  const normalized = normalizeJsonValue(value);
  if (normalized === OMIT) return;
  assertEntity(normalized, `${topKey}${path.map(part => `[${String(part)}]`).join('')}`);
  const payload = { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path, kind: 'value', value: normalized };
  if (bytes(payload) > MAX_DOCUMENT_BYTES) throw storageError(`Encoded storage record for ${topKey} exceeds its safe document limit.`);
  docs.push({ id: stableId([topKey, path]), payload });
}

function emitGrowthTree(docs: EncodedDocument[], topKey: string, value: any, path: Array<string | number>, depth: number) {
  if (!value || typeof value !== 'object') return emitValue(docs, topKey, path, value);
  const container = Array.isArray(value) ? 'array' : 'object';
  docs.push({ id: stableId([topKey, path, 'container']), payload: { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path, kind: 'container', container } });
  const entries = Array.isArray(value) ? value.map((item, index) => [index, item] as const) : Object.entries(value);
  for (const [childKey, child] of entries) {
    const childPath = [...path, childKey];
    // Two forced levels make each replay/adapter record independently bounded.
    if (child && typeof child === 'object' && (depth < 2 || bytes(child) > MAX_ENTITY_BYTES)) emitGrowthTree(docs, topKey, child, childPath, depth + 1);
    else emitValue(docs, topKey, childPath, child);
  }
}

export function encodeStorageDocuments(input: Record<string, any>): EncodedDocument[] {
  const docs: EncodedDocument[] = [];
  for (const [topKey, rawValue] of Object.entries(input)) {
    const normalized = normalizeJsonValue(rawValue);
    if (normalized === OMIT) continue;
    const value: any = normalized;
    if (GROWTH_ARRAYS.has(topKey)) {
      docs.push({ id: stableId([topKey, 'container']), payload: { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path: [], kind: 'container', container: 'array' } });
      (value || []).forEach((entity: unknown, index: number) => emitValue(docs, topKey, [index], entity));
    } else if (GROWTH_TREES.has(topKey)) {
      emitGrowthTree(docs, topKey, value || {}, [], 0);
    } else if (bytes(value) <= MAX_ENTITY_BYTES) {
      emitValue(docs, topKey, [], value);
    } else {
      const serialized = JSON.stringify(value);
      const chunks: string[] = [];
      // Slice conservatively by code units, then shrink any multi-byte overflow.
      for (let offset = 0; offset < serialized.length;) {
        let end = Math.min(serialized.length, offset + STORAGE_CHUNK_BYTES);
        while (Buffer.byteLength(serialized.slice(offset, end), 'utf8') > STORAGE_CHUNK_BYTES) end -= 1024;
        chunks.push(serialized.slice(offset, end)); offset = end;
      }
      docs.push({ id: stableId([topKey, 'chunks']), payload: { schemaVersion: STORAGE_SCHEMA_VERSION, topKey, path: [], kind: 'chunks', count: chunks.length, sha256: crypto.createHash('sha256').update(serialized).digest('hex') } });
      chunks.forEach((chunk, index) => emitValue(docs, topKey, ['__chunk', index], chunk));
    }
  }
  return docs;
}
