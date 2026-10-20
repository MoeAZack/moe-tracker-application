import crypto from 'crypto';
import type { Match, PlayerStats, Round } from '../src/types';
import { buildMapRoundIntelligence, MAP_ROUND_CALCULATION_VERSION, type MapRoundIntelligence } from './mapRoundAnalytics';
import { buildPlayerScreenshotMetrics, PLAYER_SCREENSHOT_CALCULATION_VERSION, screenshotPlayerIdentity } from './scrimRoundAnalytics';
import { derivedMetricFromPercentage, derivedMetricFromRatio, normalizeDerivedMetric, type DerivedMetricV1 } from './derivedMetric';
import { evidenceReferenceForMatch, workspaceIdentity } from './evidenceReference';
import { buildEvidenceFusionReport, type EvidenceFusionReport, type EvidenceFusionResolution } from './evidenceFusion';
import { buildContextualWeaponOutcomes, type ContextualWeaponRow } from './contextualEconomy';
import { buildSpatialReport, type SpatialReport } from './spatialIntelligence';
import { buildCalibratedPlayerRatings, type CalibratedPlayerRating } from './calibratedPlayerRatings';

export const AGGREGATE_MIGRATION_SCHEMA = 'moetracker.aggregate-migration/v1' as const;
export const MAP_ROUND_BUILDER = MAP_ROUND_CALCULATION_VERSION;
export const PLAYER_SCREENSHOT_BUILDER = PLAYER_SCREENSHOT_CALCULATION_VERSION;
export const CANONICAL_ANALYTICS_SCHEMA = 'moetracker.canonical-analytics/v1' as const;
export const CANONICAL_ANALYTICS_VERSION = 'canonical-analytics/v1' as const;

export type AggregateBuildStatus = 'recomputed' | 'source-unavailable' | 'draft-excluded' | 'duplicate-match-id';

export interface AggregateBuildRecord {
  schema: typeof AGGREGATE_MIGRATION_SCHEMA;
  matchId: string;
  status: AggregateBuildStatus;
  sourceHash: string | null;
  builders: readonly [typeof MAP_ROUND_BUILDER, typeof PLAYER_SCREENSHOT_BUILDER];
  unknownReason: 'missing-round-evidence' | 'unaccepted-evidence' | 'contradictory-match-identity' | null;
  intelligence?: { schema: 'moetracker.match-intelligence/v1'; fusion: EvidenceFusionReport; economy: ContextualWeaponRow[]; spatial: SpatialReport; calculatedAtSourceHash: string };
}

type AggregateContainer = {
  matches?: Match[];
  playerStats?: PlayerStats[];
  rounds?: Round[];
  engineAdapters?: any;
  analyticsBuilds?: Record<string, AggregateBuildRecord>;
  evidenceFusionResolutions?: EvidenceFusionResolution[];
  calibratedPlayerRatings?: CalibratedPlayerRating[];
  rosterPlayers?: any[];
  settings?: { mapCalibrations?: unknown[] };
};

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const hash = (value: unknown) => crypto.createHash('sha256').update(canonical(value)).digest('hex');

export const serializeAggregateBuildRecord = (value: AggregateBuildRecord) => canonical(value);
export const aggregateBuildKey = (value: AggregateBuildRecord) => hash(JSON.parse(serializeAggregateBuildRecord(value)));

function acceptedMatch(container: AggregateContainer, match: Match): boolean {
  if (match.sourceMetadata?.method !== 'screenshot') return true;
  if (match.reviewConfirmation?.alliedSideConfirmed === true) return true;
  return container.engineAdapters?.screenshot?.[match.id]?.status === 'accepted';
}

function sourceRows(container: AggregateContainer, match: Match) {
  return (container.rounds || [])
    .filter(round => round.matchId === match.id)
    .sort((left, right) => left.roundNo - right.roundNo || left.id.localeCompare(right.id, 'en'));
}

function sourceHash(match: Match, rounds: readonly Round[], stats: readonly PlayerStats[], resolutions: readonly EvidenceFusionResolution[] = []) {
  const { roundAnalytics: _derived, ...sourceMatch } = match;
  const playerFacts = stats.map((stat: any) => ({
    id: stat.id, playerId: stat.playerId || null, displayNameSnapshot: stat.displayNameSnapshot ?? null, player: stat.player,
    sourceMetadata: stat.sourceMetadata || null, evidenceReconciliation: stat.evidenceReconciliation || null,
    ...Object.fromEntries(['kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'headshots', 'orbPoints', 'ultimateUses', 'kastSuccessful', 'kastCovered', 'fk', 'fd', 'plants', 'defuses', 'trades'].map(field => [field, stat[field] ?? null])),
  }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'));
  return hash({ match: sourceMatch, rounds, playerFacts, resolutions: resolutions.map(item => ({ matchId: item.matchId, roundId: item.roundId, field: item.field, selectedSource: item.selectedSource, selectedValue: item.selectedValue, revision: item.revision })).sort((a, b) => `${a.roundId}:${a.field}`.localeCompare(`${b.roundId}:${b.field}`, 'en')) });
}

function record(matchId: string, status: AggregateBuildStatus, source: string | null, unknownReason: AggregateBuildRecord['unknownReason']): AggregateBuildRecord {
  return { schema: AGGREGATE_MIGRATION_SCHEMA, matchId, status, sourceHash: source, builders: [MAP_ROUND_BUILDER, PLAYER_SCREENSHOT_BUILDER], unknownReason };
}

/**
 * Rebuild one accepted match only from retained source rows. Stored aggregates
 * are never used as input. Unlinked identities are deliberately not matched by
 * name during migration.
 */
export function recomputeAcceptedMatchAggregates(container: AggregateContainer, matchId: string): AggregateBuildRecord {
  const matches = (container.matches || []).filter(match => match.id === matchId);
  if (matches.length !== 1) return record(matchId, 'duplicate-match-id', null, 'contradictory-match-identity');
  const match = matches[0];
  if (!acceptedMatch(container, match)) return record(matchId, 'draft-excluded', null, 'unaccepted-evidence');
  const rounds = sourceRows(container, match);
  if (!rounds.length) return record(matchId, 'source-unavailable', null, 'missing-round-evidence');

  const stats = (container.playerStats || []).filter(row => row.matchId === matchId); const resolutions = (container.evidenceFusionResolutions || []).filter(item => item.matchId === matchId);
  const digest = sourceHash(match, rounds, stats, resolutions); const replayRecord = container.engineAdapters?.replay?.[matchId]; const fusion = buildEvidenceFusionReport(container as any, matchId, replayRecord);
  const resolvedRounds = structuredClone(rounds); const mutableFields = new Set(['result', 'side', 'buy', 'enemyBuy', 'plant', 'site', 'firstKillBy', 'firstDeathBy']);
  for (const fusedRound of fusion.rounds) { const target = resolvedRounds.find(round => round.id === fusedRound.roundId) as any; if (!target) continue; for (const fact of fusedRound.facts) if (fact.resolved && mutableFields.has(fact.field)) target[fact.field] = structuredClone(fact.value); }
  const cleanMatch = { ...match, roundAnalytics: undefined };
  const roundAnalytics = buildMapRoundIntelligence([cleanMatch], resolvedRounds)[0];
  if (roundAnalytics) {
    match.roundAnalytics = {
      ...roundAnalytics,
      calculationVersion: MAP_ROUND_BUILDER,
      sourceHash: digest,
      unknownReasons: aggregateUnknownReasons(roundAnalytics),
    };
  }

  const built = new Map(buildPlayerScreenshotMetrics(resolvedRounds)
    .filter(metric => !metric.identity.startsWith('unlinked:'))
    .map(metric => [metric.identity, metric]));
  for (const stat of stats) {
    // A stable roster link is the only permissible migration join. An observed
    // name remains evidence, never an implicit identity key.
    if (!stat.playerId) continue;
    const metric = built.get(screenshotPlayerIdentity(stat.playerId, ''));
    if (!metric) {
      delete stat.screenshotMetrics;
      continue;
    }
    const { identity: _identity, displayName: _displayName, ...values } = metric;
    stat.screenshotMetrics = {
      ...values,
      calculationVersion: PLAYER_SCREENSHOT_BUILDER,
      sourceHash: digest,
      unknownReasons: screenshotUnknownReasons(values),
    };
  }
  const build = record(matchId, 'recomputed', digest, null);
  build.intelligence = { schema: 'moetracker.match-intelligence/v1', fusion, economy: buildContextualWeaponOutcomes({ ...(container as any), rounds: resolvedRounds }, new Set([matchId])), spatial: buildSpatialReport(replayRecord, container.settings?.mapCalibrations), calculatedAtSourceHash: digest };
  container.calibratedPlayerRatings = buildCalibratedPlayerRatings(container as any);
  return build;
}

/** Pure adapter used by previews/tests before an in-place migration is applied. */
export function buildAcceptedMatchAggregatePlan(container: AggregateContainer, matchId: string) {
  const copy = structuredClone(container);
  const build = recomputeAcceptedMatchAggregates(copy, matchId);
  const match = (copy.matches || []).find(item => item.id === matchId) || null;
  const playerStats = (copy.playerStats || []).filter(item => item.matchId === matchId);
  return { build, match, playerStats };
}

function aggregateUnknownReasons(row: MapRoundIntelligence): string[] {
  const reasons = new Set<string>();
  if (!row.coveredRounds) reasons.add('missing-round-results');
  if (!row.pistol.total) reasons.add('missing-pistol-results');
  if (!row.lowBuy.total && !row.fullBuyLosses.total) reasons.add('missing-economy-evidence');
  return [...reasons].sort();
}

function screenshotUnknownReasons(row: { kast?: { covered: number }; coveredRounds: number }): string[] {
  const reasons = new Set<string>();
  if (!row.coveredRounds) reasons.add('missing-confirmed-screenshot-rounds');
  if (!row.kast?.covered) reasons.add('missing-complete-kast-evidence');
  return [...reasons].sort();
}

/** Deterministic, in-place storage migration. Re-running produces no new rows. */
export function migrateAcceptedMatchAggregates(container: AggregateContainer) {
  const ids = [...new Set((container.matches || []).map(match => match.id))].sort((left, right) => left.localeCompare(right, 'en'));
  container.analyticsBuilds ||= {};
  const next: Record<string, AggregateBuildRecord> = {};
  for (const id of ids) next[id] = recomputeAcceptedMatchAggregates(container, id);
  container.analyticsBuilds = next;
  return {
    scanned: ids.length,
    recomputed: Object.values(next).filter(item => item.status === 'recomputed').length,
    sourceUnavailable: Object.values(next).filter(item => item.status === 'source-unavailable').length,
    draftExcluded: Object.values(next).filter(item => item.status === 'draft-excluded').length,
    conflicts: Object.values(next).filter(item => item.status === 'duplicate-match-id').length,
  };
}

function unavailableMetric(workspaceId: string, calculationVersion: string, reason: DerivedMetricV1['unknownReason']) {
  return normalizeDerivedMetric({
    schema: 'moetracker.derived-metric/v1', scope: { workspaceId }, kind: 'scalar', value: null,
    numerator: null, denominator: null, sampleCount: 0, coverage: { covered: 0, total: 0 },
    confidence: { level: 'unknown', score: null }, unknownReason: reason, provenance: 'unreferenced',
    sourceReferences: [], calculationVersion,
  });
}

/**
 * Canonical S0 analytics export. Every current surface/export can consume these
 * exact envelopes instead of interpreting legacy fields independently.
 */
export function buildCanonicalAnalyticsExport(db: any, matchId: string) {
  const workspaceId = workspaceIdentity(db);
  if (!workspaceId) throw new Error('Canonical analytics require a persisted workspace identity.');
  const plan = buildAcceptedMatchAggregatePlan(db, matchId);
  const legacyAggregate = (db.matches || []).find((item: any) => item.id === matchId)?.roundAnalytics;
  const evidence = plan.build.status === 'recomputed'
    ? [evidenceReferenceForMatch(db, matchId, { workspaceId })]
    : [];
  const options = { workspaceId, sourceReferences: evidence, calculationVersion: CANONICAL_ANALYTICS_VERSION,
    coverage: plan.match?.roundAnalytics ? { covered: Number((plan.match.roundAnalytics as any).coveredRounds || 0), total: (db.rounds || []).filter((round: any) => round.matchId === matchId).length } : { covered: 0, total: 0 } };
  const round = plan.match?.roundAnalytics as unknown as MapRoundIntelligence | undefined;
  let metrics: Record<string, DerivedMetricV1>;
  if (plan.build.status === 'recomputed' && round) {
    metrics = {
      pistolConversion: derivedMetricFromPercentage(round.pistol, options),
      postPistolConversion: derivedMetricFromPercentage(round.postPistol, options),
      earnedBonusConversion: derivedMetricFromPercentage(round.earnedBonus, options),
      lowBuyWinRate: derivedMetricFromPercentage(round.lowBuy, options),
      // This explicit ratio keeps a zero denominator unknown rather than Infinity/zero.
      openingWinLossRatio: derivedMetricFromRatio({ value: round.openingThree.total - round.openingThree.won > 0 ? round.openingThree.won / (round.openingThree.total - round.openingThree.won) : null, numerator: round.openingThree.won, denominator: round.openingThree.total - round.openingThree.won, samples: round.openingThree.total }, options),
    };
  } else {
    const reason: DerivedMetricV1['unknownReason'] = plan.build.status === 'duplicate-match-id'
      ? 'contradictory-evidence'
      : legacyAggregate ? 'unsupported-calculation' : 'missing-evidence';
    metrics = { availability: unavailableMetric(workspaceId, CANONICAL_ANALYTICS_VERSION, reason) };
  }
  const result = { schema: CANONICAL_ANALYTICS_SCHEMA, calculationVersion: CANONICAL_ANALYTICS_VERSION,
    matchId, sourceFingerprint: plan.build.sourceHash, build: plan.build, metrics };
  return { ...result, canonicalJson: canonical(result) };
}
