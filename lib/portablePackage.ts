import crypto from 'crypto';
import { toPublicTrackerData } from './publicData';

export const PORTABLE_PACKAGE_FORMAT = 'moetracker-package/v1';
export const PORTABLE_PACKAGE_MAX_BYTES = 9 * 1024 * 1024;
const COLLECTIONS = ['matches', 'playerStats', 'rounds', 'rosterPlayers', 'coreMemberships', 'schedule', 'attendanceCredits', 'goals', 'soloq', 'vetos', 'strats', 'stratRuns', 'tryoutBatches', 'vodReviews', 'vodSubmissions', 'lineups', 'seasonArchives', 'practiceBlocks'] as const;

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested);
}
function digest(value: unknown) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function identity(collection: string, row: any) {
  if (collection === 'coreMemberships') return row?.id || `${row?.playerId || ''}:${row?.startedAt || ''}`;
  return row?.id || null;
}

export type PortablePackageSelection = { scope?: 'team' | 'player' | 'match' | 'season' | 'coach-transfer'; id?: string };

export function createPortablePackage(db: any, sourceDeviceId: string, createdAt = new Date().toISOString(), selection: PortablePackageSelection = {}) {
  const safe = toPublicTrackerData(db, 'coach');
  const collections = Object.fromEntries(COLLECTIONS.map(key => [key, Array.isArray(safe[key]) ? structuredClone(safe[key]) : []]));
  collections.practiceBlocks = collections.practiceBlocks.map(({ createdBy: _createdBy, updatedBy: _updatedBy, ...block }: any) => block);
  collections.seasonArchives = collections.seasonArchives.map(({ tryoutDecisionNotes: _privateNotes, ...archive }: any) => ({ ...archive, practiceBlocks: (archive.practiceBlocks || []).map(({ createdBy: _createdBy, updatedBy: _updatedBy, ...block }: any) => block) }));
  const scope = selection.scope || 'team'; const selectedId = selection.id || null; let matchIds: Set<string> | null = null;
  if (scope === 'player') {
    if (!selectedId) throw Object.assign(new Error('Player package requires a player identity.'), { status: 400 });
    collections.playerStats = collections.playerStats.filter((row: any) => row.playerId === selectedId); matchIds = new Set(collections.playerStats.map((row: any) => row.matchId)); collections.rosterPlayers = collections.rosterPlayers.filter((row: any) => row.id === selectedId); collections.coreMemberships = collections.coreMemberships.filter((row: any) => row.playerId === selectedId); collections.soloq = collections.soloq.filter((row: any) => row.playerId === selectedId || row.player === selectedId); collections.attendanceCredits = collections.attendanceCredits.filter((row: any) => row.playerId === selectedId); collections.schedule = collections.schedule.filter((row: any) => row.requiredPlayerIds?.includes(selectedId)).map((row: any) => ({ ...row, requiredPlayerIds: [selectedId], attendanceCheckIns: (row.attendanceCheckIns || []).filter((item: any) => item.playerId === selectedId) }));
  } else if (scope === 'match') {
    if (!selectedId) throw Object.assign(new Error('Match package requires a match identity.'), { status: 400 }); matchIds = new Set([selectedId]);
  } else if (scope === 'season') {
    if (!selectedId) throw Object.assign(new Error('Season package requires an archive identity.'), { status: 400 }); collections.seasonArchives = collections.seasonArchives.filter((row: any) => row.id === selectedId);
  }
  if (matchIds) { collections.matches = collections.matches.filter((row: any) => matchIds!.has(row.id)); for (const key of ['playerStats', 'rounds', 'vetos', 'stratRuns']) collections[key] = collections[key].filter((row: any) => matchIds!.has(row.matchId)); }
  const acceptedReplays = Object.fromEntries(Object.entries(db.engineAdapters?.replay || {}).filter(([, record]: any) => record?.status === 'accepted' && (!matchIds || matchIds.has(record.matchId))).map(([key, value]) => [key, structuredClone(value)]));
  const payload = { settings: structuredClone(safe.settings || {}), collections, acceptedReplays };
  return {
    format: PORTABLE_PACKAGE_FORMAT,
    manifest: { createdAt, sourceDeviceId, scope, selectionId: selectedId, payloadSha256: digest(payload), counts: Object.fromEntries(COLLECTIONS.map(key => [key, collections[key].length])), acceptedReplayCount: Object.keys(acceptedReplays).length },
    payload,
  };
}

export function validatePortablePackage(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Object.assign(new Error('Portable package must be an object.'), { status: 400 });
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > PORTABLE_PACKAGE_MAX_BYTES) throw Object.assign(new Error('Portable package exceeds the 9 MB safety limit.'), { status: 413 });
  const input = raw as any;
  if (input.format !== PORTABLE_PACKAGE_FORMAT || !input.manifest || !input.payload) throw Object.assign(new Error('Unsupported MoeTracker package format.'), { status: 400 });
  if (!/^[a-f0-9]{64}$/.test(String(input.manifest.payloadSha256 || '')) || input.manifest.payloadSha256 !== digest(input.payload)) throw Object.assign(new Error('Portable package integrity check failed.'), { status: 400 });
  if (!input.payload.collections || typeof input.payload.collections !== 'object' || Array.isArray(input.payload.collections)) throw Object.assign(new Error('Portable package collections are invalid.'), { status: 400 });
  for (const key of COLLECTIONS) if (!Array.isArray(input.payload.collections[key])) throw Object.assign(new Error(`Portable package collection ${key} is invalid.`), { status: 400 });
  if (!input.payload.acceptedReplays || typeof input.payload.acceptedReplays !== 'object' || Array.isArray(input.payload.acceptedReplays)) throw Object.assign(new Error('Portable accepted replay evidence is invalid.'), { status: 400 });
  return input;
}

export function previewPortablePackage(db: any, raw: unknown) {
  const pkg = validatePortablePackage(raw); const collections: Record<string, any> = {}; const conflicts: Array<{ collection: string; id: string }> = [];
  for (const key of COLLECTIONS) {
    const local = new Map((db[key] || []).map((row: any) => [identity(key, row), row])); let additions = 0; let duplicates = 0; let collectionConflicts = 0;
    for (const row of pkg.payload.collections[key]) {
      const id = identity(key, row); if (!id) throw Object.assign(new Error(`Portable package ${key} contains a record without an identity.`), { status: 400 });
      const current = local.get(id); if (!current) additions += 1; else if (digest(current) === digest(row)) duplicates += 1; else { collectionConflicts += 1; if (conflicts.length < 100) conflicts.push({ collection: key, id }); }
    }
    collections[key] = { additions, duplicates, conflicts: collectionConflicts };
  }
  const localAccepted = db.engineAdapters?.replay || {}; let replayAdditions = 0; let replayDuplicates = 0; let replayConflicts = 0;
  for (const [id, record] of Object.entries(pkg.payload.acceptedReplays)) {
    if (!localAccepted[id]) replayAdditions += 1; else if (digest(localAccepted[id]) === digest(record)) replayDuplicates += 1; else { replayConflicts += 1; if (conflicts.length < 100) conflicts.push({ collection: 'acceptedReplays', id }); }
  }
  return { format: pkg.format, payloadSha256: pkg.manifest.payloadSha256, createdAt: pkg.manifest.createdAt, sourceDeviceId: pkg.manifest.sourceDeviceId, collections, acceptedReplays: { additions: replayAdditions, duplicates: replayDuplicates, conflicts: replayConflicts }, conflicts, safeToApply: conflicts.length === 0 };
}

export function applyPortablePackage(db: any, raw: unknown) {
  const pkg = validatePortablePackage(raw); const preview = previewPortablePackage(db, pkg); const applied: Record<string, number> = {};
  for (const key of COLLECTIONS) {
    const existing = new Set((db[key] || []).map((row: any) => identity(key, row))); const additions = pkg.payload.collections[key].filter((row: any) => !existing.has(identity(key, row)));
    db[key] = [...(db[key] || []), ...structuredClone(additions)]; applied[key] = additions.length;
  }
  db.engineAdapters ||= { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: {}, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } };
  db.engineAdapters.replay ||= {};
  let acceptedReplays = 0; for (const [id, record] of Object.entries(pkg.payload.acceptedReplays)) if (!db.engineAdapters.replay[id]) { db.engineAdapters.replay[id] = structuredClone(record); acceptedReplays += 1; }
  const localSettings = db.settings || {}; for (const [key, value] of Object.entries(pkg.payload.settings || {})) if (localSettings[key] === undefined) localSettings[key] = structuredClone(value); db.settings = localSettings;
  return { preview, applied: { collections: applied, acceptedReplays }, payloadSha256: pkg.manifest.payloadSha256 };
}

export const portablePackageInternals = { canonical, digest, identity, COLLECTIONS };
