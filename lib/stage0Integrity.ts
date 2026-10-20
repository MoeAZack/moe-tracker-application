import crypto from 'crypto';
import { currentAnalyticsIdentityPolicy, projectCurrentPlayerAnalytics } from './activePlayerAnalytics';
import { STORAGE_SCHEMA_VERSION } from './storageSchema';
import { buildCanonicalDataSpine, validateCanonicalDataSpine } from './canonicalDataSpine';
import { auditPhysicalMatchDuplicates } from './physicalMatchIdentity';
import { auditAcceptedAnonymousLeaks } from './acceptedIdentityProjection';

export type Stage0IssueSeverity = 'error' | 'warning';
export type Stage0Issue = { code: string; severity: Stage0IssueSeverity; message: string; references: string[] };

const arrays = ['matches', 'playerStats', 'rounds', 'schedule', 'goals', 'rosterPlayers', 'coreMemberships', 'tryoutBatches', 'vodSubmissions', 'coachingSignals', 'coachingActions', 'calibratedPlayerRatings'] as const;
const id = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const acceptedMatch = (match: any) => match?.sourceMetadata?.method === 'screenshot'
  ? match?.reviewConfirmation?.alliedSideConfirmed === true
  : match?.comparisonEvidence?.accepted === true || (!!match?.sourceMetadata && match.sourceMetadata.method !== 'unknown');

function sourceToken(match: any) {
  const metadata = match?.sourceMetadata || {};
  const external = id(metadata.externalId);
  if (external) return `${metadata.provider || metadata.method || 'source'}:${external}`;
  const hashes = [match?.screenshotEvidence?.imageSha256, match?.comparisonEvidence?.replaySha256, match?.evidenceReference?.sha256].map(id).filter(Boolean);
  return hashes.length ? hashes.sort().join(':') : null;
}

function duplicateValues(values: Array<{ value: string; reference: string }>) {
  const seen = new Map<string, string[]>();
  for (const entry of values) if (entry.value) seen.set(entry.value, [...(seen.get(entry.value) || []), entry.reference]);
  return [...seen.entries()].filter(([, references]) => references.length > 1);
}

function unknownZeroIssues(value: unknown, path = '$', issues: Stage0Issue[] = []) {
  if (!value || typeof value !== 'object') return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => unknownZeroIssues(item, `${path}[${index}]`, issues));
    return issues;
  }
  const record = value as Record<string, unknown>;
  const unavailable = ['unknown', 'unavailable', 'unsupported', 'missing-evidence', 'source-unavailable'].includes(String(record.availability || record.status || '').toLowerCase()) || typeof record.unknownReason === 'string';
  if (unavailable) {
    for (const field of ['value', 'count', 'rate', 'percentage', 'total']) if (record[field] === 0) issues.push({ code: 'UNKNOWN_AS_ZERO', severity: 'error', message: `${path}.${field} stores zero while the metric is unavailable.`, references: [`${path}.${field}`] });
  }
  for (const [key, child] of Object.entries(record)) unknownZeroIssues(child, `${path}.${key}`, issues);
  return issues;
}

export function auditStage0Integrity(state: any): { ok: boolean; errors: number; warnings: number; issues: Stage0Issue[] } {
  const issues: Stage0Issue[] = [];
  for (const collection of arrays) {
    const rows = Array.isArray(state?.[collection]) ? state[collection] : [];
    for (const [duplicateId, references] of duplicateValues(rows.map((row: any, index: number) => ({ value: id(row?.id), reference: `${collection}[${index}]` })))) {
      issues.push({ code: 'DUPLICATE_ENTITY_ID', severity: 'error', message: `${collection} repeats id ${duplicateId}.`, references });
    }
  }

  const matches = Array.isArray(state?.matches) ? state.matches : [];
  const accepted = matches.filter(acceptedMatch);
  for (const [token, references] of duplicateValues(accepted.map((match: any, index: number) => ({ value: sourceToken(match) || '', reference: `matches[${matches.indexOf(match)}]:${id(match.id) || index}` })))) {
    issues.push({ code: 'DUPLICATE_ACCEPTED_SOURCE', severity: 'error', message: `Accepted matches reuse source evidence ${token}.`, references });
  }
  for (const duplicate of auditPhysicalMatchDuplicates(state)) issues.push({ code: 'DUPLICATE_PHYSICAL_MATCH', severity: 'warning', message: 'Multiple records appear to describe the same physical match across ingestion sources.', references: duplicate.matchIds.map(matchId => `match:${matchId}`) });
  for (const leak of auditAcceptedAnonymousLeaks(state)) issues.push({ code: 'ACCEPTED_IDENTITY_LEAK', severity: 'error', message: 'Accepted replay identity still renders as an anonymous or parser identifier.', references: [leak.reference] });

  const matchIds = new Set(matches.map((match: any) => id(match?.id)).filter(Boolean));
  for (const collection of ['playerStats', 'rounds'] as const) {
    for (const row of Array.isArray(state?.[collection]) ? state[collection] : []) {
      if (id(row?.matchId) && !matchIds.has(id(row.matchId))) issues.push({ code: 'ORPHAN_MATCH_REFERENCE', severity: 'error', message: `${collection} row references a missing match.`, references: [`${collection}:${id(row?.id) || 'unknown'}`, `match:${id(row.matchId)}`] });
    }
  }

  for (const match of accepted) if (!match.sourceMetadata || !id(match.sourceMetadata.method) || match.sourceMetadata.method === 'unknown') issues.push({ code: 'DERIVED_WITHOUT_SOURCE', severity: 'error', message: 'An accepted match has no explicit source metadata.', references: [`match:${id(match.id) || 'unknown'}`] });
  for (const row of Array.isArray(state?.playerStats) ? state.playerStats : []) if (!row?.sourceMetadata && accepted.some((match: any) => id(match.id) === id(row?.matchId))) issues.push({ code: 'DERIVED_WITHOUT_SOURCE', severity: 'error', message: 'An accepted player metric row has no source metadata.', references: [`playerStats:${id(row?.id) || 'unknown'}`] });
  for (const [key, build] of Object.entries(state?.analyticsBuilds || {}) as Array<[string, any]>) if (build?.status === 'ready' && !id(build?.sourceHash)) issues.push({ code: 'DERIVED_WITHOUT_SOURCE', severity: 'error', message: 'A ready analytics build has no source hash.', references: [`analyticsBuilds:${key}`] });

  const retiredIds = new Set((state?.rosterPlayers || []).filter((player: any) => player?.retiredAt).map((player: any) => id(player.id)).filter(Boolean));
  for (const rating of state?.calibratedPlayerRatings || []) if (retiredIds.has(id(rating?.playerId))) issues.push({ code: 'ACTIVE_METRIC_REFERENCES_ARCHIVED_PLAYER', severity: 'error', message: 'A current calibrated rating references an archived player.', references: [`rating:${id(rating?.id) || id(rating?.playerId)}`] });
  for (const action of state?.coachingActions || []) if (!['completed', 'dismissed', 'deleted'].includes(String(action?.state || '')) && (action?.ownerIds || []).some((owner: unknown) => retiredIds.has(id(owner)))) issues.push({ code: 'ACTIVE_METRIC_REFERENCES_ARCHIVED_PLAYER', severity: 'error', message: 'An active coaching action references an archived player.', references: [`action:${id(action?.id) || 'unknown'}`] });

  if (state?.settings && Array.isArray(state?.rosterPlayers) && Array.isArray(state?.playerStats) && Array.isArray(state?.rounds)) {
    const policy = currentAnalyticsIdentityPolicy(state);
    const projected = projectCurrentPlayerAnalytics(state);
    for (const row of projected.playerStats || []) if (!policy.isVisible(row.playerId, row.displayNameSnapshot || row.player)) issues.push({ code: 'ARCHIVED_PLAYER_LEAK', severity: 'error', message: 'Archived evidence leaked into current player analytics.', references: [`playerStats:${id(row.id) || 'unknown'}`] });
  }

  unknownZeroIssues({ analyticsBuilds: state?.analyticsBuilds || {}, calibratedPlayerRatings: state?.calibratedPlayerRatings || [] }, '$', issues);
  if (state?.workspace?.id) {
    try {
      const spine = validateCanonicalDataSpine(buildCanonicalDataSpine(state));
      for (const issue of spine.issues) issues.push({ code: 'CANONICAL_SPINE_REFERENCE', severity: 'error', message: `Canonical data spine failed ${issue.code}.`, references: [issue.reference] });
    } catch (error: any) {
      issues.push({ code: 'CANONICAL_SPINE_BUILD', severity: 'error', message: error?.message || 'Canonical data spine could not be built.', references: [] });
    }
  }
  const errors = issues.filter(issue => issue.severity === 'error').length;
  return { ok: errors === 0, errors, warnings: issues.length - errors, issues };
}

export function stage0BaselineSummary(state: any) {
  const total = (field: string) => (state?.matches || []).reduce((sum: number, match: any) => sum + (Number.isFinite(Number(match?.[field])) ? Number(match[field]) : 0), 0);
  const won = (state?.matches || []).filter((match: any) => Number(match?.ourScore ?? totalScore(match, 'W')) > Number(match?.theirScore ?? totalScore(match, 'L'))).length;
  return {
    storageSchemaVersion: Number(state?._storage?.schemaVersion || STORAGE_SCHEMA_VERSION),
    counts: Object.fromEntries(arrays.map(key => [key, Array.isArray(state?.[key]) ? state[key].length : 0])),
    matchTotals: { wins: won, losses: (state?.matches || []).length - won, attackWins: total('attW'), attackLosses: total('attL'), defenseWins: total('defW'), defenseLosses: total('defL') },
    archivedRosterPlayers: (state?.rosterPlayers || []).filter((player: any) => player?.retiredAt).length,
    stateFingerprint: crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex'),
  };
}

function totalScore(match: any, suffix: 'W' | 'L') { return Number(match?.[`att${suffix}`] || 0) + Number(match?.[`def${suffix}`] || 0); }

export function assertStage0Integrity(state: any) {
  const result = auditStage0Integrity(state);
  if (!result.ok) throw Object.assign(new Error(`Stage 0 integrity failed with ${result.errors} error(s).`), { result });
  return result;
}
