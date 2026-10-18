import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { readDB, saveDB, DB_PATH } from '../store';
import { publishVerifiedReplayTemp, reserveReplayUpload, sha256ReplayFile } from '../replayIntakeSafety';
import { buildReplayOpeningReviewDraft } from '../replayOpeningEngine';
import { loadVrfkitPipelineConfig, runVrfkitReplayPipeline, VRFKIT_PIN } from '../vrfkitReplayPipeline';
import { calculateShadowPlayerRating, type PlayerRatingInput } from '../playerRatingEngine';
import { validateLocalReplayEvidence } from '../replayEvidence';
import { extractScoreboardScreenshot } from './aiVision';
import { buildScreenshotReviewDraft } from '../entryEngine';
import { localScreenshotSubmissionSchema } from '../../schemas';
import { pairReplayScreenshots, pruneScreenshotPairings, screenshotAdmission, screenshotPairingPublic, screenshotRecordId, validatePairingImage, type ScreenshotPairing } from '../replayScreenshotPairing';
import { activeCorePlayerIds, ensureObservedRosterPlayer, setObservedRosterStatus } from '../roster';
import { cancelRawReplayUpload, deleteRawReplayObject, downloadRawReplayObject, initiateRawReplayUpload, verifyRawReplayObject, type RawReplayObject } from '../gcsReplayTemp';
import { clientIp, requestRateLimit } from '../utils';
import { historicalPlayerLabel, mergeAcceptedPlayerStat, preserveIdentitySnapshot } from '../identitySnapshot';
import { replayScreenshotReconciliation } from '../ocrLearning';
import { confusableCaptureKey, normalizeCaptureName } from '../scrimCaptureImport';

const REPLAY_TYPE = 'application/vnd.valorant.replay';
const MAX_REPLAY_BYTES = Number(process.env.REPLAY_MAX_BYTES || 2 * 1024 * 1024 * 1024);
const MAX_UPLOAD_MS = Number(process.env.REPLAY_UPLOAD_TIMEOUT_MS || 10 * 60 * 1000);
const DEVICE_TTL_MS = Number(process.env.REPLAY_DEVICE_TTL_MS || 90 * 24 * 60 * 60 * 1000);
const PRIVATE_DIR = path.resolve(process.env.REPLAY_STORAGE_DIR || path.join(path.dirname(DB_PATH), 'private-replays'));
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const DEVICE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const uploadLocks = new Map<string, Promise<void>>();
const parserSchedulerActive = new Set<string>();
let parserSchedulerPumping = false;
let parserRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
const rawSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const screenshotRequests = new Set<string>();
const PARSER_INSTANCE_ID = `${process.env.K_REVISION || process.env.HOSTNAME || 'local'}:${process.pid}`;

function boundedEnvInteger(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

function parserLimits() {
  return {
    concurrent: boundedEnvInteger('VRFKIT_MAX_CONCURRENT_JOBS', 1, 4),
    queued: boundedEnvInteger('VRFKIT_MAX_QUEUED_JOBS', 8, 32),
    perActor: boundedEnvInteger('VRFKIT_MAX_ACTOR_ACTIVE_JOBS', 2, 8),
    perDevice: boundedEnvInteger('VRFKIT_MAX_DEVICE_ACTIVE_JOBS', 2, 8),
    retained: boundedEnvInteger('VRFKIT_RETAINED_JOB_COUNT', 100, 500),
    retentionMs: boundedEnvInteger('VRFKIT_JOB_RETENTION_MS', 30 * 24 * 60 * 60 * 1000, 180 * 24 * 60 * 60 * 1000),
    evidenceBytes: boundedEnvInteger('VRFKIT_MAX_RETAINED_EVIDENCE_BYTES', 4 * 1024 * 1024, 8 * 1024 * 1024),
    leaseMs: boundedEnvInteger('VRFKIT_JOB_LEASE_MS', 60_000, 10 * 60 * 1000),
  };
}

function assertPrivateStorageRoot() {
  for (const relative of ['dist', 'fb-public', 'public']) {
    const staticRoot = path.resolve(process.cwd(), relative); const relation = path.relative(staticRoot, PRIVATE_DIR);
    if (!relation || (!relation.startsWith('..') && !path.isAbsolute(relation))) throw new Error('REPLAY_STORAGE_DIR must be outside static/frontend asset directories.');
  }
}

type Actor = { role: 'coach' | 'player'; username: string; playerId?: string; actorId: string };
type DeviceRecord = {
  id: string; name: string; tokenHash: string; credentialVersion: number;
  owner: { actorId: string; role: 'coach' | 'player'; playerId: string | null };
  createdAt: string; expiresAt: string; revokedAt: string | null; lastSeenAt: string | null;
};

type ReplayBlob = { sha256: string; size: number; storedAt: string; ingestionMode?: 'local-evidence' | 'coach-raw' | 'legacy-raw'; uploadStatus?: 'uploading' | 'verified' | 'processed' | 'deleted' | 'failed'; rawObject?: RawReplayObject | null; parserStatus: 'unavailable' | 'pending' | 'parsed-review-required' | 'failed'; parserJobId?: string | null; evidenceHash?: string; reviewStatus: 'review-required' | 'accepted'; matchId: string | null };
type ReplayAssociation = { id: string; sha256: string; size: number; originalName: string; deviceId: string; owner: DeviceRecord['owner']; receivedAt: string };
type ReplayParserJob = {
  id: string; sha256: string; requestedBy: string; status: 'queued' | 'running' | 'completed' | 'failed';
  sourceDeviceIds: string[];
  createdAt: string; startedAt: string | null; completedAt: string | null;
  parser: { name: 'vrfkit'; version: string }; reviewStatus: 'review-required';
  result?: { scoreboard: any; reviewDraft: any; diagnostics: any };
  failure?: { code: string; message: string };
  lease?: { owner: string; expiresAt: string; heartbeatAt: string; fence: number } | null;
  leaseFence?: number;
  rawObject?: RawReplayObject | null;
};
type ReplayMapping = { parserPlayerId: string; rosterPlayerId: string | null; displayName: string };
type ReplayReview = {
  sha256: string; matchId: string; teamId: string; mappings: ReplayMapping[]; status: 'review-required' | 'accepted';
  revision: number; requestId: string; requestHash: string; rawEvidenceHash: string; updatedAt: string;
  acceptedAt: string | null; acceptedBy: string | null; ratingDraftKeys: string[];
  screenshotLinks?: Array<{ id: string; imageSha256: string; replaySha256: string }>;
};
type RawUploadSession = { uploadId: string; sha256: string; size: number; originalName: string; deviceId: string; owner: DeviceRecord['owner']; bucket: string; object: string; uploadUrl: string; expiresAt: string; createdAt: string };
type RawFinalizeReceipt = { uploadId: string; deviceId: string; response: Record<string, any>; createdAt: string };
type PairingCode = { codeHash: string; owner: DeviceRecord['owner']; createdAt: string; expiresAt: string; createdBy: string };
type ReplayStore = { schemaVersion: number; devices: Record<string, DeviceRecord>; blobs: Record<string, ReplayBlob>; associations: Record<string, ReplayAssociation>; parserJobs: Record<string, ReplayParserJob>; reviews: Record<string, ReplayReview>; rawSessions: Record<string, RawUploadSession>; rawReceipts: Record<string, RawFinalizeReceipt>; screenshots: Record<string, ScreenshotPairing>; pairingCodes: Record<string, PairingCode>; uploads?: Record<string, any> };

function associationKey(deviceId: string, hash: string) { return crypto.createHash('sha256').update(`${deviceId}\0${hash}`).digest('hex'); }
function newDeviceId() { return `d_${crypto.randomBytes(18).toString('base64url')}`; }
function retainedEvidenceHash(store: ReplayStore, sha256: string, blob?: ReplayBlob) {
  if (blob?.evidenceHash) return blob.evidenceHash;
  const job = blob?.parserJobId ? store.parserJobs[blob.parserJobId] : null;
  if (job?.result) return contentHash(job.result);
  return store.reviews[sha256]?.rawEvidenceHash || null;
}

function replayStore(db: any) {
  db.replayIntake ||= { schemaVersion: 5, devices: {}, blobs: {}, associations: {}, parserJobs: {}, reviews: {}, rawSessions: {}, rawReceipts: {} };
  db.replayIntake.devices ||= {};
  db.replayIntake.blobs ||= {};
  db.replayIntake.associations ||= {};
  db.replayIntake.parserJobs ||= {};
  db.replayIntake.reviews ||= {};
  db.replayIntake.rawSessions ||= {};
  db.replayIntake.rawReceipts ||= {};
  db.replayIntake.screenshots ||= {};
  db.replayIntake.pairingCodes ||= {};
  // One-time in-memory migration from the first local-only schema. Responses never read legacy records directly.
  for (const [hash, record] of Object.entries(db.replayIntake.uploads || {}) as Array<[string, any]>) {
    db.replayIntake.blobs[hash] ||= { sha256: hash, size: record.size, storedAt: record.receivedAt, parserStatus: record.parserStatus || 'unavailable', reviewStatus: 'review-required', matchId: record.matchId || null };
    if (record.deviceId) db.replayIntake.associations[associationKey(record.deviceId, hash)] ||= { id: record.id, sha256: hash, size: record.size, originalName: record.originalName, deviceId: record.deviceId, owner: record.owner, receivedAt: record.receivedAt };
  }
  delete db.replayIntake.uploads;
  db.replayIntake.schemaVersion = 5;
  return db.replayIntake as ReplayStore;
}

const tokenHash = (token: string) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

function actor(req: Request): Actor { return (req as any).user as Actor; }
function devicePublic(device: DeviceRecord) {
  return {
    id: device.id, name: device.name, owner: { role: device.owner.role, playerId: device.owner.playerId }, createdAt: device.createdAt,
    expiresAt: device.expiresAt, revokedAt: device.revokedAt, lastSeenAt: device.lastSeenAt,
    status: device.revokedAt ? 'revoked' : Date.parse(device.expiresAt) <= Date.now() ? 'expired' : 'active',
  };
}

function cleanDeviceName(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean.length >= 2 && clean.length <= 80 && /^[\p{L}\p{N} ._()'-]+$/u.test(clean) ? clean : null;
}

function cleanReplayName(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = path.basename(value.trim());
  if (clean !== value.trim() || clean.length < 5 || clean.length > 180 || !/^[A-Za-z0-9 ._()-]+\.vrf$/i.test(clean)) return null;
  return clean;
}

function sanitizedScoreboardEvidence(value: any) {
  const rows = value?.schemaVersion === 1 && Array.isArray(value.scoreboardPlayers) ? value.scoreboardPlayers : null;
  if (!rows) return null;
  if (rows.length !== 10) throw Object.assign(new Error('Screenshot scoreboard evidence must contain ten players.'), { status: 400 });
  const numeric = (raw: any) => raw === null || raw === undefined ? null : Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
  const scoreboardPlayers = rows.map((row: any) => {
    const name = cleanText(row?.name, 80); const agent = row?.agent === null || row?.agent === undefined ? null : cleanText(row.agent, 40);
    if (!name || (row?.agent !== null && row?.agent !== undefined && !agent) || typeof row?.allied !== 'boolean') throw Object.assign(new Error('Screenshot scoreboard identity is invalid.'), { status: 400 });
    const output: any = { name, agent, allied: row.allied };
    for (const field of ['kills', 'deaths', 'assists', 'fk', 'trades', 'plants', 'defuses']) {
      const parsed = numeric(row?.[field]); if (parsed === undefined) throw Object.assign(new Error('Screenshot scoreboard metric is invalid.'), { status: 400 }); output[field] = parsed;
    }
    return output;
  });
  if (scoreboardPlayers.filter((row: any) => row.allied).length !== 5) throw Object.assign(new Error('Screenshot scoreboard evidence must identify exactly five allied players.'), { status: 400 });
  return { schemaVersion: 1, captureId: typeof value.captureId === 'string' ? value.captureId.slice(0, 128) : null, scoreboardPlayers };
}

function actorForDevice(device: DeviceRecord): Actor {
  return { actorId: device.owner.actorId, role: device.owner.role, playerId: device.owner.playerId || undefined, username: device.owner.role === 'coach' ? 'Desktop coach' : 'Desktop player' };
}

function privateReplayPath(hash: string) {
  const target = path.resolve(PRIVATE_DIR, hash.slice(0, 2), `${hash}.vrf`);
  if (!target.startsWith(`${PRIVATE_DIR}${path.sep}`)) throw new Error('Replay storage path escaped its private root.');
  return target;
}

async function acquireUploadLock(hash: string) {
  const prior = uploadLocks.get(hash) || Promise.resolve(); let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; }); const tail = prior.then(() => current); uploadLocks.set(hash, tail);
  await prior;
  return () => { release(); if (uploadLocks.get(hash) === tail) uploadLocks.delete(hash); };
}

async function authenticateDevice(req: Request) {
  const id = String(req.header('x-device-id') || '');
  const token = String(req.header('x-device-token') || '');
  if (!DEVICE_ID.test(id) || token.length < 43 || token.length > 256) return null;
  const db = await readDB(); const store = replayStore(db); const device = store.devices[id];
  if (!device || device.revokedAt || Date.parse(device.expiresAt) <= Date.now() || !safeEqual(device.tokenHash, tokenHash(token))) return null;
  if (device.owner.playerId && !(db.rosterPlayers || []).some((player: any) => player.id === device.owner.playerId && !player.retiredAt)) return null;
  return { db, store, device };
}

function uploadPublic(record: ReplayAssociation, blob: ReplayBlob) {
  return {
    id: record.id, sha256: record.sha256, size: record.size, originalName: record.originalName,
    deviceId: record.deviceId, receivedAt: record.receivedAt,
    ingestionMode: blob.ingestionMode || 'legacy-raw', uploadStatus: blob.uploadStatus || 'stored-private', parserStatus: blob.parserStatus || 'unavailable',
    rawObjectStatus: blob.rawObject?.status || null,
    reviewStatus: blob.reviewStatus || 'review-required', matchId: blob.matchId || null,
  };
}

function parserJobPublic(job: ReplayParserJob) {
  return {
    id: job.id, sha256: job.sha256, status: job.status, createdAt: job.createdAt,
    startedAt: job.startedAt, completedAt: job.completedAt, parser: job.parser,
    reviewStatus: job.reviewStatus, ...(job.result ? { result: job.result } : {}),
    ...(job.failure ? { failure: job.failure } : {}),
  };
}

function parserJobStatusPublic(job: ReplayParserJob, reviewStatus: ReplayBlob['reviewStatus']) {
  return { id: job.id, sha256: job.sha256, status: job.status, createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt, parser: job.parser, reviewStatus, ...(job.failure ? { failure: job.failure } : {}) };
}

const canonical = (value: unknown) => JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested);
const contentHash = (value: unknown) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const cleanText = (value: unknown, maximum = 120) => typeof value === 'string' && value.trim() && value.trim().length <= maximum ? value.trim() : null;
const evidenceNumber = (value: any) => value?.status === 'available' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
const evidenceText = (value: any) => value?.status === 'available' && typeof value.value === 'string' && value.value.trim() ? value.value.trim() : null;

function normalizeReview(body: any, job: ReplayParserJob, db: any): Omit<ReplayReview, 'sha256' | 'status' | 'revision' | 'requestId' | 'requestHash' | 'rawEvidenceHash' | 'updatedAt' | 'acceptedAt' | 'acceptedBy' | 'ratingDraftKeys'> {
  const matchId = cleanText(body?.matchId); const teamId = cleanText(body?.teamId);
  if (!matchId || !(db.matches || []).some((match: any) => match.id === matchId)) throw Object.assign(new Error('Choose an active-season match.'), { status: 409 });
  const players = job.result?.scoreboard?.players;
  if (!Array.isArray(players) || !players.length || !teamId) throw Object.assign(new Error('Parsed scoreboard evidence and our team are required.'), { status: 409 });
  const teamIds = new Set(players.map((item: any) => item.teamId));
  if (!teamIds.has(teamId)) throw Object.assign(new Error('Our team must match a parsed scoreboard team.'), { status: 400 });
  if (!Array.isArray(body?.mappings) || body.mappings.length !== players.length) throw Object.assign(new Error('Every parsed player needs an explicit review mapping.'), { status: 400 });
  const parserIds = new Set<string>(); const rosterIds = new Set<string>(); const rawIds = new Set(players.map((item: any) => item.playerId));
  const activeRoster = new Map((db.rosterPlayers || []).filter((item: any) => !item.retiredAt).map((item: any) => [item.id, item]));
  const mappings = body.mappings.map((item: any): ReplayMapping => {
    const parserPlayerId = cleanText(item?.parserPlayerId); const rosterPlayerId = item?.rosterPlayerId === null || item?.rosterPlayerId === '' ? null : cleanText(item?.rosterPlayerId); const displayName = cleanText(item?.displayName, 80);
    if (!parserPlayerId || !rawIds.has(parserPlayerId) || parserIds.has(parserPlayerId) || !displayName) throw Object.assign(new Error('Player mappings contain an unknown or duplicate parser identity.'), { status: 400 });
    parserIds.add(parserPlayerId);
    if (rosterPlayerId && (!activeRoster.has(rosterPlayerId) || rosterIds.has(rosterPlayerId))) throw Object.assign(new Error('Roster mappings contain an unknown or duplicate active player.'), { status: 409 });
    if (rosterPlayerId) rosterIds.add(rosterPlayerId);
    return { parserPlayerId, rosterPlayerId, displayName };
  });
  const mappingById = new Map<string, ReplayMapping>(mappings.map(item => [item.parserPlayerId, item]));
  for (const player of players) {
    const mapping = mappingById.get(player.playerId)!;
    if (player.teamId === teamId && !mapping.rosterPlayerId) throw Object.assign(new Error('Every player on our selected team must map to an active roster identity.'), { status: 409 });
    if (player.teamId !== teamId && mapping.rosterPlayerId) throw Object.assign(new Error('Opponent rows cannot be mapped into our roster.'), { status: 409 });
  }
  return { matchId, teamId, mappings };
}

function replayReviewPublic(review: ReplayReview | undefined) {
  if (!review) return null;
  return { sha256: review.sha256, matchId: review.matchId, teamId: review.teamId, mappings: review.mappings, status: review.status, revision: review.revision, rawEvidenceHash: review.rawEvidenceHash, updatedAt: review.updatedAt, acceptedAt: review.acceptedAt, ratingDraftKeys: review.ratingDraftKeys, screenshotLinks: review.screenshotLinks || [] };
}

function ratingMode(match: any) {
  const value = String(match?.type || '').toLowerCase();
  if (value.includes('scrim')) return 'scrim'; if (value.includes('premier')) return 'premier'; if (value.includes('ranked')) return 'ranked'; if (value.includes('custom')) return 'custom'; return 'other';
}

function acceptReviewIntoEngines(db: any, store: ReplayStore, job: ReplayParserJob, review: ReplayReview, user: Actor, requestId: string, requestHash: string) {
  const result = job.result!; const scoreboard = result.scoreboard; const draft = result.reviewDraft; const matchIndex = (db.matches || []).findIndex((item: any) => item.id === review.matchId);
  if (matchIndex < 0) throw Object.assign(new Error('The linked match is no longer active.'), { status: 409 });
  const match = db.matches[matchIndex]; const map = evidenceText(scoreboard.map); const teamA = scoreboard.finalScore?.teamA; const teamB = scoreboard.finalScore?.teamB;
  const ours = teamA?.teamId === review.teamId ? teamA : teamB?.teamId === review.teamId ? teamB : null; const theirs = ours === teamA ? teamB : teamA;
  const acceptedAt = new Date().toISOString();
  const matchCorrected = correctedFields(match);
  db.matches[matchIndex] = { ...match,
    map: mergeVerifiedField(match, 'map', map, matchCorrected),
    ourScore: mergeVerifiedField(match, 'ourScore', evidenceNumber(ours?.score), matchCorrected),
    theirScore: mergeVerifiedField(match, 'theirScore', evidenceNumber(theirs?.score), matchCorrected),
    source: 'Replay review', sourceMetadata: { method: 'provider-import', capturedAt: acceptedAt, provider: 'vrfkit', externalId: review.sha256 }, corrections: [...(match.corrections || []), { correctedAt: acceptedAt, correctedBy: user.username, fields: ['replay-evidence-overlay'] }] };
  const mapping = new Map<string, ReplayMapping>(review.mappings.filter(item => item.rosterPlayerId).map(item => [item.parserPlayerId, item]));
  const rawRows = new Map<string, any>((scoreboard.players || []).map((item: any) => [item.playerId, item]));
  const metricRows = new Map<string, any>((draft.evidence?.playerMetrics || []).map((item: any) => [item.playerId, item]));
  const existingMatchRows = (db.playerStats || []).filter((item: any) => item.matchId === review.matchId);
  const existingRows = new Map<string, any>(existingMatchRows.filter((item: any) => item.playerId).map((item: any) => [item.playerId, item]));
  const existingRowsByName = new Map<string, any[]>();
  for (const row of existingMatchRows) {
    const key = confusableCaptureKey(normalizeCaptureName(row.displayNameSnapshot || row.player));
    if (key) existingRowsByName.set(key, [...(existingRowsByName.get(key) || []), row]);
  }
  const activeCoreIds = new Set((db.coreMemberships || []).filter((item: any) => !item.endedAt).map((item: any) => item.playerId));
  const claimedExistingRowIds = new Set<string>();
  const acceptedRows = [...mapping.entries()].map(([parserPlayerId, overlay]) => {
    const raw: any = rawRows.get(parserPlayerId) || {}; const metrics: any = metricRows.get(parserPlayerId) || {};
    const nameMatches = existingRowsByName.get(confusableCaptureKey(normalizeCaptureName(overlay.displayName))) || [];
    const storedNumber = (value: any) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const kdaMatches = existingMatchRows.filter((row: any) => !claimedExistingRowIds.has(row.id)
      && storedNumber(row.kills) === evidenceNumber(raw.kills)
      && storedNumber(row.deaths) === evidenceNumber(raw.deaths)
      && storedNumber(row.assists) === evidenceNumber(raw.assists));
    const existing: any = existingRows.get(overlay.rosterPlayerId)
      || (nameMatches.length === 1 ? nameMatches[0] : undefined)
      || (kdaMatches.length === 1 ? kdaMatches[0] : undefined);
    if (existing?.id) claimedExistingRowIds.add(existing.id);
    const corrected = correctedFields(existing); const replay: Record<string, any> = { kills: evidenceNumber(raw.kills) ?? metrics.kills ?? null, deaths: evidenceNumber(raw.deaths) ?? metrics.deaths ?? null, assists: evidenceNumber(raw.assists) ?? metrics.assists ?? null, acs: null, adr: metrics.damage === null || metrics.damage === undefined || !draft.coverage?.playedRounds ? null : metrics.damage / draft.coverage.playedRounds, hs: metrics.headshotPercentage ?? null, headshots: metrics.headshotKills ?? null, headshotEligibleKills: metrics.eligibleHeadshotKills ?? null, orbPoints: metrics.orbCaptures ?? null, ultimateUses: metrics.ultimateUses ?? null, kastSuccessful: metrics.kastSuccessful ?? null, kastCovered: metrics.kastCovered ?? null, fk: evidenceNumber(raw.firstBloods), fd: evidenceNumber(raw.firstDeaths), plants: evidenceNumber(raw.plants), defuses: evidenceNumber(raw.defuses) };
    const facts = Object.fromEntries(Object.entries(replay).map(([field, value]) => [field, mergeVerifiedField(existing, field, value, corrected)]));
    const accepted = { ...existing, id: existing?.id || `replay:${review.matchId}:${overlay.rosterPlayerId}`, matchId: review.matchId, playerId: overlay.rosterPlayerId, player: overlay.displayName, displayNameSnapshot: overlay.displayName, appearanceType: existing?.appearanceType || (activeCoreIds.has(overlay.rosterPlayerId) ? 'core' : 'standIn'), agent: evidenceText(raw.agent) || existing?.agent || 'Unknown', ...facts, sourceMetadata: { method: 'provider-import', capturedAt: acceptedAt, provider: 'vrfkit', externalId: review.sha256 }, evidenceReconciliation: replayScreenshotReconciliation(existing, replay, acceptedAt), corrections: [...(existing?.corrections || []), { correctedAt: review.updatedAt, correctedBy: user.username, fields: ['player-name-mapping'] }] };
    return preserveIdentitySnapshot(existing, accepted);
  });
  const replacedPlayerIds = new Set(acceptedRows.map((item: any) => item.playerId));
  const replacedRowIds = new Set(acceptedRows.map((item: any) => item.id));
  db.playerStats = [...(db.playerStats || []).filter((item: any) => item.matchId !== review.matchId || (!replacedRowIds.has(item.id) && !replacedPlayerIds.has(item.playerId))), ...acceptedRows];
  const displayNames = new Map(review.mappings.map(item => [item.parserPlayerId, item.displayName]));
  const openingByRound = new Map((draft.rounds || []).map((item: any) => [item.roundNumber, item]));
  const acceptedRounds = (draft.evidence?.rounds || []).map((round: any) => {
    const opening: any = openingByRound.get(round.roundNumber) || {};
    const side = round.sideByTeam?.[review.teamId];
    const clutch = Array.isArray(round.derived?.clutches) ? round.derived.clutches.find((item: any) => displayNames.has(item.playerId)) : null;
    const existing = (db.rounds || []).find((item: any) => item.matchId === review.matchId && item.roundNo === round.roundNumber) || {};
    const corrected = correctedFields(existing); const replaySide = side === 'attack' ? 'Attack' : side === 'defense' ? 'Defense' : null;
    const replayRound = { side: replaySide, result: round.winnerTeamId ? (round.winnerTeamId === review.teamId ? 'W' : 'L') : null, winBy: round.endReason || null,
      firstKillBy: opening.status === 'resolved' ? displayNames.get(opening.firstKillPlayerId) || opening.firstKillPlayerId || null : null,
      firstDeathBy: opening.status === 'resolved' ? displayNames.get(opening.firstDeathPlayerId) || opening.firstDeathPlayerId || null : null };
    return { ...existing,
      id: existing.id || `replay:${review.matchId}:round:${round.roundNumber}`, matchId: review.matchId, roundNo: round.roundNumber,
      side: mergeVerifiedField(existing, 'side', replaySide, corrected),
      result: mergeVerifiedField(existing, 'result', round.winnerTeamId ? (round.winnerTeamId === review.teamId ? 'W' : 'L') : null, corrected),
      winBy: mergeVerifiedField(existing, 'winBy', round.endReason || null, corrected),
      firstKillBy: mergeVerifiedField(existing, 'firstKillBy', opening.status === 'resolved' ? displayNames.get(opening.firstKillPlayerId) || opening.firstKillPlayerId || null : null, corrected),
      firstDeathBy: mergeVerifiedField(existing, 'firstDeathBy', opening.status === 'resolved' ? displayNames.get(opening.firstDeathPlayerId) || opening.firstDeathPlayerId || null : null, corrected),
      clutchType: mergeVerifiedField(existing, 'clutchType', clutch?.opponents ? `1v${clutch.opponents}` : null, corrected), clutchPlayer: mergeVerifiedField(existing, 'clutchPlayer', clutch ? displayNames.get(clutch.playerId) || clutch.playerId : null, corrected),
      clutchResult: mergeVerifiedField(existing, 'clutchResult', clutch?.result === 'won' ? 'W' : clutch?.result === 'lost' ? 'L' : null, corrected),
      sourceMetadata: { method: 'provider-import', capturedAt: acceptedAt, provider: 'vrfkit', externalId: review.sha256 },
      replayEvidence: { tradeOpportunities: round.derived?.tradeOpportunities ?? null, successfulTrades: round.derived?.successfulTrades ?? null, tacticalAssessment: 'unreviewed' },
      evidenceReconciliation: replayScreenshotReconciliation(existing, replayRound, acceptedAt),
      corrections: existing.corrections || [],
    };
  });
  const replacedRoundNumbers = new Set(acceptedRounds.map((item: any) => item.roundNo));
  db.rounds = [...(db.rounds || []).filter((item: any) => item.matchId !== review.matchId || !replacedRoundNumbers.has(item.roundNo)), ...acceptedRounds];
  db.engineAdapters ||= { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: {}, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } };
  db.engineAdapters.replay ||= {}; db.engineAdapters.ratings ||= { configs: {}, records: {}, formulaVersions: {}, baselineVersions: {} }; db.engineAdapters.ratings.records ||= {}; db.engineAdapters.ratings.configs ||= {};
  const priorReplay = db.engineAdapters.replay[review.matchId];
  if (priorReplay?.status === 'accepted' && priorReplay?.provenance?.replaySha256 !== review.sha256) throw Object.assign(new Error('This match already has different accepted replay evidence.'), { status: 409 });
  db.engineAdapters.replay[review.matchId] = { matchId: review.matchId, status: 'accepted', acceptedAt, acceptedBy: user.actorId, draft: structuredClone(draft), overlay: structuredClone(review), provenance: { replaySha256: review.sha256, rawEvidenceHash: review.rawEvidenceHash, parser: job.parser, screenshotLinks: structuredClone(review.screenshotLinks || []), materializationVersion: 2 }, revision: (priorReplay?.revision || 0) + 1, requestId, requestHash, updatedAt: acceptedAt };
  const mode = ratingMode(match); const rounds = draft.coverage?.playedRounds || 0; const ratingDraftKeys: string[] = [];
  for (const config of Object.values(db.engineAdapters.ratings.configs) as any[]) {
    if (config?.baseline?.mode !== mode || !config?.formula || !config?.baseline) continue;
    for (const row of acceptedRows) {
      const parserId = [...mapping.entries()].find(([, item]) => item.rosterPlayerId === row.playerId)?.[0];
      const metric = parserId ? metricRows.get(parserId) as any : undefined; const raw = parserId ? rawRows.get(parserId) as any : undefined;
      const count = (value: any) => typeof value === 'number' && Number.isFinite(value) && rounds > 0 ? { value: value / rounds, samples: rounds } : { value: null, samples: 0 };
      const input: PlayerRatingInput = { context: { playerId: row.playerId, displayName: historicalPlayerLabel(row), mode, source: structuredClone(config.baseline.source), appearance: row.appearanceType || 'unclassified', rosterKind: match.rosterContext?.kind || 'unclassified', tryoutBatchId: match.rosterContext?.tryoutBatchId || null, matchIds: [review.matchId], rounds, maps: [map || match.map].filter(Boolean), agents: row.agent && row.agent !== 'Unknown' ? [row.agent] : [], roles: [] }, metrics: { killsPerRound: count(evidenceNumber(raw?.kills) ?? metric?.kills), deathsPerRound: count(evidenceNumber(raw?.deaths) ?? metric?.deaths), assistsPerRound: count(evidenceNumber(raw?.assists) ?? metric?.assists), averageDamagePerRound: count(metric?.damage), kastRate: typeof metric?.kastRate === 'number' && typeof metric?.kastCovered === 'number' ? { value: metric.kastRate, samples: metric.kastCovered } : { value: null, samples: 0 }, firstKillsPerRound: count(evidenceNumber(raw?.firstBloods)), firstDeathsPerRound: count(evidenceNumber(raw?.firstDeaths)) } };
      // This handoff creates one review artifact per accepted match. The general
      // rating adapter may intentionally replace an aggregate series snapshot, but
      // replay acceptance must not erase the prior match's auditable source input.
      const calculated = calculateShadowPlayerRating(input, config.baseline, config.formula); const recordKey = `${calculated.context.playerId}:${calculated.seriesKey}:match:${review.matchId}`; const current = db.engineAdapters.ratings.records[recordKey];
      db.engineAdapters.ratings.records[recordKey] = { recordKey, status: 'review-required', acceptedAt: null, calibrationStatus: config.calibrationStatus, experimental: config.calibrationStatus !== 'calibrated', input, configKey: config.key, result: calculated, provenance: { replaySha256: review.sha256, reviewRevision: review.revision + 1 }, revision: (current?.revision || 0) + 1, requestId: `${requestId}:${row.playerId}`, requestHash, updatedAt: acceptedAt };
      ratingDraftKeys.push(recordKey);
    }
  }
  return { acceptedAt, ratingDraftKeys };
}

function cairoDate(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Finish the ordinary desktop path without a confirmation dialog. Automation
 * is deliberately evidence-gated: ten unique K/D/A rows, one replay, and one
 * unambiguous five-player scoreboard side. Anything weaker remains an inbox
 * draft while unrelated replays continue processing.
 */
function autoFinalizeDesktopReplay(db: any, store: ReplayStore, sha256: string, user: Actor) {
  const blob = store.blobs[sha256]; const job = blob?.parserJobId ? store.parserJobs[blob.parserJobId] : null;
  if (!blob || !job?.result || job.status !== 'completed' || blob.reviewStatus === 'accepted' || store.reviews[sha256]) return null;
  const linked = Object.values(store.screenshots).filter(item => (item.deviceId.startsWith('desktop-') || !!item.targetMatchId) && item.status === 'linked' && item.replaySha256 === sha256);
  if (linked.length !== 1) return null;
  const screenshot = linked[0]; const players = job.result.scoreboard?.players;
  if (!Array.isArray(players) || players.length !== 10 || screenshot.suggestions.length !== 10) return null;
  const byId = new Map(players.map((player: any) => [player.playerId, player]));
  if (new Set(screenshot.suggestions.map(item => item.parserPlayerId)).size !== 10) return null;
  const rosterTeamIds = new Set(screenshot.suggestions.filter(item => item.rosterPlayerId).map(item => (byId.get(item.parserPlayerId) as any)?.teamId).filter(Boolean));
  const rosterMapped = screenshot.suggestions.filter(item => item.rosterPlayerId).length;
  const scoreTeams = [job.result.scoreboard.finalScore?.teamA, job.result.scoreboard.finalScore?.teamB].filter((team: any) => team?.teamId);
  const hintedOurScore = screenshot.draft.match?.ourScore; const hintedTheirScore = screenshot.draft.match?.theirScore;
  const scoreMatches = scoreTeams.filter((candidate: any) => evidenceNumber(candidate.score) === hintedOurScore
    && scoreTeams.some((other: any) => other !== candidate && evidenceNumber(other.score) === hintedTheirScore));
  const fallbackTeamIds = new Set(screenshot.suggestions.filter(item => item.screenshotTeam === 'ours').map(item => (byId.get(item.parserPlayerId) as any)?.teamId).filter(Boolean));
  const teamId = rosterMapped === 5 && rosterTeamIds.size === 1 ? [...rosterTeamIds][0] as string
    : scoreMatches.length === 1 ? scoreMatches[0].teamId
      : fallbackTeamIds.size === 1 ? [...fallbackTeamIds][0] as string : null;
  if (!teamId) return null;
  const ours = screenshot.suggestions.filter(item => (byId.get(item.parserPlayerId) as any)?.teamId === teamId);
  const theirs = screenshot.suggestions.filter(item => (byId.get(item.parserPlayerId) as any)?.teamId !== teamId);
  if (ours.length !== 5 || theirs.length !== 5) return null;

  const hasCore = activeCorePlayerIds(db).size > 0;
  const mappings: ReplayMapping[] = screenshot.suggestions.map(item => {
    if ((byId.get(item.parserPlayerId) as any)?.teamId !== teamId) return { parserPlayerId: item.parserPlayerId, rosterPlayerId: null, displayName: item.displayName };
    let roster = (db.rosterPlayers || []).find((player: any) => player.id === item.rosterPlayerId && !player.retiredAt);
    roster ||= (db.rosterPlayers || []).find((player: any) => String(player.displayName || '').trim().toLocaleLowerCase('en') === item.displayName.trim().toLocaleLowerCase('en'));
    if (!roster) {
      const key = confusableCaptureKey(normalizeCaptureName(item.displayName));
      const candidates = (db.rosterPlayers || []).filter((player: any) => player.retiredAt && confusableCaptureKey(normalizeCaptureName(player.displayName)) === key);
      if (candidates.length === 1) roster = candidates[0];
    }
    roster ||= ensureObservedRosterPlayer(db, item.displayName);
    if (!roster.retiredAt && !roster.rosterStatus) setObservedRosterStatus(db, { playerId: roster.id, displayName: roster.displayName, status: hasCore ? 'standIn' : 'tryout' });
    return { parserPlayerId: item.parserPlayerId, rosterPlayerId: roster.id, displayName: item.displayName };
  });

  const board = job.result.scoreboard; const teamA = board.finalScore?.teamA; const teamB = board.finalScore?.teamB;
  const ourBoard = teamA?.teamId === teamId ? teamA : teamB?.teamId === teamId ? teamB : null; const theirBoard = ourBoard === teamA ? teamB : teamA;
  const map = evidenceText(board.map); const ourScore = evidenceNumber(ourBoard?.score); const theirScore = evidenceNumber(theirBoard?.score);
  const date = cairoDate(screenshot.draft.sourceMetadata?.capturedAt || screenshot.createdAt);
  const normalizedMap = String(map || '').trim().toLocaleLowerCase();
  const candidates = (db.matches || []).filter((match: any) => match.date === date && String(match.map || '').trim().toLocaleLowerCase() === normalizedMap
    && match.ourScore === ourScore && match.theirScore === theirScore && !db.engineAdapters?.replay?.[match.id]);
  // Match rows are append-ordered. When a coach has accidentally logged the
  // same map/score more than once, prefer the newest unlinked row instead of
  // creating yet another duplicate; the result remains editable afterward.
  // A synchronized full-capture summary already has a stable match id. Use it
  // even when the VALORANT summary header was stale (notably wrong map/score);
  // exact ten-player evidence is what established the replay link.
  let match = screenshot.targetMatchId
    ? (db.matches || []).find((item: any) => item.id === screenshot.targetMatchId && !db.engineAdapters?.replay?.[item.id]) || null
    : candidates.at(-1) || null;
  if (!match) {
    const activeBatch = (db.tryoutBatches || []).find((batch: any) => batch.status === 'active' && batch.id === db.settings?.activeTryoutBatchId)
      || (db.tryoutBatches || []).find((batch: any) => batch.status === 'active');
    match = { id: crypto.randomUUID(), date, type: 'Scrim', opponent: 'Unknown opponent', map, ourScore, theirScore,
      rosterContext: activeBatch ? { kind: 'tryout', tryoutBatchId: activeBatch.id } : { kind: 'unclassified' },
      sourceMetadata: { method: 'provider-import', capturedAt: new Date().toISOString(), provider: 'vrfkit', externalId: sha256 },
      automation: { mode: 'exact-scoreboard', editable: true } };
    (db.matches ||= []).push(match);
  }

  const now = new Date().toISOString(); const requestId = `auto:${sha256}:${screenshot.id}`;
  const review: ReplayReview = { sha256, matchId: match.id, teamId, mappings, status: 'review-required', revision: 1,
    requestId, requestHash: '', rawEvidenceHash: contentHash(job.result), updatedAt: now, acceptedAt: null, acceptedBy: null,
    ratingDraftKeys: [], screenshotLinks: [{ id: screenshot.id, imageSha256: screenshot.imageSha256, replaySha256: sha256 }] };
  review.requestHash = contentHash({ mode: 'automatic-exact-scoreboard', matchId: match.id, teamId, mappings, screenshotId: screenshot.id });
  store.reviews[sha256] = review; blob.matchId = match.id;
  const accepted = acceptReviewIntoEngines(db, store, job, review, user, requestId, review.requestHash);
  review.status = 'accepted'; review.revision = 2; review.updatedAt = accepted.acceptedAt; review.acceptedAt = accepted.acceptedAt; review.acceptedBy = user.actorId; review.ratingDraftKeys = accepted.ratingDraftKeys;
  blob.reviewStatus = 'accepted'; blob.matchId = match.id; screenshot.autoProcessedAt = accepted.acceptedAt; screenshot.automaticMatchId = match.id;
  screenshot.reason = 'Automatically processed from a unique exact ten-player K/D/A match. You can edit the saved match later.';
  return { matchId: match.id, acceptedAt: accepted.acceptedAt };
}

/** Re-materialize an already accepted replay after a newer screenshot-linking
 * implementation. This is safe only for the same replay and target match; it
 * creates a new revision so paired desktops replace the old snapshot. */
function refreshAcceptedReplay(db: any, store: ReplayStore, sha256: string, targetMatchId: string, user: Actor) {
  const review = store.reviews[sha256]; const blob = store.blobs[sha256];
  const job = blob?.parserJobId ? store.parserJobs[blob.parserJobId] : null;
  const adapter = db.engineAdapters?.replay?.[targetMatchId];
  if (!review || review.status !== 'accepted' || review.matchId !== targetMatchId || !job?.result || job.status !== 'completed'
    || adapter?.provenance?.replaySha256 !== sha256 || Number(adapter?.provenance?.materializationVersion || 0) >= 2) return null;
  const now = new Date().toISOString(); const requestId = `refresh:${sha256}:${targetMatchId}:${Number(adapter.revision || 1) + 1}`;
  const requestHash = contentHash({ mode: 'refresh-accepted-replay', sha256, targetMatchId, revision: Number(adapter.revision || 1) + 1 });
  const accepted = acceptReviewIntoEngines(db, store, job, review, user, requestId, requestHash);
  review.revision = Number(review.revision || 1) + 1; review.updatedAt = accepted.acceptedAt; review.acceptedAt = accepted.acceptedAt; review.acceptedBy = user.actorId; review.ratingDraftKeys = accepted.ratingDraftKeys;
  blob.reviewStatus = 'accepted'; blob.matchId = targetMatchId;
  return { matchId: targetMatchId, acceptedAt: accepted.acceptedAt, refreshedAt: now };
}

function actorCanSeeReplay(user: Actor, store: ReplayStore, sha256: string) {
  return user.role === 'coach' || Object.values(store.associations).some(item => item.sha256 === sha256
    && item.owner.actorId === user.actorId && item.owner.playerId === (user.playerId || null));
}

function parserFailure(error: any) {
  const message = String(error?.message || '');
  if (error?.code === 'parser-unavailable') return { code: 'parser-unavailable', message: 'The pinned replay parser is not configured on this server.' };
  if (message.includes('SHA-256')) return { code: 'integrity-check-failed', message: 'Replay parsing stopped because an integrity check failed.' };
  if (message.includes('timed out')) return { code: 'parser-timeout', message: 'Replay parsing exceeded the configured time limit.' };
  if (message.includes('size limit') || message.includes('file-count') || message.includes('evidence limit')) return { code: 'parser-output-limit', message: 'Replay parsing exceeded a configured output limit.' };
  return { code: 'parser-failed', message: 'Replay parsing failed. Review private server diagnostics.' };
}

function pruneParserJobs(store: ReplayStore, nowMs = Date.now()) {
  let changed = false;
  const limits = parserLimits();
  const terminal = Object.values(store.parserJobs).filter(job => ['completed', 'failed'].includes(job.status))
    .sort((left, right) => (Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt)) || right.id.localeCompare(left.id));
  const keep = new Set(terminal.slice(0, limits.retained).filter(job => nowMs - Date.parse(job.completedAt || job.createdAt) <= limits.retentionMs).map(job => job.id));
  for (const job of terminal) {
    if (keep.has(job.id)) continue;
    delete store.parserJobs[job.id];
    changed = true;
    const blob = store.blobs[job.sha256];
    if (blob?.parserJobId === job.id) blob.parserJobId = null;
  }
  return changed;
}

function parserAdmission(store: ReplayStore, requestedBy: string, sourceDeviceIds: string[]) {
  const limits = parserLimits();
  const admitted = Object.values(store.parserJobs).filter(job => ['queued', 'running'].includes(job.status));
  if (admitted.filter(job => job.status === 'queued').length >= limits.queued) return { ok: false as const, error: 'The private parser queue is full.' };
  if (admitted.filter(job => job.requestedBy === requestedBy).length >= limits.perActor) return { ok: false as const, error: 'This coach has reached the active parser-job limit.' };
  if (sourceDeviceIds.some(deviceId => admitted.filter(job => (job.sourceDeviceIds || []).includes(deviceId)).length >= limits.perDevice)) {
    return { ok: false as const, error: 'A source device has reached the active parser-job limit.' };
  }
  return { ok: true as const };
}

function nextParserJobs(store: ReplayStore, activeIds: Set<string>, capacity: number) {
  return Object.values(store.parserJobs).filter(job => job.status === 'queued' && !activeIds.has(job.id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, capacity));
}

function recoverExpiredParserLeases(store: ReplayStore, nowMs = Date.now()) {
  let recovered = 0;
  for (const job of Object.values(store.parserJobs)) {
    if (job.status !== 'running') continue;
    const expiry = Date.parse(job.lease?.expiresAt || '');
    if (Number.isFinite(expiry) && expiry > nowMs) continue;
    job.status = 'queued'; job.lease = null; job.failure = undefined; recovered += 1;
  }
  return recovered;
}

function nextParserLeaseRecoveryDelay(store: ReplayStore, nowMs = Date.now()) {
  const expiries = Object.values(store.parserJobs).filter(job => job.status === 'running')
    .map(job => Date.parse(job.lease?.expiresAt || '')).filter(Number.isFinite);
  if (!expiries.length) return null;
  return Math.max(0, Math.min(...expiries) - nowMs) + 25;
}

function scheduleParserLeaseRecovery(store: ReplayStore, callback: () => void, nowMs = Date.now()) {
  const delay = nextParserLeaseRecoveryDelay(store, nowMs);
  if (delay === null) return null;
  const timer = setTimeout(callback, delay); timer.unref?.(); return timer;
}

function armParserLeaseRecovery(store: ReplayStore) {
  if (parserRecoveryTimer) clearTimeout(parserRecoveryTimer);
  parserRecoveryTimer = scheduleParserLeaseRecovery(store, () => {
    parserRecoveryTimer = null;
    void recoverParserQueue().catch(error => console.error('[replay-parser] lease recovery failed:', error?.message || error));
  });
}

function claimParserLease(store: ReplayStore, owner: string, nowMs = Date.now()) {
  recoverExpiredParserLeases(store, nowMs);
  if (Object.values(store.parserJobs).filter(job => job.status === 'running' && Date.parse(job.lease?.expiresAt || '') > nowMs).length >= parserLimits().concurrent) return null;
  const job = nextParserJobs(store, new Set(), 1)[0];
  if (!job) return null;
  const priorFence = Number(job.leaseFence || job.lease?.fence || 0);
  const now = new Date(nowMs).toISOString();
  job.status = 'running'; job.startedAt ||= now; job.completedAt = null;
  job.leaseFence = priorFence + 1;
  job.lease = { owner, heartbeatAt: now, expiresAt: new Date(nowMs + parserLimits().leaseMs).toISOString(), fence: job.leaseFence };
  return { job, fence: job.lease.fence };
}

function leaseMatches(job: ReplayParserJob | undefined, owner: string, fence: number) {
  return !!job && job.status === 'running' && job.lease?.owner === owner && job.lease.fence === fence && Date.parse(job.lease.expiresAt) > Date.now();
}

async function heartbeatParserLease(jobId: string, fence: number) {
  const db = await readDB(); const store = replayStore(db); const job = store.parserJobs[jobId];
  if (!leaseMatches(job, PARSER_INSTANCE_ID, fence)) return false;
  const now = Date.now(); job.lease!.heartbeatAt = new Date(now).toISOString(); job.lease!.expiresAt = new Date(now + parserLimits().leaseMs).toISOString();
  await saveDB(db); return true;
}

async function claimNextPersistedParserJob() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const db = await readDB(); const store = replayStore(db); const claimed = claimParserLease(store, PARSER_INSTANCE_ID);
    if (!claimed) { armParserLeaseRecovery(store); return null; }
    try { await saveDB(db); return { id: claimed.job.id, sha256: claimed.job.sha256, fence: claimed.fence }; }
    catch (error: any) { if (error?.status !== 409) throw error; }
  }
  return null;
}

async function finalizeParserJob(jobId: string, sha256: string, fence: number, outcome: { result: any } | { error: any }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const db = await readDB(); const store = replayStore(db); const job = store.parserJobs[jobId]; const blob = store.blobs[sha256];
    if (!leaseMatches(job, PARSER_INSTANCE_ID, fence)) return false;
    if (!blob) throw new Error('Replay parser job lost its private intake record.');
    const now = new Date().toISOString();
    if ('result' in outcome) {
      job!.status = 'completed'; job!.completedAt = now; job!.result = outcome.result; job!.failure = undefined; job!.lease = null;
      blob.parserStatus = 'parsed-review-required'; blob.reviewStatus = 'review-required'; blob.parserJobId = jobId; blob.uploadStatus = 'processed';
    } else {
      job!.status = 'failed'; job!.completedAt = now; job!.failure = parserFailure(outcome.error); job!.lease = null;
      blob.parserStatus = 'failed'; blob.parserJobId = jobId; blob.uploadStatus = 'failed';
      if (blob.rawObject) blob.rawObject.status = 'parse-failed';
    }
    pruneParserJobs(store);
    try { await saveDB(db); return true; }
    catch (error: any) { if (error?.status !== 409 || attempt === 3) throw error; }
  }
  return false;
}

const REPLAY_CORRECTION_MARKERS = new Set(['replay-evidence-overlay', 'player-name-mapping']);
function correctedFields(row: any) {
  return new Set<string>((row?.corrections || []).flatMap((item: any) => Array.isArray(item?.fields) ? item.fields : [])
    .filter((field: any) => typeof field === 'string' && !REPLAY_CORRECTION_MARKERS.has(field)));
}
function mergeVerifiedField(existing: any, field: string, replayValue: any, corrected = correctedFields(existing)) {
  if (corrected.has(field)) return existing?.[field];
  return replayValue === null || replayValue === undefined ? existing?.[field] ?? null : replayValue;
}

function pruneRawReceipts(store: ReplayStore, nowMs = Date.now()) {
  const receipts = Object.values(store.rawReceipts).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const receipt of receipts.slice(200)) delete store.rawReceipts[receipt.uploadId];
  for (const receipt of receipts.slice(0, 200)) if (nowMs - Date.parse(receipt.createdAt) > 30 * 24 * 60 * 60 * 1000) delete store.rawReceipts[receipt.uploadId];
}
function priorRawFinalizeReceipt(store: ReplayStore, uploadId: string, deviceId: string) {
  const receipt = store.rawReceipts[uploadId];
  if (!receipt) return null;
  return receipt.deviceId === deviceId ? { ok: true as const, response: receipt.response } : { ok: false as const };
}

async function materializeRawReplay(record: RawReplayObject, sha256: string) {
  const target = `${privateReplayPath(sha256)}.${crypto.randomUUID()}.gcs`;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const response = await downloadRawReplayObject(record); const hasher = crypto.createHash('sha256'); let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > record.size) return callback(new Error('GCS replay exceeded its verified size.')); hasher.update(chunk); callback(null, chunk); } });
  try {
    await pipeline(response.body as any, meter, fs.createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    if (bytes !== record.size || hasher.digest('hex') !== sha256) throw new Error('GCS replay failed integrity verification during parser staging.');
    return target;
  } catch (error) { await fsp.rm(target, { force: true }).catch(() => {}); throw error; }
}

async function markRawDeleted(sha256: string, generation: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const db = await readDB(); const blob = replayStore(db).blobs[sha256];
    if (!blob?.rawObject || blob.rawObject.generation !== generation) return;
    blob.rawObject.status = 'deleted'; blob.uploadStatus = 'deleted';
    try { await saveDB(db); return; } catch (error: any) { if (error?.status !== 409 || attempt === 2) throw error; }
  }
}

async function executeParserJob(jobId: string, sha256: string, fence: number) {
  const heartbeatEvery = Math.max(5_000, Math.floor(parserLimits().leaseMs / 3));
  const heartbeat = setInterval(() => { void heartbeatParserLease(jobId, fence).catch(error => console.warn('[replay-parser] lease heartbeat failed:', error?.message || error)); }, heartbeatEvery);
  let stagedPath: string | null = null;
  try {
    const config = loadVrfkitPipelineConfig(PRIVATE_DIR);
    const db = await readDB(); const current = replayStore(db).parserJobs[jobId]; const rawObject = current?.rawObject || null;
    if (rawObject) { rawObject.status = 'processing'; stagedPath = await materializeRawReplay(rawObject, sha256); }
    const parsed = await runVrfkitReplayPipeline(stagedPath || privateReplayPath(sha256), sha256, config);
    const reviewDraft = buildReplayOpeningReviewDraft(parsed.result.parserInput);
    const retained = { scoreboard: parsed.result.scoreboard, reviewDraft, diagnostics: parsed.result.diagnostics };
    if (Buffer.byteLength(JSON.stringify(retained)) > parserLimits().evidenceBytes) throw new Error('Normalized replay evidence exceeded its retained evidence limit.');
    clearInterval(heartbeat);
    const persisted = await finalizeParserJob(jobId, sha256, fence, { result: retained });
    if (persisted && rawObject) {
      await deleteRawReplayObject(rawObject);
      await markRawDeleted(sha256, rawObject.generation);
    }
  } catch (error: any) {
    console.error('[replay-parser] private job failed:', error?.message || error);
    try {
      clearInterval(heartbeat);
      await finalizeParserJob(jobId, sha256, fence, { error });
    } catch (persistError: any) { console.error('[replay-parser] could not persist private failure state:', persistError?.message || persistError); }
  } finally { clearInterval(heartbeat); if (stagedPath) await fsp.rm(stagedPath, { force: true }).catch(() => {}); }
}

function requestParserPump() { setImmediate(() => { void pumpParserQueue(); }); }

async function pumpParserQueue() {
  if (parserSchedulerPumping) return;
  parserSchedulerPumping = true;
  try {
    while (parserSchedulerActive.size < parserLimits().concurrent) {
      const next = await claimNextPersistedParserJob();
      if (!next) break;
      parserSchedulerActive.add(next.id);
      void executeParserJob(next.id, next.sha256, next.fence).finally(() => {
        parserSchedulerActive.delete(next.id);
        requestParserPump();
      });
    }
  } finally { parserSchedulerPumping = false; }
}

async function recoverParserQueue() {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const db = await readDB(); const store = replayStore(db); let changed = false;
    changed = recoverExpiredParserLeases(store) > 0;
    changed = pruneParserJobs(store) || changed;
    if (changed) {
      try { await saveDB(db); }
      catch (error: any) { if (error?.status === 409 && attempt < 3) continue; throw error; }
    }
    armParserLeaseRecovery(store);
    if (Object.values(store.parserJobs).some(job => job.status === 'queued')) requestParserPump();
    return;
  }
}

async function expireRawSession(uploadId: string) {
  const db = await readDB(); const store = replayStore(db); const session = store.rawSessions[uploadId];
  if (!session) return;
  const delay = Date.parse(session.expiresAt) - Date.now();
  if (delay > 0) { scheduleRawSessionExpiry(session); return; }
  if (typeof session.uploadUrl === 'string' && session.uploadUrl.startsWith('https://storage.googleapis.com/')) await cancelRawReplayUpload(session.uploadUrl);
  delete store.rawSessions[uploadId]; const blob = store.blobs[session.sha256];
  if (blob?.uploadStatus === 'uploading') blob.uploadStatus = 'failed';
  await saveDB(db); rawSessionTimers.delete(uploadId);
}

function scheduleRawSessionExpiry(session: RawUploadSession) {
  const prior = rawSessionTimers.get(session.uploadId); if (prior) clearTimeout(prior);
  const timer = setTimeout(() => { void expireRawSession(session.uploadId).catch(error => console.error('[replay-raw] session cancellation failed:', error?.message || error)); }, Math.max(0, Date.parse(session.expiresAt) - Date.now()) + 25);
  timer.unref?.(); rawSessionTimers.set(session.uploadId, timer);
}

async function recoverRawSessions() { const store = replayStore(await readDB()); for (const session of Object.values(store.rawSessions)) scheduleRawSessionExpiry(session); }

/** Register before the normal session middleware: this endpoint authenticates a scoped device credential. */
export function registerReplayDeviceUploadRoute(app: Express) {
  assertPrivateStorageRoot();
  if (process.env.CLOUDFLARE_WORKER !== 'true') void recoverRawSessions().catch(error => console.error('[replay-raw] session recovery failed:', error?.message || error));
  app.post('/api/replay-intake/pair', async (req, res) => {
    try {
      const retryAfter = requestRateLimit(`device-pair:${clientIp(req)}`, 10, 10 * 60 * 1000);
      if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); return res.status(429).json({ error: 'Too many pairing attempts. Try again later.' }); }
      const code = String(req.body?.code || '').trim().toUpperCase(); const name = cleanDeviceName(req.body?.deviceName);
      if (!/^[A-Z2-9]{10}$/.test(code) || !name) return res.status(400).json({ error: 'Pairing code or device name is invalid.' });
      const db = await readDB(); const store = replayStore(db); const now = Date.now();
      for (const [key, item] of Object.entries(store.pairingCodes)) if (Date.parse(item.expiresAt) <= now) delete store.pairingCodes[key];
      const codeHash = tokenHash(code); const pairing = store.pairingCodes[codeHash];
      if (!pairing || Date.parse(pairing.expiresAt) <= now) return res.status(401).json({ error: 'Pairing code is invalid or expired.' });
      const id = newDeviceId(); const token = crypto.randomBytes(32).toString('base64url'); const createdAt = new Date(now).toISOString();
      const device: DeviceRecord = { id, name, tokenHash: tokenHash(token), credentialVersion: 1, owner: pairing.owner, createdAt, expiresAt: new Date(now + DEVICE_TTL_MS).toISOString(), revokedAt: null, lastSeenAt: null };
      store.devices[id] = device; delete store.pairingCodes[codeHash]; await saveDB(db);
      const player = device.owner.playerId ? (db.rosterPlayers || []).find((item: any) => item.id === device.owner.playerId) : null;
      res.status(201).json({ device: devicePublic(device), identity: { role: device.owner.role, playerId: device.owner.playerId, displayName: player?.displayName || (device.owner.role === 'coach' ? 'Coach' : 'Player') }, credential: { token, shownOnce: true } });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Device pairing failed.' }); }
  });
  app.get('/api/replay-intake/device-sync', async (req, res) => {
    try {
      const authenticated = await authenticateDevice(req); if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      // Cursor is "<updatedAt>|<itemId>" (a bare timestamp from older clients
      // is accepted). Ordering by (updatedAt, id) means items that share a
      // timestamp are neither skipped nor re-sent across pages.
      const sinceRaw = String(req.query.since || ''); const [sinceStamp, sinceId = ''] = sinceRaw.split('|'); const since = sinceStamp && Number.isFinite(Date.parse(sinceStamp)) ? Date.parse(sinceStamp) : 0; const db = authenticated.db;
      const accepted = Object.values(db.engineAdapters?.replay || {}).filter((record: any) => record?.status === 'accepted' && Date.parse(record.updatedAt || record.acceptedAt || 0) >= since).map((record: any) => { const matchId = String(record.matchId); const updatedAt = String(record.updatedAt || record.acceptedAt); return { id: `accepted:${matchId}:${record.revision || 1}`, kind: 'accepted-match', updatedAt, revision: Number(record.revision || 1), replaySha256: record.provenance?.replaySha256 || null, match: (db.matches || []).find((item: any) => item.id === matchId) || null, playerStats: (db.playerStats || []).filter((item: any) => item.matchId === matchId), rounds: (db.rounds || []).filter((item: any) => item.matchId === matchId), replay: record }; });
      const screenshotItems = Object.values(db.engineAdapters?.screenshot || {}).filter((record: any) => record?.status === 'accepted' && Date.parse(record.updatedAt || 0) >= since).map((record: any) => { const matchId = String(record.matchId); return { id: `accepted-screenshot:${matchId}:${record.revision || 1}`, kind: 'accepted-screenshot-summary', updatedAt: String(record.updatedAt), revision: Number(record.revision || 1), match: (db.matches || []).find((item: any) => item.id === matchId) || null, playerStats: (db.playerStats || []).filter((item: any) => item.matchId === matchId && item.screenshotMetrics), screenshot: record }; });
      // Inclusive cursor (items sharing the cursor timestamp are re-sent and
      // de-duplicated by id on the device), so equal timestamps are never lost.
      const after = (item: any) => !sinceRaw || Date.parse(item.updatedAt) > since || (Date.parse(item.updatedAt) === since && String(item.id) > sinceId && sinceId !== '');
      const ordered = [...accepted, ...screenshotItems].filter(after).sort((left: any, right: any) => left.updatedAt.localeCompare(right.updatedAt) || String(left.id).localeCompare(String(right.id)));
      const items = ordered.slice(0, 100);
      const last: any = items[items.length - 1];
      res.json({ items, cursor: last ? `${last.updatedAt}|${last.id}` : (sinceRaw || null), hasMore: ordered.length > items.length });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Device synchronization is unavailable.' }); }
  });
  app.post('/api/replay-intake/screenshot-summaries/:matchId', async (req, res) => {
    try {
      const authenticated = await authenticateDevice(req); if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      const { db, store, device } = authenticated; if (device.owner.role !== 'coach') return res.status(403).json({ error: 'Team screenshot summaries require a coach-owned device.' });
      const matchId = String(req.params.matchId || ''); const body = req.body;
      if (!matchId || body?.schemaVersion !== 1 || body?.match?.id !== matchId || !Array.isArray(body?.playerStats) || body.playerStats.length > 20 || Buffer.byteLength(JSON.stringify(body)) > 128 * 1024) return res.status(400).json({ error: 'Screenshot summary is invalid.' });
      const allowedMatch = ['id', 'date', 'type', 'opponent', 'map', 'attW', 'attL', 'defW', 'defL', 'ourScore', 'theirScore', 'pistolAtt', 'pistolDef', 'ecoAtt', 'ecoDef', 'bonusAtt', 'bonusDef', 'rosterContext', 'roundAnalytics', 'sourceMetadata'];
      const safeMatch = Object.fromEntries(allowedMatch.filter(key => body.match[key] !== undefined).map(key => [key, structuredClone(body.match[key])]));
      const scoreboardEvidence = sanitizedScoreboardEvidence(body.match.screenshotEvidence);
      if (scoreboardEvidence) safeMatch.screenshotEvidence = scoreboardEvidence;
      const safeStats = body.playerStats.map((row: any) => {
        if (!row?.id || row.matchId !== matchId || !row.screenshotMetrics || row.screenshotMetrics.schemaVersion !== 1) throw Object.assign(new Error('Screenshot player summary is invalid.'), { status: 400 });
        const allowed = ['id', 'matchId', 'player', 'playerId', 'displayNameSnapshot', 'appearanceType', 'agent', 'kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'headshots', 'headshotEligibleKills', 'orbPoints', 'fk', 'fd', 'plants', 'defuses', 'screenshotMetrics', 'sourceMetadata'];
        const safe = Object.fromEntries(allowed.filter(key => row[key] !== undefined).map(key => [key, structuredClone(row[key])]));
        if (safe.playerId && !(db.rosterPlayers || []).some((player: any) => player.id === safe.playerId && !player.retiredAt)) {
          delete safe.playerId;
          delete safe.appearanceType;
        }
        return safe;
      });
      const digest = contentHash({ match: safeMatch, playerStats: safeStats }); db.engineAdapters ||= {}; db.engineAdapters.screenshot ||= {};
      const existingRecord = db.engineAdapters.screenshot[matchId];
      const existingMatch = (db.matches || []).find((item: any) => item.id === matchId); if (!existingMatch) (db.matches ||= []).push(safeMatch);
      else if (scoreboardEvidence) existingMatch.screenshotEvidence = scoreboardEvidence;
      for (const incoming of safeStats) {
        const existing = (db.playerStats || []).find((item: any) => item.id === incoming.id && item.matchId === matchId);
        if (existing) Object.assign(existing, mergeAcceptedPlayerStat(existing, incoming)); else (db.playerStats ||= []).push(incoming);
      }
      const updatedAt = new Date().toISOString();
      if (existingRecord?.digest !== digest) db.engineAdapters.screenshot[matchId] = { schemaVersion: 1, status: 'accepted', matchId, digest, revision: Number(existingRecord?.revision || 0) + 1, updatedAt, sourceDeviceId: device.id };
      if (scoreboardEvidence) {
        const extraction = { map: safeMatch.map, ourScore: safeMatch.ourScore, theirScore: safeMatch.theirScore, confident: true,
          players: scoreboardEvidence.scoreboardPlayers.map((row: any) => ({ name: row.name, agent: row.agent, kills: row.kills, deaths: row.deaths, assists: row.assists, fk: row.fk, trades: row.trades, plants: row.plants, defuses: row.defuses })) };
        const rosterPlayers = (db.rosterPlayers || []).filter((player: any) => !player.retiredAt).map((player: any) => ({ id: player.id, displayName: player.displayName }));
        const draft: any = buildScreenshotReviewDraft(extraction, { model: 'accepted-local-capture', provider: 'tesseract-local', capturedAt: safeMatch.sourceMetadata?.capturedAt || body.updatedAt || updatedAt, rosterPlayers });
        draft.stats = draft.stats.map((stat: any, index: number) => ({ ...stat, screenshotTeam: scoreboardEvidence.scoreboardPlayers[index].allied ? 'ours' : 'theirs' }));
        const imageSha256 = contentHash(scoreboardEvidence); const id = screenshotRecordId(device.id, `${matchId}:${imageSha256}`);
        store.screenshots[id] = { id, deviceId: device.id, imageSha256, createdAt: updatedAt, createdBy: device.owner.actorId, status: 'pending', reviewRequired: true, draft, replaySha256: null, suggestions: [], reason: 'Waiting for one matching replay from this desktop.', targetMatchId: matchId };
        pairReplayScreenshots(store);
        const linked = store.screenshots[id].replaySha256;
        if (linked) {
          const deviceActor = actorForDevice(device);
          if (!autoFinalizeDesktopReplay(db, store, linked, deviceActor)) refreshAcceptedReplay(db, store, linked, matchId, deviceActor);
        }
      }
      device.lastSeenAt = updatedAt; await saveDB(db); res.status(existingRecord ? 200 : 201).json({ accepted: true, idempotent: existingRecord?.digest === digest, revision: db.engineAdapters.screenshot[matchId].revision, replayIntegrated: !!db.engineAdapters.replay?.[matchId] });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Screenshot summary could not be synchronized.' }); }
  });
  app.post('/api/replay-intake/evidence/:sha256', async (req, res) => {
    let releaseReservation: (() => void) | null = null;
    try {
      const expectedHash = String(req.params.sha256 || '').toLowerCase();
      if (!HEX_SHA256.test(expectedHash)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const authenticated = await authenticateDevice(req);
      if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      const { db, store, device } = authenticated;
      const validated = validateLocalReplayEvidence(req.body, device.id); const source = validated.envelope.source;
      const originalName = cleanReplayName(source.originalName);
      if (source.sha256 !== expectedHash || !originalName || source.size > MAX_REPLAY_BYTES) return res.status(400).json({ error: 'Evidence source does not match the replay URL or configured limits.' });
      const ownKey = associationKey(device.id, expectedHash); const existing = store.blobs[expectedHash];
      const ownAssociation = store.associations[ownKey]; const day = new Date().toISOString().slice(0, 10);
      const today = Object.values(store.associations).filter(item => item.deviceId === device.id && String(item.receivedAt).startsWith(day));
      const reservation = reserveReplayUpload(device.id, source.size, today.length, today.reduce((sum, item) => sum + Number(item.size || 0), 0), !ownAssociation);
      if (!reservation.ok) return res.status(reservation.status).json({ error: reservation.error });
      releaseReservation = reservation.release;
      const incomingEvidenceHash = contentHash(validated.retained); const priorEvidenceHash = retainedEvidenceHash(store, expectedHash, existing);
      const conflictsWithExisting = !!existing && (existing.size !== source.size || !!priorEvidenceHash && priorEvidenceHash !== incomingEvidenceHash);
      const existingIsTrusted = !!existing && (existing.reviewStatus === 'accepted' || !!(existing.parserJobId && store.parserJobs[existing.parserJobId]?.result));
      const replacingFailedEvidence = conflictsWithExisting && !existingIsTrusted;
      if (conflictsWithExisting) {
        // A newer local parser may produce a richer normalized envelope for
        // the same immutable replay bytes. Never replace already accepted
        // evidence, but let the device finish its outbox and receive the
        // accepted server snapshot instead of blocking every later item.
        if (existingIsTrusted) {
          const now = new Date().toISOString();
          const association: ReplayAssociation = ownAssociation || { id: crypto.randomUUID(), sha256: expectedHash, size: existing.size, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
          store.associations[ownKey] = association;
          const priorJob = existing.parserJobId ? store.parserJobs[existing.parserJobId] : null;
          if (priorJob && !priorJob.sourceDeviceIds.includes(device.id)) priorJob.sourceDeviceIds.push(device.id);
          pairReplayScreenshots(store);
          autoFinalizeDesktopReplay(db, store, expectedHash, actorForDevice(device));
          device.lastSeenAt = now; await saveDB(db);
          return res.status(200).json({ ...uploadPublic(association, existing), reviewRequired: existing.reviewStatus !== 'accepted', idempotent: true, existingEvidencePreserved: true });
        }
        // No accepted or successfully parsed evidence would be displaced. The
        // verified newer envelope may replace an earlier failed/incomplete
        // attempt for these same replay bytes.
      }
      const now = new Date().toISOString();
      if (existing && priorEvidenceHash === incomingEvidenceHash) {
        existing.evidenceHash ||= incomingEvidenceHash;
        const association: ReplayAssociation = ownAssociation || { id: crypto.randomUUID(), sha256: expectedHash, size: source.size, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
        store.associations[ownKey] = association; device.lastSeenAt = now;
        const priorJob = existing.parserJobId ? store.parserJobs[existing.parserJobId] : null;
        if (priorJob && !priorJob.sourceDeviceIds.includes(device.id)) priorJob.sourceDeviceIds.push(device.id);
        pairReplayScreenshots(store);
        autoFinalizeDesktopReplay(db, store, expectedHash, actorForDevice(device));
        await saveDB(db);
        return res.status(200).json({ ...uploadPublic(association, existing), evidenceSha256: validated.envelope.evidenceSha256, reviewRequired: existing.reviewStatus !== 'accepted', idempotent: true });
      }
      const jobId = crypto.randomUUID();
      const job: ReplayParserJob = { id: jobId, sha256: expectedHash, requestedBy: device.owner.actorId, sourceDeviceIds: [device.id], status: 'completed', createdAt: now, startedAt: now, completedAt: now, parser: { name: 'vrfkit', version: validated.envelope.parser.version }, reviewStatus: 'review-required', result: validated.retained, lease: null };
      const blob: ReplayBlob = { sha256: expectedHash, size: source.size, storedAt: existing?.storedAt || now, ingestionMode: 'local-evidence', uploadStatus: 'processed', parserStatus: 'parsed-review-required', parserJobId: jobId, reviewStatus: 'review-required', matchId: existing?.matchId || null, rawObject: null };
      const association: ReplayAssociation = ownAssociation || { id: crypto.randomUUID(), sha256: expectedHash, size: source.size, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
      store.parserJobs[jobId] = job; store.blobs[expectedHash] = blob; store.associations[ownKey] = association; device.lastSeenAt = now;
      pruneParserJobs(store);
      pairReplayScreenshots(store);
      // Keep a replacement of failed evidence inside the Pages CPU budget.
      // The already queued screenshot summary performs the deterministic
      // acceptance in the following request.
      if (!replacingFailedEvidence) autoFinalizeDesktopReplay(db, store, expectedHash, actorForDevice(device));
      await saveDB(db);
      return res.status(existing ? 200 : 201).json({ ...uploadPublic(association, blob), evidenceSha256: validated.envelope.evidenceSha256, reviewRequired: true, idempotent: !!existing });
    } catch (error: any) { return res.status(error?.status || 400).json({ error: error?.message || 'Local replay evidence was rejected.' }); }
    finally { releaseReservation?.(); }
  });

  app.post('/api/replay-intake/raw/initiate', async (req, res) => {
    try {
      const authenticated = await authenticateDevice(req);
      if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      const { db, store, device } = authenticated;
      if (device.owner.role !== 'coach') return res.status(403).json({ error: 'Raw replay fallback is available only to coach-owned devices.' });
      const sha256 = String(req.body?.sha256 || '').toLowerCase(); const size = Number(req.body?.size); const originalName = cleanReplayName(req.body?.originalName);
      if (!HEX_SHA256.test(sha256) || !originalName || !Number.isSafeInteger(size) || size <= 0 || size > MAX_REPLAY_BYTES) return res.status(400).json({ error: 'Valid replay SHA-256, size, and filename are required.' });
      const existing = store.blobs[sha256];
      if (existing && (existing.reviewStatus === 'accepted' || (existing.parserJobId && store.parserJobs[existing.parserJobId]?.result))) return res.status(409).json({ error: 'Verified evidence already exists for this replay.' });
      if (existing && existing.size !== size) return res.status(409).json({ error: 'This replay hash already has conflicting metadata.' });
      // Both raw storage and parser are explicit configuration gates. Do not accept a raw object that cannot be processed.
      loadVrfkitPipelineConfig(PRIVATE_DIR);
      const session = await initiateRawReplayUpload({ sha256, size, deviceId: device.id, originalName }); const now = new Date().toISOString();
      store.rawSessions[session.uploadId] = { uploadId: session.uploadId, sha256, size, originalName, deviceId: device.id, owner: device.owner, bucket: session.bucket, object: session.object, uploadUrl: session.uploadUrl, expiresAt: session.expiresAt, createdAt: now };
      const ownKey = associationKey(device.id, sha256);
      store.associations[ownKey] ||= { id: crypto.randomUUID(), sha256, size, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
      store.blobs[sha256] ||= { sha256, size, storedAt: now, ingestionMode: 'coach-raw', uploadStatus: 'uploading', parserStatus: 'unavailable', reviewStatus: 'review-required', matchId: null };
      device.lastSeenAt = now; await saveDB(db); scheduleRawSessionExpiry(store.rawSessions[session.uploadId]);
      res.status(201).json({ uploadId: session.uploadId, uploadUrl: session.uploadUrl, expiresAt: session.expiresAt, requiredHeaders: { 'Content-Type': REPLAY_TYPE, 'Content-Length': String(size) }, finalize: '/api/replay-intake/raw/finalize', reviewRequired: true });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Raw replay session could not be created.', code: error?.code }); }
  });

  app.post('/api/replay-intake/raw/finalize', async (req, res) => {
    try {
      const authenticated = await authenticateDevice(req);
      if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      const { db, store, device } = authenticated; const uploadId = String(req.body?.uploadId || ''); const generation = req.body?.generation ? String(req.body.generation) : undefined;
      const priorReceipt = priorRawFinalizeReceipt(store, uploadId, device.id);
      if (priorReceipt) return priorReceipt.ok ? res.status(202).json({ ...priorReceipt.response, idempotent: true }) : res.status(409).json({ error: 'Raw replay receipt belongs to another device.' });
      const session = store.rawSessions[uploadId];
      if (!session || session.deviceId !== device.id || Date.parse(session.expiresAt) <= Date.now()) return res.status(409).json({ error: 'Raw replay session is missing, expired, or belongs to another device.' });
      const verified = await verifyRawReplayObject({ ...session, generation });
      const rawObject: RawReplayObject = { bucket: session.bucket, object: session.object, generation: verified.generation, size: session.size, sha256: session.sha256, uploadId, status: 'verified', expiresAt: session.expiresAt };
      const blob = store.blobs[session.sha256]; if (!blob || blob.size !== session.size) return res.status(409).json({ error: 'Raw replay metadata is inconsistent.' });
      const sourceDeviceIds = [device.id]; const admission = parserAdmission(store, device.owner.actorId, sourceDeviceIds); if (!admission.ok) return res.status(429).json({ error: admission.error });
      const now = new Date().toISOString(); const job: ReplayParserJob = { id: crypto.randomUUID(), sha256: session.sha256, requestedBy: device.owner.actorId, sourceDeviceIds, status: 'queued', createdAt: now, startedAt: null, completedAt: null, parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, reviewStatus: 'review-required', rawObject };
      const response = { ...parserJobPublic(job), ingestionMode: 'coach-raw', uploadStatus: 'verified', rawObjectStatus: 'verified' };
      store.parserJobs[job.id] = job; blob.rawObject = rawObject; blob.ingestionMode = 'coach-raw'; blob.uploadStatus = 'verified'; blob.parserStatus = 'pending'; blob.parserJobId = job.id; delete store.rawSessions[uploadId]; store.rawReceipts[uploadId] = { uploadId, deviceId: device.id, response, createdAt: now }; pruneRawReceipts(store); device.lastSeenAt = now;
      await saveDB(db); const timer = rawSessionTimers.get(uploadId); if (timer) clearTimeout(timer); rawSessionTimers.delete(uploadId); res.status(202).json(response); requestParserPump();
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Raw replay could not be finalized.' }); }
  });

  app.put('/api/replay-intake/uploads/:sha256', async (req, res) => {
    let tempPath: string | null = null; let releaseLock: (() => void) | null = null; let releaseReservation: (() => void) | null = null;
    const deadline = setTimeout(() => req.destroy(new Error('Replay upload timed out.')), MAX_UPLOAD_MS);
    try {
      if (process.env.REPLAY_LEGACY_RAW_UPLOAD_ENABLED !== 'true') return res.status(410).json({ error: 'Legacy server-proxied raw upload is disabled. Use local evidence or coach GCS fallback.' });
      if (req.header('content-type') !== REPLAY_TYPE) return res.status(415).json({ error: `Content-Type must be ${REPLAY_TYPE}.` });
      const expectedHash = String(req.params.sha256 || '').toLowerCase();
      const originalName = cleanReplayName(req.header('x-replay-filename'));
      const length = Number(req.header('content-length'));
      if (!HEX_SHA256.test(expectedHash) || !originalName) return res.status(400).json({ error: 'A valid SHA-256 URL and sanitized .vrf filename are required.' });
      if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_REPLAY_BYTES) return res.status(413).json({ error: 'Replay size is missing or outside the configured limit.' });
      releaseLock = await acquireUploadLock(expectedHash);

      const authenticated = await authenticateDevice(req);
      if (!authenticated) return res.status(401).json({ error: 'Device credential is invalid, expired, or revoked.' });
      const { db, store, device } = authenticated;
      if (device.owner.role !== 'coach') return res.status(403).json({ error: 'Legacy raw upload is restricted to coach-owned migration devices.' });
      const ownKey = associationKey(device.id, expectedHash); const ownAssociation = store.associations[ownKey]; const existingBlob = store.blobs[expectedHash];
      const day = new Date().toISOString().slice(0, 10);
      const today = Object.values(store.associations).filter(item => item.deviceId === device.id && String(item.receivedAt).startsWith(day));
      const reservation = reserveReplayUpload(device.id, length, today.length, today.reduce((sum, item) => sum + Number(item.size || 0), 0), !ownAssociation);
      if (!reservation.ok) return res.status(reservation.status).json({ error: reservation.error });
      releaseReservation = reservation.release;

      const finalPath = privateReplayPath(expectedHash);
      await fsp.mkdir(path.dirname(finalPath), { recursive: true });
      tempPath = `${finalPath}.${crypto.randomBytes(12).toString('hex')}.upload`;
      const hasher = crypto.createHash('sha256'); let received = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > length || received > MAX_REPLAY_BYTES) return callback(new Error('Replay exceeded its declared or configured size.'));
          hasher.update(chunk); callback(null, chunk);
        },
      });
      await pipeline(req, meter, fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
      if (received !== length) throw Object.assign(new Error('Replay upload length did not match Content-Length.'), { status: 400 });
      const actualHash = hasher.digest('hex');
      if (!safeEqual(expectedHash, actualHash)) throw Object.assign(new Error('Replay SHA-256 verification failed.'), { status: 422 });
      if (existingBlob) {
        if (existingBlob.size !== received) throw Object.assign(new Error('The replay hash already exists with conflicting metadata.'), { status: 409 });
        const storedFile = await fsp.stat(finalPath).catch(() => null);
        if (!storedFile || storedFile.size !== received) throw Object.assign(new Error('Private replay blob is unavailable or inconsistent.'), { status: 409 });
        const storedHash = await sha256ReplayFile(finalPath);
        if (!safeEqual(storedHash, expectedHash)) throw Object.assign(new Error('Private replay blob failed integrity verification.'), { status: 409 });
        await fsp.rm(tempPath, { force: true }); tempPath = null;
        if (ownAssociation) return res.status(200).json({ ...uploadPublic(ownAssociation, existingBlob), idempotent: true });
        const now = new Date().toISOString(); const association: ReplayAssociation = { id: crypto.randomUUID(), sha256: actualHash, size: received, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
        store.associations[ownKey] = association; device.lastSeenAt = now; await saveDB(db);
        return res.status(201).json({ ...uploadPublic(association, existingBlob), deduplicated: true });
      }
      await publishVerifiedReplayTemp(tempPath, finalPath, expectedHash, received); tempPath = null;

      const now = new Date().toISOString();
      const blob: ReplayBlob = { sha256: actualHash, size: received, storedAt: now, ingestionMode: 'legacy-raw', parserStatus: 'unavailable', reviewStatus: 'review-required', matchId: null };
      const association: ReplayAssociation = { id: crypto.randomUUID(), sha256: actualHash, size: received, originalName, deviceId: device.id, owner: device.owner, receivedAt: now };
      store.blobs[actualHash] = blob; store.associations[ownKey] = association; device.lastSeenAt = now;
      // A failed metadata write deliberately leaves a verified hash-named orphan. A retry validates and reuses it;
      // deleting here could race another process that already associated the same global blob.
      await saveDB(db);
      return res.status(201).json(uploadPublic(association, blob));
    } catch (error: any) {
      if (!res.headersSent) res.status(error?.status || (error?.code === 'ECONNRESET' ? 408 : 400)).json({ error: error?.message || 'Replay upload failed.' });
    } finally {
      clearTimeout(deadline);
      if (tempPath) await fsp.rm(tempPath, { force: true }).catch(() => {});
      releaseReservation?.();
      releaseLock?.();
    }
  });
}

/** Session-authenticated enrollment, revocation, and private status views. */
export async function registerReplayDeviceRoutes(app: Express) {
  if (process.env.APP_DESKTOP === 'true') app.post('/api/desktop/replay-evidence', async (req, res) => {
    try {
      const user = actor(req); const envelope = req.body; const expectedHash = String(envelope?.source?.sha256 || '').toLowerCase();
      const sourceDeviceId = String(envelope?.source?.deviceId || `desktop-${crypto.createHash('sha256').update(user.actorId).digest('hex').slice(0, 20)}`);
      if (!HEX_SHA256.test(expectedHash)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const validated = validateLocalReplayEvidence(envelope, sourceDeviceId); const source = validated.envelope.source; const originalName = cleanReplayName(source.originalName);
      if (!originalName || source.size > MAX_REPLAY_BYTES) return res.status(400).json({ error: 'Local evidence source is invalid.' });
      const db = await readDB(); const store = replayStore(db); const existing = store.blobs[expectedHash];
      const incomingEvidenceHash = contentHash(validated.retained); const priorEvidenceHash = retainedEvidenceHash(store, expectedHash, existing);
      // Desktop reprocessing can legitimately produce a different envelope
      // after an app/parser migration. Preserve the already-reviewed local
      // record instead of replacing trusted evidence or blocking the user.
      if (existing && priorEvidenceHash && priorEvidenceHash !== incomingEvidenceHash && (existing.reviewStatus === 'accepted' || !!store.reviews[expectedHash])) {
        return res.json({ sha256: expectedHash, parserStatus: existing.parserStatus, reviewStatus: existing.reviewStatus, matchId: existing.matchId, idempotent: true, existingEvidencePreserved: true });
      }
      if (existing && priorEvidenceHash === incomingEvidenceHash) {
        existing.evidenceHash ||= incomingEvidenceHash;
        await saveDB(db);
        return res.json({ sha256: expectedHash, parserStatus: existing.parserStatus, reviewStatus: existing.reviewStatus, matchId: existing.matchId, idempotent: true });
      }
      const now = new Date().toISOString(); const jobId = crypto.randomUUID();
      const job: ReplayParserJob = { id: jobId, sha256: expectedHash, requestedBy: user.actorId, sourceDeviceIds: [sourceDeviceId], status: 'completed', createdAt: now, startedAt: now, completedAt: now, parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, reviewStatus: 'review-required', result: validated.retained, lease: null };
      const blob: ReplayBlob = { sha256: expectedHash, size: source.size, storedAt: existing?.storedAt || now, ingestionMode: 'local-evidence', uploadStatus: 'processed', parserStatus: 'parsed-review-required', parserJobId: jobId, evidenceHash: incomingEvidenceHash, reviewStatus: existing?.reviewStatus || 'review-required', matchId: existing?.matchId || null, rawObject: null };
      const key = associationKey(sourceDeviceId, expectedHash);
      store.parserJobs[jobId] = job; store.blobs[expectedHash] = blob;
      store.associations[key] ||= { id: crypto.randomUUID(), sha256: expectedHash, size: source.size, originalName, deviceId: sourceDeviceId, owner: { actorId: user.actorId, role: user.role, playerId: user.playerId || null }, receivedAt: now };
      pruneParserJobs(store); pairReplayScreenshots(store);
      const automatic = sourceDeviceId.startsWith('desktop-') ? autoFinalizeDesktopReplay(db, store, expectedHash, user) : null;
      await saveDB(db);
      res.status(201).json({ sha256: expectedHash, parserStatus: blob.parserStatus, reviewStatus: blob.reviewStatus, matchId: blob.matchId, idempotent: false, automatic });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Local replay evidence could not be imported.' }); }
  });

  app.post('/api/replay-intake/pairing-codes', async (req, res) => {
    try {
      const user = actor(req); const requestedPlayerId = typeof req.body?.playerId === 'string' ? req.body.playerId : null;
      if (user.role === 'player' && (!user.playerId || requestedPlayerId && requestedPlayerId !== user.playerId)) return res.status(403).json({ error: 'Players may pair only their own device.' });
      const ownerPlayerId = user.role === 'player' ? user.playerId! : requestedPlayerId;
      const db = await readDB(); if (ownerPlayerId && !db.rosterPlayers?.some((player: any) => player.id === ownerPlayerId && !player.retiredAt)) return res.status(409).json({ error: 'Choose an active roster player.' });
      const store = replayStore(db); const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const random = crypto.randomBytes(10); const code = [...random].map(value => alphabet[value % alphabet.length]).join(''); const now = Date.now();
      for (const [key, item] of Object.entries(store.pairingCodes)) if (Date.parse(item.expiresAt) <= now) delete store.pairingCodes[key];
      const record: PairingCode = { codeHash: tokenHash(code), owner: { actorId: user.actorId, role: user.role, playerId: ownerPlayerId || null }, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60 * 1000).toISOString(), createdBy: user.actorId };
      store.pairingCodes[record.codeHash] = record; await saveDB(db); res.status(201).json({ code, expiresAt: record.expiresAt, owner: { role: record.owner.role, playerId: record.owner.playerId } });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Pairing code could not be created.' }); }
  });

  app.get('/api/replay-intake/screenshots', async (req, res) => {
    if (actor(req).role !== 'coach') return res.status(403).json({ error: 'Screenshot pairing is coach-only.' });
    try {
      const store = replayStore(await readDB());
      return res.json(Object.values(store.screenshots).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(screenshotPairingPublic));
    } catch { return res.status(500).json({ error: 'Screenshot pairing status is unavailable.' }); }
  });
  app.delete('/api/replay-intake/screenshots', async (req, res) => {
    if (actor(req).role !== 'coach') return res.status(403).json({ error: 'Screenshot pairing is coach-only.' });
    try {
      const db = await readDB(); const store = replayStore(db); const removed = Object.keys(store.screenshots).length;
      store.screenshots = {}; await saveDB(db);
      return res.json({ removed });
    } catch { return res.status(500).json({ error: 'The screenshot queue could not be cleared.' }); }
  });
  app.delete('/api/replay-intake/screenshots/:id', async (req, res) => {
    if (actor(req).role !== 'coach') return res.status(403).json({ error: 'Screenshot pairing is coach-only.' });
    try {
      const id = String(req.params.id || ''); const db = await readDB(); const store = replayStore(db);
      if (!store.screenshots[id]) return res.status(404).json({ error: 'Screenshot draft not found.' });
      delete store.screenshots[id]; await saveDB(db);
      return res.json({ removed: true, id });
    } catch { return res.status(500).json({ error: 'The screenshot draft could not be deleted.' }); }
  });
  app.post('/api/replay-intake/screenshots/local', async (req, res) => {
    const user = actor(req);
    if (user.role !== 'coach') return res.status(403).json({ error: 'Screenshot pairing is coach-only.' });
    const parsed = localScreenshotSubmissionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'The local OCR draft is invalid. Nothing was saved.' });
    try {
      const { deviceId, imageSha256, capturedAt, extraction } = parsed.data;
      // Browser-local retries may use different crop boxes for the same image.
      // Version by the schema-normalized extraction (not capture time), retaining
      // each prior draft while exact retries remain idempotent.
      const extractionDigest = contentHash(extraction);
      const id = screenshotRecordId(deviceId, `${imageSha256}:${extractionDigest}`);
      const initialDb = await readDB(); const initialStore = replayStore(initialDb);
      const assertDevice = (store: ReplayStore) => {
        if (deviceId === 'manual-entry') return;
        // The installed desktop collector has a stable local identity but is
        // intentionally not required to enroll as its own remote device.
        // Accept only that UUID-shaped identity on the desktop-only server;
        // browser/cloud instances still require an active enrolled device.
        if (process.env.APP_DESKTOP === 'true' && /^desktop-[0-9a-f-]{36}$/i.test(deviceId)) return;
        const device = store.devices[deviceId];
        if (!device || device.revokedAt || Date.parse(device.expiresAt) <= Date.now()) throw Object.assign(new Error('Choose an active collection device.'), { status: 409 });
      };
      assertDevice(initialStore);
      if (initialStore.screenshots[id]) return res.json(screenshotPairingPublic(initialStore.screenshots[id]));
      pruneScreenshotPairings(initialStore); screenshotAdmission(initialStore, deviceId, user.actorId);
      const rosterPlayers = (initialDb.rosterPlayers || []).filter((player: any) => !player.retiredAt).map((player: any) => ({ id: player.id, displayName: player.displayName }));
      const draft = buildScreenshotReviewDraft(extraction, { model: 'tesseract-7/eng/parser-v1', provider: 'tesseract-local', capturedAt, rosterPlayers });
      if (Buffer.byteLength(JSON.stringify(draft)) > 64 * 1024) return res.status(413).json({ error: 'Screenshot draft exceeds the review limit.' });
      for (let attempt = 0; attempt < 4; attempt++) {
        const db = await readDB(); const store = replayStore(db); assertDevice(store);
        if (store.screenshots[id]) return res.json(screenshotPairingPublic(store.screenshots[id]));
        pruneScreenshotPairings(store); screenshotAdmission(store, deviceId, user.actorId);
        store.screenshots[id] = { id, deviceId, imageSha256, createdAt: new Date().toISOString(), createdBy: user.actorId, status: 'pending', reviewRequired: true, draft, replaySha256: null, suggestions: [], reason: 'Waiting for a matching replay.' };
        pairReplayScreenshots(store);
        const pairing = store.screenshots[id];
        if (deviceId.startsWith('desktop-') && pairing.replaySha256) autoFinalizeDesktopReplay(db, store, pairing.replaySha256, user);
        try { await saveDB(db); return res.status(201).json(screenshotPairingPublic(store.screenshots[id])); }
        catch (error: any) { if (error?.status !== 409 || attempt === 3) throw error; }
      }
    } catch (error: any) {
      const status = [400, 409, 413, 422, 429].includes(error?.status) ? error.status : 500;
      return res.status(status).json({ error: status === 500 ? 'The local OCR draft could not be saved.' : error.message });
    }
  });
  app.post('/api/replay-intake/screenshots', async (req, res) => {
    const user = actor(req);
    if (user.role !== 'coach') return res.status(403).json({ error: 'Screenshot pairing is coach-only.' });
    if (screenshotRequests.has(user.actorId) || screenshotRequests.size >= 2) return res.status(429).json({ error: 'Screenshot extraction is busy. Please retry.' });
    screenshotRequests.add(user.actorId);
    try {
      const image = validatePairingImage(req.body); const id = screenshotRecordId(image.deviceId, image.imageSha256);
      const initialDb = await readDB(); const initialStore = replayStore(initialDb);
      const assertDevice = (store: ReplayStore) => {
        const device = store.devices[image.deviceId];
        if (!device || device.revokedAt || Date.parse(device.expiresAt) <= Date.now()) throw Object.assign(new Error('Choose an active collection device.'), { status: 409 });
      };
      assertDevice(initialStore);
      if (initialStore.screenshots[id]) return res.json(screenshotPairingPublic(initialStore.screenshots[id]));
      pruneScreenshotPairings(initialStore); screenshotAdmission(initialStore, image.deviceId, user.actorId);
      const draft = await extractScoreboardScreenshot(image, initialDb);
      // Only allowlisted structured OCR fields and image digest survive this request.
      if (Buffer.byteLength(JSON.stringify(draft)) > 64 * 1024) return res.status(413).json({ error: 'Screenshot draft exceeds the review limit.' });
      for (let attempt = 0; attempt < 4; attempt++) {
        const db = await readDB(); const store = replayStore(db); assertDevice(store);
        if (store.screenshots[id]) return res.json(screenshotPairingPublic(store.screenshots[id]));
        pruneScreenshotPairings(store); screenshotAdmission(store, image.deviceId, user.actorId);
        store.screenshots[id] = { id, deviceId: image.deviceId, imageSha256: image.imageSha256, createdAt: new Date().toISOString(), createdBy: user.actorId, status: 'pending', reviewRequired: true, draft, replaySha256: null, suggestions: [], reason: 'Waiting for a matching replay.' };
        pairReplayScreenshots(store);
        try { await saveDB(db); return res.status(201).json(screenshotPairingPublic(store.screenshots[id])); }
        catch (error: any) { if (error?.status !== 409 || attempt === 3) throw error; }
      }
    } catch (error: any) {
      const status = [400, 409, 413, 422, 429].includes(error?.status) ? error.status : 502;
      return res.status(status).json({ error: status === 502 ? 'Screenshot extraction is unavailable. Nothing was saved.' : error.message });
    } finally { screenshotRequests.delete(user.actorId); }
  });
  app.post('/api/replay-intake/devices/enroll', async (req, res) => {
    try {
      const user = actor(req); const name = cleanDeviceName(req.body?.name);
      if (!name) return res.status(400).json({ error: 'Device name must be 2–80 safe characters.' });
      const requestedPlayerId = typeof req.body?.playerId === 'string' ? req.body.playerId : null;
      if (user.role === 'player' && (!user.playerId || (requestedPlayerId && requestedPlayerId !== user.playerId))) return res.status(403).json({ error: 'Players may enroll only a device linked to their own roster identity.' });
      const ownerPlayerId = user.role === 'player' ? user.playerId! : requestedPlayerId;
      const db = await readDB();
      if (ownerPlayerId && !(db.rosterPlayers || []).some((item: any) => item.id === ownerPlayerId && !item.retiredAt)) return res.status(400).json({ error: 'Device owner must be an active roster player.' });
      const store = replayStore(db); const id = newDeviceId(); const token = crypto.randomBytes(32).toString('base64url'); const now = new Date();
      const device: DeviceRecord = {
        id, name, tokenHash: tokenHash(token), credentialVersion: 1,
        owner: { actorId: user.actorId, role: user.role, playerId: ownerPlayerId || null },
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + DEVICE_TTL_MS).toISOString(), revokedAt: null, lastSeenAt: null,
      };
      store.devices[id] = device; await saveDB(db);
      res.status(201).json({ device: devicePublic(device), credential: { token, shownOnce: true, storage: 'windows-dpapi-required' } });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/replay-intake/devices', async (req, res) => {
    try {
      const user = actor(req); const db = await readDB(); const store = replayStore(db);
      const visible = Object.values(store.devices).filter(device => user.role === 'coach' || (device.owner.actorId === user.actorId && device.owner.playerId === user.playerId));
      res.json(visible.map(devicePublic));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.post('/api/replay-intake/devices/revoke', async (req, res) => {
    try {
      const user = actor(req); const id = String(req.body?.deviceId || ''); const db = await readDB(); const store = replayStore(db); const device = store.devices[id];
      if (!device) return res.status(404).json({ error: 'Device not found.' });
      const ownsDevice = device.owner.actorId === user.actorId && device.owner.playerId === (user.playerId || null);
      if (user.role !== 'coach' && !ownsDevice) return res.status(403).json({ error: 'Players may revoke only their own device.' });
      delete store.devices[id];
      await saveDB(db);
      res.json({ ...devicePublic({ ...device, revokedAt: new Date().toISOString() }), removed: true });
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/replay-intake/uploads', async (req, res) => {
    try {
      const user = actor(req); const db = await readDB(); const store = replayStore(db);
      const visible = Object.values(store.associations).filter(item => user.role === 'coach' || (item.owner?.actorId === user.actorId && item.owner?.playerId === user.playerId));
      res.json(visible.flatMap(item => store.blobs[item.sha256] ? [uploadPublic(item, store.blobs[item.sha256])] : []));
    } catch (error: any) { res.status(500).json({ error: error.message }); }
  });

  app.delete('/api/replay-intake/uploads/:sha256', async (req, res) => {
    try {
      const user = actor(req); if (user.role !== 'coach') return res.status(403).json({ error: 'Only a coach can delete replay evidence.' });
      const sha256 = String(req.params.sha256 || '').toLowerCase();
      if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256];
      if (!blob) return res.status(404).json({ error: 'Replay evidence not found.' });
      const active = Object.values(store.parserJobs).some(job => job.sha256 === sha256 && ['queued', 'running'].includes(job.status));
      if (active) return res.status(409).json({ error: 'Wait for replay processing to finish before deleting it.' });
      if (blob.rawObject && blob.rawObject.status !== 'deleted') await deleteRawReplayObject(blob.rawObject);
      await fsp.rm(privateReplayPath(sha256), { force: true }).catch(() => {});
      for (const [key, association] of Object.entries(store.associations)) if (association.sha256 === sha256) delete store.associations[key];
      for (const [key, job] of Object.entries(store.parserJobs)) if (job.sha256 === sha256) delete store.parserJobs[key];
      for (const screenshot of Object.values(store.screenshots)) if (screenshot.replaySha256 === sha256) {
        screenshot.replaySha256 = null; screenshot.suggestions = []; screenshot.status = 'pending'; screenshot.reason = 'Replay deleted. Choose another replay or complete this screenshot manually.';
      }
      delete store.reviews[sha256]; delete store.blobs[sha256]; await saveDB(db);
      return res.json({ removed: true, sha256 });
    } catch (error: any) { return res.status(500).json({ error: error?.message || 'Replay evidence could not be deleted.' }); }
  });

  app.post('/api/replay-intake/uploads/:sha256/parse', async (req, res) => {
    try {
      const user = actor(req);
      if (user.role !== 'coach') return res.status(403).json({ error: 'Only a coach can start replay parsing.' });
      const sha256 = String(req.params.sha256 || '').toLowerCase();
      if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      // Configuration is checked before recording a job. Upload remains safe and parser-free by default.
      loadVrfkitPipelineConfig(PRIVATE_DIR);
      const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256];
      if (!blob) return res.status(404).json({ error: 'Private replay not found.' });
      const active = Object.values(store.parserJobs).find(job => job.sha256 === sha256 && ['queued', 'running'].includes(job.status));
      if (active) return res.status(409).json({ error: 'This replay already has an active parser job.', job: parserJobPublic(active) });
      const sourceDeviceIds = [...new Set(Object.values(store.associations).filter(item => item.sha256 === sha256).map(item => item.deviceId))].sort();
      if (!sourceDeviceIds.length) return res.status(409).json({ error: 'Replay has no private device association.' });
      const admission = parserAdmission(store, user.actorId, sourceDeviceIds);
      if (!admission.ok) return res.status(429).json({ error: admission.error });
      const now = new Date().toISOString();
      const job: ReplayParserJob = {
        id: crypto.randomUUID(), sha256, requestedBy: user.actorId, sourceDeviceIds, status: 'queued',
        createdAt: now, startedAt: null, completedAt: null,
        parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, reviewStatus: 'review-required',
        ...(blob.rawObject && blob.rawObject.status !== 'deleted' ? { rawObject: blob.rawObject } : {}),
      };
      store.parserJobs[job.id] = job; blob.parserStatus = 'pending'; blob.parserJobId = job.id; await saveDB(db);
      res.status(202).json(parserJobPublic(job));
      requestParserPump();
    } catch (error: any) {
      const failure = parserFailure(error);
      res.status(failure.code === 'parser-unavailable' ? 503 : 400).json({ error: failure.message, code: failure.code });
    }
  });

  app.get('/api/replay-intake/uploads/:sha256/parser', async (req, res) => {
    try {
      const user = actor(req); const sha256 = String(req.params.sha256 || '').toLowerCase();
      if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256];
      if (!blob || !actorCanSeeReplay(user, store, sha256)) return res.status(404).json({ error: 'Private replay not found.' });
      const job = blob.parserJobId ? store.parserJobs[blob.parserJobId] : null;
      if (user.role !== 'coach') return res.json(job ? parserJobStatusPublic(job, blob.reviewStatus) : { sha256, status: blob.parserStatus, reviewStatus: blob.reviewStatus, parser: { name: 'vrfkit', version: VRFKIT_PIN.version } });
      const screenshotPairings = Object.values(store.screenshots).filter(item => item.status === 'linked' && item.replaySha256 === sha256).map(screenshotPairingPublic);
      res.json(job ? { ...parserJobPublic(job), review: replayReviewPublic(store.reviews[sha256]), screenshotPairings } : { sha256, status: blob.parserStatus, reviewStatus: blob.reviewStatus, parser: { name: 'vrfkit', version: VRFKIT_PIN.version }, review: replayReviewPublic(store.reviews[sha256]), screenshotPairings });
    } catch (error: any) { res.status(500).json({ error: 'Replay parser status is unavailable.' }); }
  });

  app.post('/api/replay-intake/uploads/:sha256/review', async (req, res) => {
    try {
      const user = actor(req); if (user.role !== 'coach') return res.status(403).json({ error: 'Only a coach can edit replay review overlays.' });
      const sha256 = String(req.params.sha256 || '').toLowerCase(); if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const expectedRevision = Number(req.body?.expectedRevision); const requestId = cleanText(req.body?.requestId, 160);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !requestId) return res.status(400).json({ error: 'expectedRevision and requestId are required.' });
      const requestHash = contentHash(req.body); const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256]; const job = blob?.parserJobId ? store.parserJobs[blob.parserJobId] : null;
      if (!blob || !job || job.status !== 'completed' || !job.result) return res.status(409).json({ error: 'Completed parsed replay evidence is required.' });
      const current = store.reviews[sha256];
      if (current?.requestId === requestId) {
        if (current.requestHash !== requestHash) return res.status(409).json({ error: 'Idempotency key was reused with a different review.' });
        return res.json(replayReviewPublic(current));
      }
      if ((current?.revision || 0) !== expectedRevision) return res.status(409).json({ error: 'Stale review revision. Reload and retry.' });
      if (current?.status === 'accepted') return res.status(409).json({ error: 'Accepted replay mappings are immutable.' });
      const normalized = normalizeReview(req.body, job, db); const rawEvidenceHash = contentHash(job.result); const now = new Date().toISOString();
      const review: ReplayReview = { sha256, ...normalized, status: 'review-required', revision: expectedRevision + 1, requestId, requestHash, rawEvidenceHash, updatedAt: now, acceptedAt: null, acceptedBy: null, ratingDraftKeys: [] };
      store.reviews[sha256] = review; blob.matchId = review.matchId; await saveDB(db); res.json(replayReviewPublic(review));
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Replay review could not be saved.' }); }
  });

  app.post('/api/replay-intake/uploads/:sha256/accept', async (req, res) => {
    try {
      const user = actor(req); if (user.role !== 'coach') return res.status(403).json({ error: 'Only a coach can accept replay evidence.' });
      const sha256 = String(req.params.sha256 || '').toLowerCase(); if (!HEX_SHA256.test(sha256)) return res.status(400).json({ error: 'Replay SHA-256 is invalid.' });
      const expectedRevision = Number(req.body?.expectedRevision); const requestId = cleanText(req.body?.requestId, 160); const confirmed = req.body?.confirmed === true;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !requestId || !confirmed) return res.status(400).json({ error: 'Current revision, requestId, and explicit confirmation are required.' });
      const requestHash = contentHash(req.body); const db = await readDB(); const store = replayStore(db); const blob = store.blobs[sha256]; const job = blob?.parserJobId ? store.parserJobs[blob.parserJobId] : null; const review = store.reviews[sha256];
      if (!blob || !job || job.status !== 'completed' || !job.result || !review) return res.status(409).json({ error: 'A saved parsed replay review is required.' });
      if (review.status === 'accepted' && review.requestId === requestId) {
        if (review.requestHash !== requestHash) return res.status(409).json({ error: 'Idempotency key was reused with a different acceptance.' });
        return res.json(replayReviewPublic(review));
      }
      if (review.status !== 'review-required') return res.status(409).json({ error: 'A current review-required draft is required.' });
      if (review.revision !== expectedRevision) return res.status(409).json({ error: 'Stale review revision. Reload and retry.' });
      if (review.rawEvidenceHash !== contentHash(job.result)) return res.status(409).json({ error: 'Raw parser evidence changed after review. Reload before accepting.' });
      // Re-validate roster ownership and match scope at acceptance time; an earlier valid mapping may have gone stale.
      normalizeReview(review, job, db);
      review.screenshotLinks = Object.values(store.screenshots).filter(item => item.status === 'linked' && item.replaySha256 === sha256).map(item => ({ id: item.id, imageSha256: item.imageSha256, replaySha256: sha256 }));
      const accepted = acceptReviewIntoEngines(db, store, job, review, user, requestId, requestHash);
      review.status = 'accepted'; review.revision += 1; review.requestId = requestId; review.requestHash = requestHash; review.updatedAt = accepted.acceptedAt; review.acceptedAt = accepted.acceptedAt; review.acceptedBy = user.actorId; review.ratingDraftKeys = accepted.ratingDraftKeys;
      blob.reviewStatus = 'accepted'; blob.matchId = review.matchId; await saveDB(db); res.json(replayReviewPublic(review));
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Replay evidence could not be accepted.' }); }
  });

  if (process.env.CLOUDFLARE_WORKER !== 'true') await recoverParserQueue();
}

export const replayIntakeInternals = {
  REPLAY_TYPE, cleanReplayName, privateReplayPath, tokenHash, associationKey,
  parserLimits, pruneParserJobs, parserAdmission, nextParserJobs, newDeviceId, DEVICE_ID,
  recoverExpiredParserLeases, claimParserLease, leaseMatches,
  nextParserLeaseRecoveryDelay, scheduleParserLeaseRecovery,
  priorRawFinalizeReceipt, pruneRawReceipts,
};
