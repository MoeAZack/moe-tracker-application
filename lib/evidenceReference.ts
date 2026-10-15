/**
 * S0.1 — Canonical evidence reference.
 *
 * One small, versioned pointer from a calculated result back to the evidence
 * that produced it. A reference never copies raw screenshots, replay payloads,
 * file paths, VOD URLs, tokens or device credentials: it only names existing
 * identifiers (match/round IDs, capture IDs, screenshot record IDs, replay
 * SHA-256) so the owning workspace can resolve them.
 *
 * Existing records are not rewritten. References are derived on demand from
 * the current storage shapes by the `evidenceReferenceFor*` adapters, and the
 * resolver re-checks every claim against storage before returning pointers.
 */
import crypto from 'crypto';

export const EVIDENCE_REFERENCE_SCHEMA = 'moetracker.evidence-reference/v1' as const;
export const EVIDENCE_REFERENCE_VERSION = 1 as const;
export const WORKSPACE_IDENTITY_VERSION = 1 as const;

export const EVIDENCE_SOURCE_TYPES = ['screenshot', 'replay', 'vod', 'manual', 'live-logger', 'provider-import', 'unknown'] as const;
export const EVIDENCE_STATES = ['draft', 'accepted', 'rejected'] as const;
export const EVIDENCE_CONFIDENCE = ['confirmed', 'high', 'medium', 'low'] as const;
export const SCREENSHOT_CAPTURE_KINDS = ['scoreboard', 'performance', 'head-to-head', 'round'] as const;

export type EvidenceSourceType = typeof EVIDENCE_SOURCE_TYPES[number];
export type EvidenceState = typeof EVIDENCE_STATES[number];
export type EvidenceReferenceConfidence = typeof EVIDENCE_CONFIDENCE[number];

export interface ObservedIdentitySnapshot {
  /** Roster identity when proven at capture/acceptance time; never a synthetic `name:` key. */
  playerId: string | null;
  /** Name exactly as observed or accepted for this match. Never rewritten after a rename or archive. */
  observedName: string;
  agent: string | null;
  team: 'ours' | 'theirs' | null;
}

export interface FieldProvenance {
  source: EvidenceSourceType;
  /** Raw extractor confidence on the existing 0–100 OCR scale; null when not measured. */
  confidence: number | null;
}

export interface EvidenceReferenceV1 {
  schema: typeof EVIDENCE_REFERENCE_SCHEMA;
  scope: { workspaceId: string; ownerDeviceId: string | null };
  state: EvidenceState;
  sourceTypes: EvidenceSourceType[];
  matchId: string | null;
  round: { roundId: string | null; roundNumber: number | null } | null;
  captureSessionId: string | null;
  screenshot: {
    artifactId: string | null;
    imageSha256: string | null;
    captureKind: typeof SCREENSHOT_CAPTURE_KINDS[number] | null;
    cropRegionId: string | null;
  } | null;
  replay: { sha256: string; evidenceSha256: string | null } | null;
  vod: { vodReviewId: string | null; noteId: string | null; atSeconds: number | null } | null;
  producer: { parser: string | null; ocr: string | null; capture: string | null };
  capturedAt: string | null;
  /** Only accepted references carry it. Null on an accepted legacy record means the acceptance time was never recorded. */
  acceptedAt: string | null;
  observedIdentities: ObservedIdentitySnapshot[];
  confidence: EvidenceReferenceConfidence | null;
  fieldProvenance: Record<string, FieldProvenance> | null;
}

export type EvidenceReferenceIssue = { path: string; code: string };

export class EvidenceReferenceError extends Error {
  status = 400;
  constructor(readonly code: string, readonly issues: EvidenceReferenceIssue[] = []) {
    super(issues.length ? `Evidence reference is invalid: ${issues.map(issue => `${issue.path} ${issue.code}`).join('; ')}.` : `Evidence reference is invalid: ${code}.`);
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9:._@-]{0,199}$/;
const WORKSPACE_ID = /^ws_[A-Za-z0-9_-]{16,64}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._@/+:-]{0,119}$/;
const FIELD_PATH = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const MAX_IDENTITIES = 20;
const MAX_FIELD_PROVENANCE = 128;
const MAX_ROUND = 99;
const MAX_REFERENCE_BYTES = 32 * 1024;
const REFERENCE_KEYS = ['schema', 'scope', 'state', 'sourceTypes', 'matchId', 'round', 'captureSessionId', 'screenshot', 'replay', 'vod', 'producer', 'capturedAt', 'acceptedAt', 'observedIdentities', 'confidence', 'fieldProvenance'];

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const absent = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => isObject(nested)
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : nested);
}

// --- normalization -----------------------------------------------------------

class Reader {
  issues: EvidenceReferenceIssue[] = [];
  fail(path: string, code: string) { this.issues.push({ path, code }); return null; }
  id(value: unknown, path: string, pattern = ID): string | null {
    if (absent(value)) return null;
    if (typeof value !== 'string' || !pattern.test(value.trim())) return this.fail(path, 'invalid-identifier');
    return value.trim();
  }
  sha(value: unknown, path: string): string | null {
    if (absent(value)) return null;
    const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SHA256.test(clean) ? clean : this.fail(path, 'invalid-sha256');
  }
  label(value: unknown, path: string): string | null {
    if (absent(value)) return null;
    if (typeof value !== 'string' || !VERSION_LABEL.test(value.trim())) return this.fail(path, 'invalid-version-label');
    return value.trim();
  }
  text(value: unknown, path: string, max = 80): string | null {
    if (absent(value)) return null;
    // Observed names keep their original spelling; only surrounding whitespace is removed.
    if (typeof value !== 'string' || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) return this.fail(path, 'invalid-text');
    return value.trim();
  }
  timestamp(value: unknown, path: string): string | null {
    if (absent(value)) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(value.trim()) || !Number.isFinite(Date.parse(value))) return this.fail(path, 'invalid-timestamp');
    // Normalized to UTC so the same instant always serializes identically. Display converts to Africa/Cairo.
    return new Date(Date.parse(value)).toISOString();
  }
  integer(value: unknown, path: string, min: number, max: number): number | null {
    if (absent(value)) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return this.fail(path, 'invalid-integer');
    return value;
  }
  number(value: unknown, path: string, min: number, max: number): number | null {
    if (absent(value)) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return this.fail(path, 'invalid-number');
    return value;
  }
  oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T | null {
    if (absent(value)) return null;
    return options.includes(value as T) ? value as T : this.fail(path, 'invalid-enum');
  }
  object(value: unknown, path: string): Record<string, any> | null {
    if (absent(value)) return null;
    return isObject(value) ? value : this.fail(path, 'invalid-object');
  }
}

/** A roster identity is never a synthetic capture key such as `name:alpha`. */
function rosterPlayerId(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value.trim()) && !value.trim().startsWith('name:') ? value.trim() : null;
}

function readIdentities(reader: Reader, value: unknown): ObservedIdentitySnapshot[] {
  if (absent(value)) return [];
  if (!Array.isArray(value)) { reader.fail('observedIdentities', 'invalid-array'); return []; }
  if (value.length > MAX_IDENTITIES) { reader.fail('observedIdentities', 'too-many'); return []; }
  return value.map((raw, index) => {
    const path = `observedIdentities[${index}]`;
    if (!isObject(raw)) { reader.fail(path, 'invalid-object'); return null; }
    const observedName = reader.text(raw.observedName, `${path}.observedName`);
    if (!observedName) { if (!reader.issues.some(issue => issue.path === `${path}.observedName`)) reader.fail(`${path}.observedName`, 'required'); return null; }
    const playerId = absent(raw.playerId) ? null : rosterPlayerId(raw.playerId) ?? reader.fail(`${path}.playerId`, 'invalid-identifier');
    return { playerId, observedName, agent: reader.text(raw.agent, `${path}.agent`, 40), team: reader.oneOf(raw.team, ['ours', 'theirs'] as const, `${path}.team`) };
  }).filter((item): item is ObservedIdentitySnapshot => !!item);
}

function readFieldProvenance(reader: Reader, value: unknown): Record<string, FieldProvenance> | null {
  const raw = reader.object(value, 'fieldProvenance');
  if (!raw) return null;
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELD_PROVENANCE) return reader.fail('fieldProvenance', 'too-many');
  const output: Record<string, FieldProvenance> = {};
  for (const [field, item] of entries.sort(([left], [right]) => left < right ? -1 : 1)) {
    const path = `fieldProvenance.${field}`;
    if (!FIELD_PATH.test(field)) { reader.fail(path, 'invalid-field'); continue; }
    if (!isObject(item)) { reader.fail(path, 'invalid-object'); continue; }
    const source = reader.oneOf(item.source, EVIDENCE_SOURCE_TYPES, `${path}.source`);
    if (!source) { if (absent(item.source)) reader.fail(`${path}.source`, 'required'); continue; }
    output[field] = { source, confidence: reader.number(item.confidence, `${path}.confidence`, 0, 100) };
  }
  return Object.keys(output).length ? output : null;
}

/**
 * Normalize and validate a reference. Missing optional data becomes `null`;
 * invalid data is reported, never guessed, defaulted to zero or coerced.
 */
export function validateEvidenceReference(raw: unknown): { ok: true; value: EvidenceReferenceV1 } | { ok: false; issues: EvidenceReferenceIssue[] } {
  const reader = new Reader();
  if (!isObject(raw)) return { ok: false, issues: [{ path: '', code: 'invalid-object' }] };
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_REFERENCE_BYTES) return { ok: false, issues: [{ path: '', code: 'too-large' }] };
  if (raw.schema !== EVIDENCE_REFERENCE_SCHEMA) return { ok: false, issues: [{ path: 'schema', code: 'unsupported-schema' }] };
  for (const key of Object.keys(raw)) if (!REFERENCE_KEYS.includes(key)) reader.fail(key, 'unknown-field');

  const scope = reader.object(raw.scope, 'scope') || {};
  const workspaceId = reader.id(scope.workspaceId, 'scope.workspaceId', WORKSPACE_ID);
  if (!workspaceId && absent(scope.workspaceId)) reader.fail('scope.workspaceId', 'required');
  const state = reader.oneOf(raw.state, EVIDENCE_STATES, 'state');
  if (!state && absent(raw.state)) reader.fail('state', 'required');

  let sourceTypes: EvidenceSourceType[] = [];
  if (!Array.isArray(raw.sourceTypes) || raw.sourceTypes.length === 0) reader.fail('sourceTypes', 'required');
  else sourceTypes = [...new Set(raw.sourceTypes.map((item: unknown, index: number) => reader.oneOf(item, EVIDENCE_SOURCE_TYPES, `sourceTypes[${index}]`)).filter(Boolean) as EvidenceSourceType[])].sort();
  if (sourceTypes.includes('unknown') && sourceTypes.length > 1) reader.fail('sourceTypes', 'unknown-must-be-alone');

  const matchId = reader.id(raw.matchId, 'matchId');
  const roundRaw = reader.object(raw.round, 'round');
  const round = roundRaw ? { roundId: reader.id(roundRaw.roundId, 'round.roundId'), roundNumber: reader.integer(roundRaw.roundNumber, 'round.roundNumber', 1, MAX_ROUND) } : null;
  const captureSessionId = reader.id(raw.captureSessionId, 'captureSessionId');
  const shotRaw = reader.object(raw.screenshot, 'screenshot');
  const screenshot = shotRaw ? {
    artifactId: reader.id(shotRaw.artifactId, 'screenshot.artifactId'),
    imageSha256: reader.sha(shotRaw.imageSha256, 'screenshot.imageSha256'),
    captureKind: reader.oneOf(shotRaw.captureKind, SCREENSHOT_CAPTURE_KINDS, 'screenshot.captureKind'),
    cropRegionId: reader.id(shotRaw.cropRegionId, 'screenshot.cropRegionId'),
  } : null;
  const replayRaw = reader.object(raw.replay, 'replay');
  const replaySha = replayRaw ? reader.sha(replayRaw.sha256, 'replay.sha256') : null;
  if (replayRaw && !replaySha && absent(replayRaw.sha256)) reader.fail('replay.sha256', 'required');
  const replay = replayRaw && replaySha ? { sha256: replaySha, evidenceSha256: reader.sha(replayRaw.evidenceSha256, 'replay.evidenceSha256') } : null;
  const vodRaw = reader.object(raw.vod, 'vod');
  const vod = vodRaw ? { vodReviewId: reader.id(vodRaw.vodReviewId, 'vod.vodReviewId'), noteId: reader.id(vodRaw.noteId, 'vod.noteId'), atSeconds: reader.number(vodRaw.atSeconds, 'vod.atSeconds', 0, 24 * 60 * 60) } : null;
  const producerRaw = reader.object(raw.producer, 'producer') || {};
  const producer = { parser: reader.label(producerRaw.parser, 'producer.parser'), ocr: reader.label(producerRaw.ocr, 'producer.ocr'), capture: reader.label(producerRaw.capture, 'producer.capture') };
  const capturedAt = reader.timestamp(raw.capturedAt, 'capturedAt');
  const acceptedAt = reader.timestamp(raw.acceptedAt, 'acceptedAt');
  const observedIdentities = readIdentities(reader, raw.observedIdentities);
  const confidence = reader.oneOf(raw.confidence, EVIDENCE_CONFIDENCE, 'confidence');
  const fieldProvenance = readFieldProvenance(reader, raw.fieldProvenance);

  // Cross-field invariants: a source claim must name the evidence it points at.
  const emptyShot = screenshot && !screenshot.artifactId && !screenshot.imageSha256 && !screenshot.captureKind && !screenshot.cropRegionId;
  if (emptyShot) reader.fail('screenshot', 'empty-locator');
  const hasShot = !!screenshot && !emptyShot;
  if (sourceTypes.includes('screenshot') && !hasShot && !captureSessionId && !matchId) reader.fail('sourceTypes', 'screenshot-without-locator');
  if (hasShot && !sourceTypes.includes('screenshot')) reader.fail('screenshot', 'source-type-missing');
  if (sourceTypes.includes('replay') && !replay) reader.fail('sourceTypes', 'replay-without-sha256');
  if (replay && !sourceTypes.includes('replay')) reader.fail('replay', 'source-type-missing');
  if (vod && !vod.vodReviewId && !vod.noteId && vod.atSeconds === null && !matchId) reader.fail('vod', 'empty-locator');
  if (sourceTypes.includes('vod') && !vod) reader.fail('sourceTypes', 'vod-without-locator');
  if (vod && !sourceTypes.includes('vod')) reader.fail('vod', 'source-type-missing');
  if (round && !round.roundId && round.roundNumber === null && !reader.issues.some(issue => issue.path.startsWith('round.'))) reader.fail('round', 'empty-locator');
  if (round && !matchId && !captureSessionId && !replay) reader.fail('round', 'requires-match-capture-or-replay');
  if (!matchId && !captureSessionId && !hasShot && !replay) reader.fail('', 'no-evidence-anchor');
  if (state && state !== 'accepted' && acceptedAt) reader.fail('acceptedAt', 'only-when-accepted');
  for (const [field, item] of Object.entries(fieldProvenance || {})) if (!sourceTypes.includes(item.source)) reader.fail(`fieldProvenance.${field}.source`, 'not-in-source-types');

  if (reader.issues.length || !workspaceId || !state) return { ok: false, issues: reader.issues };
  return { ok: true, value: {
    schema: EVIDENCE_REFERENCE_SCHEMA, scope: { workspaceId, ownerDeviceId: reader.id(scope.ownerDeviceId, 'scope.ownerDeviceId') },
    state, sourceTypes, matchId, round, captureSessionId, screenshot: hasShot ? screenshot : null, replay, vod, producer,
    capturedAt, acceptedAt, observedIdentities, confidence, fieldProvenance,
  } };
}

export function normalizeEvidenceReference(raw: unknown): EvidenceReferenceV1 {
  const result = validateEvidenceReference(raw);
  if (result.ok === false) throw new EvidenceReferenceError('invalid-reference', result.issues);
  return result.value;
}

/** Stable serialization: identical references always produce identical text. */
export function serializeEvidenceReference(reference: EvidenceReferenceV1): string {
  return canonical(normalizeEvidenceReference(reference));
}

export function parseEvidenceReference(text: string): EvidenceReferenceV1 {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new EvidenceReferenceError('invalid-json'); }
  return normalizeEvidenceReference(parsed);
}

/** Deterministic identity for deduplicating references (e.g. later review signals). */
export function evidenceReferenceKey(reference: EvidenceReferenceV1): string {
  return crypto.createHash('sha256').update(serializeEvidenceReference(reference)).digest('hex');
}

export const isAcceptedEvidenceReference = (reference: EvidenceReferenceV1) => reference.state === 'accepted';

// --- workspace identity --------------------------------------------------------

export function workspaceIdentity(db: any): string | null {
  const id = db?.workspace?.id;
  return typeof id === 'string' && WORKSPACE_ID.test(id) ? id : null;
}

/**
 * Mint the workspace identity once, at write time, so it is persisted with the
 * same revision. Reads never mint, which keeps an unsaved identity from
 * changing between requests. An existing identity is never replaced.
 */
export function ensureWorkspaceIdentity(db: any, now = new Date().toISOString(), randomId = () => crypto.randomBytes(18).toString('base64url')) {
  if (!db || typeof db !== 'object') return null;
  const existing = workspaceIdentity(db);
  if (existing) return existing;
  if (db.workspace !== undefined && db.workspace !== null) throw Object.assign(new Error('Workspace identity is malformed and cannot be replaced automatically.'), { status: 409 });
  const id = `ws_${randomId()}`;
  if (!WORKSPACE_ID.test(id)) throw new Error('Generated workspace identity is invalid.');
  db.workspace = { schemaVersion: WORKSPACE_IDENTITY_VERSION, id, createdAt: now };
  return id;
}

export function assertWorkspaceIdentityShape(value: unknown) {
  if (value === undefined) return;
  if (!isObject(value) || value.schemaVersion !== WORKSPACE_IDENTITY_VERSION || typeof value.id !== 'string' || !WORKSPACE_ID.test(value.id) || typeof value.createdAt !== 'string') {
    throw Object.assign(new Error('workspace identity is invalid.'), { status: 400 });
  }
}

// --- compatibility adapters: existing records -> references -------------------

type BuildOptions = { workspaceId: string };

function requireWorkspace(db: any, options: BuildOptions) {
  const own = workspaceIdentity(db);
  if (!own) throw new EvidenceReferenceError('workspace-unidentified');
  if (options?.workspaceId !== own) throw Object.assign(new EvidenceReferenceError('cross-workspace'), { status: 403 });
  return own;
}

function sourceTypeForMethod(method: unknown): EvidenceSourceType {
  return method === 'screenshot' || method === 'manual' || method === 'live-logger' || method === 'provider-import' ? method : 'unknown';
}

const versionLabel = (...parts: unknown[]) => {
  const clean = parts.filter(part => typeof part === 'string' && part.trim()).map(part => String(part).trim());
  const label = clean.join('@');
  return label && VERSION_LABEL.test(label) ? label : null;
};

const latest = (...values: Array<string | null | undefined>) => values.filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
  .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;

function identitiesFromStats(rows: any[]): ObservedIdentitySnapshot[] {
  return rows.slice(0, MAX_IDENTITIES).map(row => {
    const observedName = typeof row?.displayNameSnapshot === 'string' && row.displayNameSnapshot.trim() ? row.displayNameSnapshot : row?.player;
    return typeof observedName === 'string' && observedName.trim() ? { playerId: rosterPlayerId(row.playerId), observedName: observedName.trim().slice(0, 80), agent: typeof row.agent === 'string' && row.agent.trim() ? row.agent.trim().slice(0, 40) : null, team: 'ours' as const } : null;
  }).filter((item): item is NonNullable<typeof item> => !!item);
}

/** Locate a match in the active season first, then in preserved season archives. */
function locateMatch(db: any, matchId: string) {
  const active = (db.matches || []).find((item: any) => item?.id === matchId);
  if (active) return { location: 'active' as const, match: active, container: db, adapters: db.engineAdapters };
  for (const archive of db.seasonArchives || []) {
    const match = (archive?.matches || []).find((item: any) => item?.id === matchId);
    if (match) return { location: 'archived' as const, archiveId: String(archive.id), match, container: archive, adapters: archive.engineAdapters };
  }
  return null;
}

function acceptedReplayFor(adapters: any, store: any, matchId: string) {
  const record = adapters?.replay?.[matchId];
  const sha = record?.provenance?.replaySha256;
  if (record?.status === 'accepted' && typeof sha === 'string' && SHA256.test(sha)) {
    return { sha256: sha, evidenceSha256: SHA256.test(String(record.provenance.rawEvidenceHash || '')) ? record.provenance.rawEvidenceHash : null, acceptedAt: record.acceptedAt || null, parser: versionLabel(record.provenance.parser?.name, record.provenance.parser?.version) };
  }
  const review = Object.values(store?.reviews || {}).find((item: any) => item?.matchId === matchId && item?.status === 'accepted') as any;
  if (review && SHA256.test(String(review.sha256 || ''))) return { sha256: review.sha256, evidenceSha256: SHA256.test(String(review.rawEvidenceHash || '')) ? review.rawEvidenceHash : null, acceptedAt: review.acceptedAt || null, parser: null };
  return null;
}

function screenshotAcceptance(match: any, adapters: any) {
  const synced = adapters?.screenshot?.[match.id];
  const confirmed = match.sourceMetadata?.method === 'screenshot' && match.reviewConfirmation?.alliedSideConfirmed === true;
  if (!confirmed && synced?.status !== 'accepted') return null;
  return { acceptedAt: latest(match.reviewConfirmation?.confirmedAt, synced?.status === 'accepted' ? synced.updatedAt : null), ownerDeviceId: typeof synced?.sourceDeviceId === 'string' && ID.test(synced.sourceDeviceId) ? synced.sourceDeviceId : null };
}

/**
 * Reference for a saved (coach-committed) match, built from the fields the
 * match already stores. A replay only joins an accepted match reference when
 * that replay is itself accepted; replay drafts get their own draft reference.
 */
export function evidenceReferenceForMatch(db: any, matchId: string, options: BuildOptions): EvidenceReferenceV1 {
  const workspaceId = requireWorkspace(db, options);
  const located = locateMatch(db, matchId);
  if (!located) throw Object.assign(new EvidenceReferenceError('match-not-found'), { status: 404 });
  const { match, container, adapters } = located;
  const method = match.sourceMetadata?.method;
  const shot = screenshotAcceptance(match, adapters);
  const captureSessionId = typeof match.screenshotEvidence?.captureId === 'string' && ID.test(match.screenshotEvidence.captureId) ? match.screenshotEvidence.captureId : null;
  const replay = acceptedReplayFor(adapters, located.location === 'active' ? db.replayIntake : null, matchId);
  const sources = new Set<EvidenceSourceType>();
  if (shot || method === 'screenshot' || captureSessionId) sources.add('screenshot');
  if (replay) sources.add('replay');
  // Replay acceptance stamps provider-import/vrfkit metadata on the match; it is the replay, not a separate import.
  if (method && method !== 'screenshot' && !(method === 'provider-import' && match.sourceMetadata?.provider === 'vrfkit' && replay)) sources.add(sourceTypeForMethod(method));
  if (!method && typeof match.source === 'string' && match.source.trim() && !sources.size) sources.add('manual');
  if (sources.size > 1) sources.delete('unknown');
  if (!sources.size) sources.add('unknown');
  // A screenshot-method match without coach confirmation is not accepted evidence.
  const screenshotUnconfirmed = method === 'screenshot' && !shot;
  const state: EvidenceState = screenshotUnconfirmed ? 'draft' : 'accepted';
  const stats = (container.playerStats || []).filter((row: any) => row?.matchId === matchId);
  const ocr = method === 'screenshot' ? versionLabel(match.sourceMetadata?.provider, match.sourceMetadata?.model) : null;
  return normalizeEvidenceReference({
    schema: EVIDENCE_REFERENCE_SCHEMA,
    scope: { workspaceId, ownerDeviceId: shot?.ownerDeviceId || null },
    state, sourceTypes: [...sources], matchId, round: null, captureSessionId, screenshot: null,
    replay: replay ? { sha256: replay.sha256, evidenceSha256: replay.evidenceSha256 } : null, vod: null,
    producer: { parser: replay?.parser || null, ocr, capture: null },
    capturedAt: match.sourceMetadata?.capturedAt || null,
    acceptedAt: state === 'accepted' ? latest(shot?.acceptedAt, replay?.acceptedAt) : null,
    observedIdentities: identitiesFromStats(stats), confidence: null, fieldProvenance: null,
  });
}

/** Round-level reference; keeps per-field OCR confidence when the round retained it. */
export function evidenceReferenceForRound(db: any, matchId: string, round: { roundId?: string; roundNumber?: number }, options: BuildOptions): EvidenceReferenceV1 {
  const base = evidenceReferenceForMatch(db, matchId, options);
  const located = locateMatch(db, matchId)!;
  const row = (located.container.rounds || []).find((item: any) => item?.matchId === matchId && (round.roundId ? item.id === round.roundId : item.roundNo === round.roundNumber));
  if (!row) throw Object.assign(new EvidenceReferenceError('round-not-found'), { status: 404 });
  const evidence = row.screenshotEvidence;
  const fromScreenshot = !!evidence && base.sourceTypes.includes('screenshot');
  // A retained OCR round is independently review-gated. It may only inherit
  // acceptance after both the match and this exact round were confirmed.
  const state: EvidenceState = fromScreenshot && (base.state !== 'accepted' || evidence.reviewStatus !== 'confirmed') ? 'draft' : base.state;
  const fieldProvenance = fromScreenshot && isObject(evidence.fieldConfidence)
    ? Object.fromEntries(Object.entries(evidence.fieldConfidence).filter(([field]) => FIELD_PATH.test(field)).slice(0, MAX_FIELD_PROVENANCE)
      .map(([field, value]) => [field, { source: 'screenshot', confidence: typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null }]))
    : null;
  return normalizeEvidenceReference({
    ...base,
    state,
    acceptedAt: state === 'accepted' ? base.acceptedAt : null,
    round: { roundId: typeof row.id === 'string' && ID.test(row.id) ? row.id : null, roundNumber: Number.isSafeInteger(row.roundNo) && row.roundNo >= 1 && row.roundNo <= MAX_ROUND ? row.roundNo : null },
    screenshot: fromScreenshot ? { artifactId: null, imageSha256: null, captureKind: 'round', cropRegionId: null } : null,
    confidence: fromScreenshot && EVIDENCE_CONFIDENCE.includes(evidence.confidence) ? evidence.confidence : null,
    fieldProvenance,
  });
}

/** Draft reference for a retained screenshot review record (never accepted by itself). */
export function evidenceReferenceForScreenshotRecord(db: any, recordId: string, options: BuildOptions): EvidenceReferenceV1 {
  const workspaceId = requireWorkspace(db, options);
  const record = db.replayIntake?.screenshots?.[recordId];
  if (!record || record.id !== recordId) throw Object.assign(new EvidenceReferenceError('screenshot-not-found'), { status: 404 });
  const linkedReplay = record.status === 'linked' && SHA256.test(String(record.replaySha256 || '')) ? record.replaySha256 : null;
  const draft = record.draft || {};
  return normalizeEvidenceReference({
    schema: EVIDENCE_REFERENCE_SCHEMA,
    scope: { workspaceId, ownerDeviceId: ID.test(String(record.deviceId || '')) && record.deviceId !== 'manual-entry' ? record.deviceId : null },
    state: 'draft', sourceTypes: linkedReplay ? ['screenshot', 'replay'] : ['screenshot'],
    matchId: null, round: null, captureSessionId: null,
    screenshot: { artifactId: recordId, imageSha256: record.imageSha256, captureKind: 'scoreboard', cropRegionId: null },
    replay: linkedReplay ? { sha256: linkedReplay, evidenceSha256: null } : null, vod: null,
    producer: { parser: null, ocr: versionLabel(draft.sourceMetadata?.provider, draft.sourceMetadata?.model), capture: null },
    capturedAt: draft.sourceMetadata?.capturedAt || record.createdAt || null, acceptedAt: null,
    observedIdentities: (Array.isArray(draft.stats) ? draft.stats : []).slice(0, MAX_IDENTITIES)
      .filter((row: any) => typeof row?.extractedName === 'string' && row.extractedName.trim())
      .map((row: any) => ({ playerId: row.rosterMatch?.status === 'matched' ? rosterPlayerId(row.matchedPlayerId) : null, observedName: row.extractedName.trim().slice(0, 80), agent: typeof row.agent === 'string' && row.agent.trim() ? row.agent.trim().slice(0, 40) : null, team: null })),
    confidence: null, fieldProvenance: null,
  });
}

/** Reference for a replay intake record: accepted only when the coach review was accepted. */
export function evidenceReferenceForReplay(db: any, sha256: string, options: BuildOptions): EvidenceReferenceV1 {
  const workspaceId = requireWorkspace(db, options);
  const hash = String(sha256 || '').toLowerCase();
  if (!SHA256.test(hash)) throw new EvidenceReferenceError('invalid-replay-sha256');
  const store = db.replayIntake || {};
  const blob = store.blobs?.[hash]; const review = store.reviews?.[hash];
  if (!blob && !review) throw Object.assign(new EvidenceReferenceError('replay-not-found'), { status: 404 });
  const job = blob?.parserJobId ? store.parserJobs?.[blob.parserJobId] : null;
  const accepted = review?.status === 'accepted';
  const players = new Map<string, any>((job?.result?.scoreboard?.players || []).map((row: any) => [row?.playerId, row]));
  const agentOf = (row: any) => row?.agent?.status === 'available' && typeof row.agent.value === 'string' ? row.agent.value.slice(0, 40) : null;
  const identities = review?.mappings?.length
    ? review.mappings.slice(0, MAX_IDENTITIES).filter((item: any) => typeof item?.displayName === 'string' && item.displayName.trim()).map((item: any) => ({
      playerId: rosterPlayerId(item.rosterPlayerId), observedName: item.displayName.trim().slice(0, 80), agent: agentOf(players.get(item.parserPlayerId)),
      team: review.teamId && players.get(item.parserPlayerId)?.teamId ? (players.get(item.parserPlayerId).teamId === review.teamId ? 'ours' : 'theirs') : null,
    }))
    : [];
  const ownerDevice = Object.values(store.associations || {}).filter((item: any) => item?.sha256 === hash).map((item: any) => item.deviceId).sort()[0];
  return normalizeEvidenceReference({
    schema: EVIDENCE_REFERENCE_SCHEMA,
    scope: { workspaceId, ownerDeviceId: typeof ownerDevice === 'string' && ID.test(ownerDevice) ? ownerDevice : null },
    state: accepted ? 'accepted' : 'draft', sourceTypes: ['replay'],
    matchId: review?.matchId || blob?.matchId || null, round: null, captureSessionId: null, screenshot: null,
    replay: { sha256: hash, evidenceSha256: SHA256.test(String(review?.rawEvidenceHash || blob?.evidenceHash || '')) ? (review?.rawEvidenceHash || blob.evidenceHash) : null }, vod: null,
    producer: { parser: versionLabel(job?.parser?.name, job?.parser?.version), ocr: null, capture: null },
    capturedAt: blob?.storedAt || null, acceptedAt: accepted ? review.acceptedAt : null,
    observedIdentities: identities, confidence: null, fieldProvenance: null,
  });
}

// --- resolution -----------------------------------------------------------------

export type EvidenceResolutionFailure =
  | 'invalid-reference' | 'workspace-unidentified' | 'cross-workspace' | 'match-not-found' | 'round-not-found'
  | 'capture-session-mismatch' | 'screenshot-not-found' | 'replay-not-found' | 'replay-match-mismatch' | 'replay-evidence-mismatch'
  | 'vod-not-found' | 'owner-device-mismatch' | 'state-mismatch';

export type CurrentIdentity = { playerId: string; displayName: string | null; status: 'core' | 'tryout' | 'standIn' | 'archived' | 'unknown' };

export type EvidenceResolution =
  | { ok: true; reference: EvidenceReferenceV1; storedState: EvidenceState; match: { id: string; location: 'active' | 'archived'; archiveId: string | null } | null;
      round: { id: string | null; roundNumber: number | null } | null; replay: { sha256: string; status: 'accepted' | 'review-required' } | null;
      screenshot: { artifactId: string | null } | null; vod: { vodReviewId: string } | null;
      identities: Array<{ observed: ObservedIdentitySnapshot; current: CurrentIdentity | null }> }
  | { ok: false; reason: EvidenceResolutionFailure; issues?: EvidenceReferenceIssue[] };

function currentIdentity(db: any, playerId: string): CurrentIdentity {
  const player = (db.rosterPlayers || []).find((item: any) => item?.id === playerId);
  if (!player) {
    const archived = (db.seasonArchives || []).some((archive: any) => (archive?.rosterPlayers || []).some((item: any) => item?.id === playerId));
    return { playerId, displayName: null, status: archived ? 'archived' : 'unknown' };
  }
  const status = player.retiredAt ? 'archived' : ['core', 'tryout', 'standIn'].includes(player.rosterStatus) ? player.rosterStatus : 'unknown';
  return { playerId, displayName: typeof player.displayName === 'string' ? player.displayName : null, status };
}

/**
 * Resolve a reference inside exactly one workspace. The caller passes its own
 * authenticated workspace; a reference from any other workspace is rejected
 * before storage is consulted. Only identifiers and states are returned.
 */
export function resolveEvidenceReference(db: any, raw: unknown, caller: { workspaceId: string }): EvidenceResolution {
  const validated = validateEvidenceReference(raw);
  if (validated.ok === false) return { ok: false, reason: 'invalid-reference', issues: validated.issues };
  const reference = validated.value;
  const own = workspaceIdentity(db);
  if (!own) return { ok: false, reason: 'workspace-unidentified' };
  if (caller?.workspaceId !== own || reference.scope.workspaceId !== own) return { ok: false, reason: 'cross-workspace' };

  // Never seed resolved state from the untrusted claim itself.
  let storedState: EvidenceState = 'draft';
  const ownerDeviceIds = new Set<string>();
  let match: Extract<EvidenceResolution, { ok: true }>['match'] = null;
  let located: ReturnType<typeof locateMatch> = null;
  if (reference.matchId) {
    located = locateMatch(db, reference.matchId);
    if (!located) return { ok: false, reason: 'match-not-found' };
    match = { id: reference.matchId, location: located.location, archiveId: located.location === 'archived' ? located.archiveId : null };
    const recordedCapture = located.match.screenshotEvidence?.captureId;
    if (reference.captureSessionId && recordedCapture !== reference.captureSessionId) return { ok: false, reason: 'capture-session-mismatch' };
    const matchOwner = located.adapters?.screenshot?.[reference.matchId]?.sourceDeviceId;
    if (typeof matchOwner === 'string' && ID.test(matchOwner)) ownerDeviceIds.add(matchOwner);
    storedState = located.match.sourceMetadata?.method === 'screenshot' && !screenshotAcceptance(located.match, located.adapters) ? 'draft' : 'accepted';
  } else if (reference.captureSessionId) return { ok: false, reason: 'capture-session-mismatch' };

  let round: Extract<EvidenceResolution, { ok: true }>['round'] = null;
  let roundRow: any = null;
  if (reference.round) {
    if (located) {
      const row = (located.container.rounds || []).find((item: any) => item?.matchId === reference.matchId
        && (reference.round!.roundId ? item.id === reference.round!.roundId : item.roundNo === reference.round!.roundNumber));
      if (!row || (reference.round.roundNumber !== null && row.roundNo !== reference.round.roundNumber)) return { ok: false, reason: 'round-not-found' };
      roundRow = row;
      round = { id: typeof row.id === 'string' ? row.id : null, roundNumber: Number.isSafeInteger(row.roundNo) ? row.roundNo : null };
    } else return { ok: false, reason: 'round-not-found' };
  }

  let replay: Extract<EvidenceResolution, { ok: true }>['replay'] = null;
  if (reference.replay) {
    const sha = reference.replay.sha256;
    const store = located?.location === 'archived' ? null : db.replayIntake;
    const accepted = reference.matchId ? acceptedReplayFor(located?.adapters, store, reference.matchId) : null;
    const review = store?.reviews?.[sha]; const blob = store?.blobs?.[sha];
    let storedEvidenceSha256: string | null = null;
    if (accepted?.sha256 === sha) {
      replay = { sha256: sha, status: 'accepted' };
      storedEvidenceSha256 = accepted.evidenceSha256;
    }
    else if (review || blob) {
      const linkedMatch = review?.matchId || blob?.matchId || null;
      if (reference.matchId && linkedMatch && linkedMatch !== reference.matchId) return { ok: false, reason: 'replay-match-mismatch' };
      replay = { sha256: sha, status: review?.status === 'accepted' && (!reference.matchId || review.matchId === reference.matchId) ? 'accepted' : 'review-required' };
      storedEvidenceSha256 = SHA256.test(String(review?.rawEvidenceHash || blob?.evidenceHash || '')) ? (review?.rawEvidenceHash || blob.evidenceHash) : null;
    } else return { ok: false, reason: 'replay-not-found' };
    if (reference.replay.evidenceSha256 && storedEvidenceSha256 !== reference.replay.evidenceSha256) return { ok: false, reason: 'replay-evidence-mismatch' };
    for (const association of Object.values(store?.associations || {}) as any[]) {
      if (association?.sha256 === sha && typeof association.deviceId === 'string' && ID.test(association.deviceId)) ownerDeviceIds.add(association.deviceId);
    }
    if (replay.status !== 'accepted') storedState = 'draft';
    else if (!reference.matchId) storedState = 'accepted';
  }

  let screenshot: Extract<EvidenceResolution, { ok: true }>['screenshot'] = null;
  if (reference.screenshot) {
    let backing: any = null;
    if (reference.screenshot.artifactId) {
      const record = db.replayIntake?.screenshots?.[reference.screenshot.artifactId];
      // Screenshot review records expire after their retention window; an expired record no longer resolves.
      if (!record || (reference.screenshot.imageSha256 && record.imageSha256 !== reference.screenshot.imageSha256)) return { ok: false, reason: 'screenshot-not-found' };
      backing = record;
      if (typeof record.deviceId === 'string' && ID.test(record.deviceId) && record.deviceId !== 'manual-entry') ownerDeviceIds.add(record.deviceId);
      if (reference.screenshot.captureKind && reference.screenshot.captureKind !== 'scoreboard') return { ok: false, reason: 'screenshot-not-found' };
      // Retained screenshot records are review-required drafts by contract; they never carry acceptance.
      storedState = record.status === 'rejected' ? 'rejected' : 'draft';
    } else if (reference.screenshot.captureKind === 'round' && roundRow?.screenshotEvidence) {
      backing = roundRow.screenshotEvidence;
      const roundStatus = roundRow.screenshotEvidence.reviewStatus;
      if (roundStatus !== 'confirmed' || storedState !== 'accepted') storedState = roundStatus === 'rejected' ? 'rejected' : 'draft';
    } else if (reference.screenshot.captureKind === 'scoreboard' && located?.match.screenshotEvidence && reference.captureSessionId) {
      backing = located.match.screenshotEvidence;
    } else {
      return { ok: false, reason: 'screenshot-not-found' };
    }
    if (reference.screenshot.imageSha256 && backing?.imageSha256 !== reference.screenshot.imageSha256) return { ok: false, reason: 'screenshot-not-found' };
    if (reference.screenshot.cropRegionId && backing?.cropRegionId !== reference.screenshot.cropRegionId) return { ok: false, reason: 'screenshot-not-found' };
    screenshot = { artifactId: reference.screenshot.artifactId };
  }

  let vod: Extract<EvidenceResolution, { ok: true }>['vod'] = null;
  if (reference.vod && !reference.vod.vodReviewId) return { ok: false, reason: 'vod-not-found' };
  if (reference.vod?.vodReviewId) {
    const reviews = located?.location === 'archived' ? (located.container.vodReviews || []) : (db.vodReviews || []);
    const review = reviews.find((item: any) => item?.id === reference.vod!.vodReviewId);
    if (!review || (reference.matchId && review.matchId && review.matchId !== reference.matchId)) return { ok: false, reason: 'vod-not-found' };
    if (reference.vod.noteId && !(review.notes || []).some((note: any) => note?.id === reference.vod!.noteId)) return { ok: false, reason: 'vod-not-found' };
    if (review.status === 'rejected') storedState = 'rejected';
    vod = { vodReviewId: review.id };
  }

  if (reference.scope.ownerDeviceId && ownerDeviceIds.size && !ownerDeviceIds.has(reference.scope.ownerDeviceId)) return { ok: false, reason: 'owner-device-mismatch' };

  // A reference may never claim acceptance or rejection that storage does not
  // currently hold. Draft references remain valid after later acceptance.
  if (reference.state === 'accepted' && storedState !== 'accepted') return { ok: false, reason: 'state-mismatch' };
  if (reference.state === 'rejected' && storedState !== 'rejected') return { ok: false, reason: 'state-mismatch' };

  return {
    ok: true, reference, storedState, match, round, replay, screenshot, vod,
    identities: reference.observedIdentities.map(observed => ({ observed, current: observed.playerId ? currentIdentity(db, observed.playerId) : null })),
  };
}

export const evidenceReferenceInternals = { canonical, ID, WORKSPACE_ID, MAX_IDENTITIES, MAX_FIELD_PROVENANCE };
