import { z } from 'zod';

// The app stores flexible row objects, so we validate the envelope/types and known
// required fields, but allow extra properties rather than over-constraining the data.
const looseObject = z.object({}).passthrough();
const nonEmpty = z.string().min(1);
const shortText = z.string().min(1).max(5000);
const imagePayload = z.object({ base64: nonEmpty, mediaType: nonEmpty });
const roleSchema = z.enum(['coach', 'player']);

export const loginKeySchema = z.object({ key: z.string().min(1).max(500), playerName: z.string().trim().min(1).max(100).optional(), desktopIdentity: z.object({ role: z.literal('player'), playerId: z.string().trim().min(1).max(200), displayName: z.string().trim().min(1).max(80) }).optional() });
export const googleAuthSchema = z.object({ credential: z.string().min(1).max(8000) });

export const upsertSchema = z.object({
  sheet: z.enum(['Schedule', 'Goals', 'SoloQ', 'Strats', 'StratRuns']),
  row: looseObject
});
export const removeSchema = z.object({ sheet: nonEmpty, id: nonEmpty });
export const idSchema = z.object({ id: nonEmpty });

export const settingsSchema = z.object({
  teamName: z.string().min(1).max(200).optional(),
  season: z.string().max(200).optional(),
  theme: z.enum(['slate', 'cosmic', 'daylight', 'radiant']).optional(),
  density: z.string().max(50).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  confirmOnSave: z.boolean().optional(),
  confirmOnDelete: z.boolean().optional(),
  attendanceGraceMinutes: z.number().int().min(0).max(120).optional(),
  attendanceCheckInOpenMinutes: z.number().int().min(0).max(1440).optional(),
  attendanceCheckInCloseMinutes: z.number().int().min(10).max(1440).optional(),
  attendanceStrikesPerRedDot: z.number().int().min(1).max(20).optional(),
  attendanceRedDotCost: z.number().finite().min(0).max(1000000).optional(),
  attendanceCurrency: z.string().trim().min(1).max(12).optional(),
  // Player membership is managed only by the roster endpoints. Legacy settings
  // arrays are a server-maintained projection for name-based match selectors.
  maps: z.array(z.string().min(1).max(100)).max(100).optional(),
  inactiveMaps: z.array(z.string().min(1).max(100)).max(100).optional(),
  agents: z.array(z.string().min(1).max(100)).max(100).optional(),
  inactiveAgents: z.array(z.string().min(1).max(100)).max(100).optional(),
  matchTypes: z.array(z.string().max(100)).max(50).optional(),
  attendanceStates: z.array(z.string().max(100)).max(50).optional(),
  goalStates: z.array(z.string().max(100)).max(50).optional(),
  calendars: z.array(looseObject).max(50).optional(),
  riotIds: z.record(z.string(), looseObject).optional(),
  vlr: z.object({ baseUrl: z.url().or(z.literal('')), teamId: z.string().max(100), teamName: z.string().max(200) }).optional(),
  ai: z.object({ model: z.string().min(1).max(100) }).optional(),
  weights: looseObject.optional(),
  buyTypes: z.array(z.string().max(100)).max(50).optional(),
  winReasons: z.array(z.string().max(100)).max(50).optional(),
  sites: z.array(z.string().max(20)).max(20).optional(),
  vetoActions: z.array(z.string().max(50)).max(20).optional(),
  stats: looseObject.optional()
});

export const attendanceCheckInSchema = z.object({ scheduleId: z.string().trim().min(1).max(200) }).strict();
export const attendanceGreenCreditSchema = z.object({ playerId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict();
export const attendanceCreditRevokeSchema = z.object({ creditId: z.string().uuid(), reason: z.string().trim().min(1).max(500) }).strict();
export const attendanceCorrectionSchema = z.object({ scheduleId: z.string().trim().min(1).max(200), playerId: z.string().uuid(), status: z.enum(['on-time', 'late', 'excused', 'clear']), reason: z.string().trim().min(1).max(500) }).strict();

const unknownInt = (max: number) => z.number().finite().int().min(0).max(max).nullable().optional();
const unknownPercent = z.number().finite().min(0).max(100).nullable().optional();
const sourceMetadataSchema = z.object({
  method: z.enum(['manual', 'screenshot', 'live-logger', 'provider-import', 'vod-submission', 'unknown']),
  capturedAt: z.string().datetime({ offset: true }),
  provider: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  externalId: z.string().max(500).optional(),
}).strict();
const playerStatSchema = looseObject.extend({
  id: z.string().max(200).optional(),
  matchId: z.string().max(200).optional(),
  player: z.string().max(200).optional(),
  playerId: z.string().uuid().nullable().optional(),
  displayNameSnapshot: z.string().trim().min(1).max(200).optional(),
  appearanceType: z.enum(['core', 'tryout', 'standIn']).optional(),
  agent: z.string().max(100).nullable().optional(),
  roleSnapshot: z.string().trim().min(1).max(100).optional(),
  kAtt: unknownInt(200), kDef: unknownInt(200), dAtt: unknownInt(200), dDef: unknownInt(200),
  aAtt: unknownInt(200), aDef: unknownInt(200), kills: unknownInt(400), deaths: unknownInt(400), assists: unknownInt(400),
  acs: unknownInt(1000), adr: unknownInt(1000), hs: unknownPercent, headshots: unknownInt(400), headshotEligibleKills: unknownInt(400), orbPoints: unknownInt(100), fk: unknownInt(100), fd: unknownInt(100),
  plants: unknownInt(100), defuses: unknownInt(100), cl: unknownInt(100), clAtt: unknownInt(100),
  mk3: unknownInt(100), mk4: unknownInt(100), mk5: unknownInt(100), dTraded: unknownInt(200), kTraded: unknownInt(200),
  rating: z.preprocess(value => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number().finite().min(0).max(10).nullable().optional()),
  performanceScore: unknownInt(1000),
  headToHead: z.array(z.object({ opponent: z.string().max(200).nullable(), kills: z.number().int().min(0).max(100), deaths: z.number().int().min(0).max(100), assists: z.number().int().min(0).max(100) }).strict()).max(5).optional(),
  rowOperation: z.literal('create').optional(),
  sourceMetadata: sourceMetadataSchema.optional(),
  identityCorrection: z.object({
    fields: z.array(z.enum(['playerId', 'displayNameSnapshot', 'agent', 'appearanceType'])).min(1).max(4),
    reason: z.string().trim().min(1).max(500),
  }).strict().optional(),
});
const matchStatsUpdateSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('preserve') }).strict(),
  z.object({ operation: z.literal('replace'), stats: z.array(playerStatSchema).max(20) }).strict(),
]);
const rosterContextSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('core') }).strict(),
  z.object({ kind: z.literal('tryout'), tryoutBatchId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('mixed'), tryoutBatchId: z.string().uuid().optional() }).strict(),
  z.object({ kind: z.literal('unclassified') }).strict(),
]);
export const saveMatchSchema = z.object({
  match: looseObject.extend({
    id: z.string().max(200).optional(),
    date: z.string().max(20).optional(),
    type: z.string().max(100).optional(),
    opponent: z.string().max(200).optional(),
    opponentCategory: z.string().trim().min(1).max(100).optional(),
    map: z.string().max(100).nullable().optional(),
    attW: unknownInt(100), attL: unknownInt(100), defW: unknownInt(100), defL: unknownInt(100),
    ourScore: unknownInt(100), theirScore: unknownInt(100),
    rosterContext: rosterContextSchema.optional(),
    sourceMetadata: sourceMetadataSchema.optional(),
    reviewConfirmation: z.object({
      alliedSideConfirmed: z.boolean(),
      confirmedAt: z.string().datetime({ offset: true }).optional(),
      confirmedBy: z.string().max(200).optional(),
    }).strict().optional(),
  }),
  statsUpdate: matchStatsUpdateSchema.optional(),
}).strict();
export const saveRoundsSchema = z.object({ matchId: nonEmpty, rows: z.array(looseObject).optional() });
export const saveVetoSchema = z.object({ matchId: nonEmpty, meta: looseObject, actions: z.array(looseObject).optional() });

export const setSecretSchema = z.object({ name: z.string().min(1).max(100), value: z.string().max(8000).optional().nullable() });

export const accessAddSchema = z.object({ email: z.string().email().max(200), role: z.enum(['coach', 'player']).optional(), name: z.string().max(200).optional(), playerId: z.string().uuid().optional() });
export const accessRemoveSchema = z.object({ email: z.string().min(1).max(200) });
export const createKeySchema = z.object({ label: z.string().trim().min(1).max(200), role: roleSchema, playerId: z.string().trim().min(1).max(200).optional() });
export const playerPasswordSchema = z.object({ playerId: z.string().uuid(), password: z.string().trim().min(10).max(128) }).strict();

const rosterName = z.string().trim().min(1).max(100);
const rosterId = z.string().uuid();
export const rosterPlayerCreateSchema = z.object({ displayName: rosterName });
export const rosterPlayerIdSchema = z.object({ playerId: rosterId });
export const observedRosterStatusSchema = z.object({
  playerId: rosterId.optional(),
  displayName: rosterName,
  status: z.enum(['core', 'standIn', 'tryout']),
}).strict();
export const observedRosterArchiveSchema = z.object({
  playerId: rosterId.optional(),
  displayName: rosterName.optional(),
}).strict().refine(value => Boolean(value.playerId || value.displayName), 'A player identity or observed name is required.');
export const tryoutCreateSchema = z.object({ name: rosterName });
export const tryoutCandidateSchema = z.object({ batchId: rosterId, playerId: rosterId });
export const tryoutBatchIdSchema = z.object({ batchId: rosterId });
export const tryoutArchiveResetSchema = z.object({ batchId: rosterId, newBatchName: rosterName });
export const tryoutsModeSchema = z.object({ enabled: z.boolean(), name: rosterName.optional() }).strict();
export const tryoutAliasSchema = z.object({ batchId: rosterId, playerId: rosterId, alias: rosterName }).strict();
export const seasonArchiveResetSchema = z.object({
  archiveName: rosterName,
  newSeasonName: rosterName,
});
export const seasonArchiveRestoreSchema = z.object({ archiveId: rosterId });

export const practiceBlockSaveSchema = z.object({
  id: rosterId.optional(), name: rosterName, matchIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
}).strict();
export const practiceBlockSplitSchema = z.object({
  id: rosterId, name: rosterName, remainingName: rosterName.optional(), matchIds: z.array(z.string().trim().min(1).max(200)).min(1).max(99),
}).strict();
export const practiceBlockMergeSchema = z.object({ ids: z.array(rosterId).min(2).max(20), name: rosterName }).strict();
export const tryoutDecisionNoteSchema = z.object({ id: rosterId.optional(), playerId: rosterId, text: z.string().trim().min(1).max(5000) }).strict();
export const tryoutDecisionNoteRemoveSchema = z.object({ id: rosterId }).strict();

export const vodSaveSchema = z.object({ review: looseObject });
export const vodNoteSchema = z.object({ reviewId: nonEmpty, seconds: z.number().min(0).max(86_400).optional(), timeLabel: z.string().max(20).optional(), roundNo: z.number().int().min(1).max(100).optional(), text: shortText });
export const vodNoteRemoveSchema = z.object({ reviewId: nonEmpty, noteId: nonEmpty });
export const vodReplySchema = z.object({ reviewId: nonEmpty, noteId: nonEmpty, text: shortText });
const vodMetric = z.number().finite().int().min(0).max(2000).nullable();
const vodSignalSupport = z.enum(['complete', 'partial', 'unsupported']);
const vodTimelineEvidenceSchema = z.object({
  schema: z.literal('moetracker.vod-timeline-evidence/v1'), grade: z.literal('video-observation'),
  source: z.object({ kind: z.enum(['youtube', 'local-file']), videoId: z.string().max(30).nullable().optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().max(16384), height: z.number().int().positive().max(16384), durationMs: z.number().int().positive().max(14_400_000), analyzedAt: z.string().datetime({ offset: true }) }).strict(),
  coverage: z.object({ durationMs: z.number().int().positive().max(14_400_000), killFeedSnapshots: z.number().int().min(0).max(5000), objectiveSnapshots: z.number().int().min(0).max(5000), ultimateSnapshots: z.number().int().min(0).max(5000), resolvedEliminations: z.number().int().min(0).max(1000), inferredRoundGroups: z.number().int().min(0).max(200), signals: z.record(z.string().max(50), vodSignalSupport) }).strict(),
  observations: z.array(z.object({ id: z.string().max(100), kind: z.string().max(50), timestampMs: z.number().int().min(0).max(14_400_000), confidence: z.number().min(0).max(1).nullable(), grade: z.enum(['video-observation', 'ocr']), killer: z.string().max(100).optional(), victim: z.string().max(100).optional(), player: z.string().max(100).optional(), rawText: z.string().max(1000).optional() }).passthrough()).max(2000),
  rounds: z.array(z.object({ roundNumber: z.number().int().min(1).max(200), startedAtMs: z.number().int().min(0), endedAtMs: z.number().int().min(0), events: z.array(z.unknown()).max(50) }).strict()).max(200),
  playerMetrics: z.array(z.object({ playerName: z.string().max(100), team: z.enum(['ours', 'theirs']), kills: z.number().int().min(0).max(500), deaths: z.number().int().min(0).max(500), trades: z.number().int().min(0).max(500), ultimateUses: vodMetric, orbCaptures: vodMetric, kastSuccessful: vodMetric, kastCovered: vodMetric, kastRate: z.number().min(0).max(100).nullable() }).strict()).max(10),
  throwCandidates: z.array(z.unknown()).max(200), limitations: z.array(z.string().max(500)).max(20),
}).strict();
export const vodSubmissionSchema = z.object({
  vodUrl: z.string().trim().url().max(2000).refine(value => /^https?:\/\//i.test(value), 'VOD links must use HTTP or HTTPS.'),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  matchId: z.string().trim().max(200).optional(),
  playerId: rosterId.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  map: z.string().trim().max(100).nullable(),
  opponent: z.string().trim().max(160).nullable(),
  ourScore: z.number().finite().int().min(0).max(100).nullable(),
  theirScore: z.number().finite().int().min(0).max(100).nullable(),
  players: z.array(z.object({
    observedName: z.string().trim().min(1).max(100),
    agent: z.string().trim().max(100).nullable(),
    kills: vodMetric, deaths: vodMetric, assists: vodMetric, acs: vodMetric, adr: vodMetric,
    hs: vodMetric, fk: vodMetric, fd: vodMetric, plants: vodMetric, defuses: vodMetric, trades: vodMetric,
  }).strict()).length(5),
  timelineEvidence: vodTimelineEvidenceSchema.nullable().optional(),
}).strict();

export const lineupSaveSchema = z.object({ lineup: looseObject });
export const lineupCommentSchema = z.object({ lineupId: nonEmpty, text: shortText });

export const scrimImportSchema = z.object({ scoreboard: imagePayload, timeline: imagePayload.optional() });
export const screenshotSchema = imagePayload;

const screenshotInt = (max: number) => z.number().finite().int().min(0).max(max).nullable().optional();
export const screenshotExtractionSchema = z.object({
  map: z.string().max(100).nullable().optional(),
  ourScore: screenshotInt(100),
  theirScore: screenshotInt(100),
  confident: z.boolean().optional(),
  players: z.array(z.object({
    name: z.string().max(200),
    agent: z.string().max(100).nullable().optional(),
    kills: screenshotInt(400),
    deaths: screenshotInt(400),
    assists: screenshotInt(400),
    acs: screenshotInt(1000),
    adr: screenshotInt(1000),
    hs: z.number().finite().int().min(0).max(100).nullable().optional(),
    fk: screenshotInt(100),
    fd: screenshotInt(100),
  }).passthrough()).max(20).default([]),
}).passthrough();
const localScreenshotMetric = (max: number) => z.number().finite().int().min(0).max(max).nullable().optional();
const localScreenshotExtractionSchema = z.object({
  map: z.string().max(100).nullable(),
  ourScore: localScreenshotMetric(100),
  theirScore: localScreenshotMetric(100),
  confident: z.boolean(),
  players: z.array(z.object({
    name: z.string().max(200), agent: z.string().max(100).nullable(),
    kills: localScreenshotMetric(100), deaths: localScreenshotMetric(100), assists: localScreenshotMetric(100),
    acs: localScreenshotMetric(1000), adr: localScreenshotMetric(1000), hs: localScreenshotMetric(100),
    fk: localScreenshotMetric(50), fd: localScreenshotMetric(50), plants: localScreenshotMetric(50), defuses: localScreenshotMetric(50),
  }).strict()).length(10),
}).strict();
export const localScreenshotSubmissionSchema = z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime(),
  extraction: localScreenshotExtractionSchema,
}).strict();
export const screenshotTimelineSchema = z.object({
  rounds: z.array(z.object({
    roundNo: z.number().finite().int().min(1).max(100),
    won: z.boolean(),
    winCondition: z.string().max(100).nullable().optional(),
  }).passthrough()).max(100),
}).passthrough();
