import crypto from 'crypto';
import { normalizeCaptureName } from './scrimCaptureImport';
import type { MatchDuplicateReview } from '../src/types';

type MutableTracker = Record<string, any>;

export interface MatchPurgeReport {
  matchId: string;
  removed: Record<string, number>;
  detached: Record<string, number>;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const count = (record: Record<string, number>, key: string, amount = 1) => { if (amount > 0) record[key] = (record[key] || 0) + amount; };

function filterArray(db: MutableTracker, key: string, predicate: (item: any) => boolean, report: MatchPurgeReport) {
  if (!Array.isArray(db[key])) return;
  const before = db[key].length;
  db[key] = db[key].filter(predicate);
  count(report.removed, key, before - db[key].length);
}

/** Remove records whose own identity belongs to a match while preserving the
 * surrounding adapter/intake containers and unrelated device credentials. */
function pruneMatchOwnedTree(value: any, matchId: string): { value: any; removed: number; empty: boolean } {
  if (!value || typeof value !== 'object') return { value, removed: 0, empty: false };
  if (text(value.matchId) === matchId || text(value.linkedMatchId) === matchId || text(value.requestedMatchId) === matchId) {
    return { value: undefined, removed: 1, empty: true };
  }
  if (Array.isArray(value)) {
    let removed = 0;
    const next = value.flatMap(item => {
      const pruned = pruneMatchOwnedTree(item, matchId); removed += pruned.removed;
      return pruned.empty ? [] : [pruned.value];
    });
    return { value: next, removed, empty: false };
  }
  let removed = 0;
  const next: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === matchId) { removed += 1; continue; }
    const pruned = pruneMatchOwnedTree(child, matchId); removed += pruned.removed;
    if (!pruned.empty) next[key] = pruned.value;
  }
  return { value: next, removed, empty: false };
}

/**
 * Delete the evidence graph owned by a match. Coach-authored goals and VOD
 * notes survive, but their deleted match/round links are detached explicitly.
 */
export function purgeMatchGraph(db: MutableTracker, matchId: string): MatchPurgeReport {
  const report: MatchPurgeReport = { matchId, removed: {}, detached: {} };
  const roundIds = new Set((db.rounds || []).filter((row: any) => row.matchId === matchId).map((row: any) => row.id));
  const statIds = new Set((db.playerStats || []).filter((row: any) => row.matchId === matchId).map((row: any) => row.id));

  filterArray(db, 'matches', item => item.id !== matchId, report);
  for (const key of ['playerStats', 'rounds', 'vetos', 'stratRuns', 'vodSubmissions', 'evidenceFusionResolutions']) {
    filterArray(db, key, item => item.matchId !== matchId && item.linkedMatchId !== matchId && item.requestedMatchId !== matchId, report);
  }

  if (db.analyticsBuilds && Object.prototype.hasOwnProperty.call(db.analyticsBuilds, matchId)) {
    delete db.analyticsBuilds[matchId]; count(report.removed, 'analyticsBuilds');
  }
  for (const key of ['engineAdapters', 'replayIntake']) {
    if (!db[key] || typeof db[key] !== 'object') continue;
    const pruned = pruneMatchOwnedTree(db[key], matchId); db[key] = pruned.value; count(report.removed, key, pruned.removed);
  }

  for (const goal of db.goals || []) {
    if (goal.matchId !== matchId && !roundIds.has(goal.roundId)) continue;
    delete goal.matchId; delete goal.roundId; delete goal.evidenceClipId; count(report.detached, 'goals');
  }
  for (const review of db.vodReviews || []) if (review.matchId === matchId) { delete review.matchId; count(report.detached, 'vodReviews'); }
  for (const block of db.practiceBlocks || []) {
    const before = Array.isArray(block.matchIds) ? block.matchIds.length : 0;
    if (before) block.matchIds = block.matchIds.filter((id: string) => id !== matchId);
    if (before !== block.matchIds?.length) count(report.detached, 'practiceBlocks');
  }

  const deletedSignalIds = new Set<string>();
  if (Array.isArray(db.coachingSignals)) {
    db.coachingSignals = db.coachingSignals.flatMap((signal: any) => {
      const matchIds = (signal.matchIds || []).filter((id: string) => id !== matchId);
      const evidenceMatchIds = (signal.evidence?.matchIds || []).filter((id: string) => id !== matchId);
      const evidenceRoundIds = (signal.evidence?.roundIds || []).filter((id: string) => !roundIds.has(id));
      if (!matchIds.length && !evidenceMatchIds.length) { deletedSignalIds.add(signal.id); count(report.removed, 'coachingSignals'); return []; }
      if (matchIds.length !== (signal.matchIds || []).length || evidenceMatchIds.length !== (signal.evidence?.matchIds || []).length || evidenceRoundIds.length !== (signal.evidence?.roundIds || []).length) count(report.detached, 'coachingSignals');
      return [{ ...signal, matchIds, evidence: { ...(signal.evidence || {}), matchIds: evidenceMatchIds, ...(signal.evidence?.roundIds ? { roundIds: evidenceRoundIds } : {}) } }];
    });
  }

  const deletedActionIds = new Set<string>();
  if (Array.isArray(db.coachingActions)) {
    db.coachingActions = db.coachingActions.flatMap((action: any) => {
      const evidenceMatchIds = (action.evidence?.matchIds || []).filter((id: string) => id !== matchId);
      const evidenceRoundIds = (action.evidence?.roundIds || []).filter((id: string) => !roundIds.has(id));
      const owned = deletedSignalIds.has(action.sourceSignalId) && !evidenceMatchIds.length;
      if (owned) { deletedActionIds.add(action.id); count(report.removed, 'coachingActions'); return []; }
      if (evidenceMatchIds.length !== (action.evidence?.matchIds || []).length || evidenceRoundIds.length !== (action.evidence?.roundIds || []).length) count(report.detached, 'coachingActions');
      return [{ ...action, evidence: { ...(action.evidence || {}), matchIds: evidenceMatchIds, ...(action.evidence?.roundIds ? { roundIds: evidenceRoundIds } : {}) } }];
    });
  }
  for (const goal of db.goals || []) {
    if (deletedSignalIds.has(goal.sourceSignalId)) { delete goal.sourceSignalId; count(report.detached, 'goalSignals'); }
    if (deletedActionIds.has(goal.coachingActionId)) { delete goal.coachingActionId; count(report.detached, 'goalActions'); }
  }

  // These are whole-workspace derived views. Rebuilding is safer than retaining
  // ratings whose source match was just removed.
  if (Array.isArray(db.calibratedPlayerRatings) && db.calibratedPlayerRatings.length) {
    count(report.removed, 'calibratedPlayerRatings', db.calibratedPlayerRatings.length); db.calibratedPlayerRatings = [];
  }
  // Defensive removal for resolutions that use the player-stat id in roundId.
  if (Array.isArray(db.evidenceFusionResolutions)) {
    const before = db.evidenceFusionResolutions.length;
    db.evidenceFusionResolutions = db.evidenceFusionResolutions.filter((item: any) => !roundIds.has(item.roundId) && !statIds.has(item.roundId));
    count(report.removed, 'evidenceFusionResolutions', before - db.evidenceFusionResolutions.length);
  }
  return report;
}

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !['id', 'matchId', 'sourceImage', 'updatedAt', 'createdAt'].includes(key) && child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonical(child)]));
}

export function exactMatchSourceTokens(match: any) {
  const tokens = new Set<string>(); const metadata = match?.sourceMetadata || {};
  if (text(metadata.externalId)) tokens.add(`external:${text(metadata.provider || metadata.method || 'source').toLocaleLowerCase('en')}:${text(metadata.externalId)}`);
  for (const [kind, value] of [['screenshot', match?.screenshotEvidence?.imageSha256], ['capture', match?.screenshotEvidence?.captureId], ['replay', match?.comparisonEvidence?.replaySha256], ['evidence', match?.evidenceReference?.sha256]] as const) {
    if (text(value)) tokens.add(`${kind}:${text(value).toLocaleLowerCase('en')}`);
  }
  return [...tokens].sort();
}

export function findExactSourceDuplicate(db: MutableTracker, match: any) {
  const target = new Set(exactMatchSourceTokens(match)); if (!target.size) return null;
  for (const candidate of db.matches || []) {
    if (candidate.id === match.id) continue;
    const token = exactMatchSourceTokens(candidate).find(item => target.has(item));
    if (token) return { existingMatchId: candidate.id, sourceToken: token };
  }
  return null;
}

/** Exact accepted screenshot round evidence only. Sparse/manual W/L sequences
 * are deliberately ineligible so common scores can never create a false block. */
export function exactRoundEvidenceFingerprint(rows: readonly any[]): string | null {
  const ordered = [...rows].sort((left, right) => Number(left.roundNo || 0) - Number(right.roundNo || 0));
  if (ordered.length < 5 || ordered.some(row => row?.screenshotEvidence?.reviewStatus !== 'confirmed')) return null;
  const rich = ordered.filter(row => (row.screenshotEvidence?.players || []).length >= 5 || (row.screenshotEvidence?.events || []).length > 0);
  if (rich.length < Math.min(5, ordered.length)) return null;
  // Opening and plant columns are excluded: the server materializes them from
  // this same evidence after save, so including them let an identical
  // re-submission escape the guard once the stored copy had been backfilled.
  const payload = ordered.map(row => canonical({
    roundNo: row.roundNo, side: row.side, result: row.result, winBy: row.winBy, buy: row.buy, enemyBuy: row.enemyBuy,
    screenshotEvidence: row.screenshotEvidence,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function findExactRoundEvidenceDuplicate(db: MutableTracker, matchId: string, rows: readonly any[]) {
  const fingerprint = exactRoundEvidenceFingerprint(rows); if (!fingerprint) return null;
  for (const match of db.matches || []) {
    if (match.id === matchId) continue;
    const candidate = (db.rounds || []).filter((round: any) => round.matchId === match.id);
    if (exactRoundEvidenceFingerprint(candidate) === fingerprint) return { existingMatchId: match.id, fingerprint };
  }
  return null;
}

export function auditExactRoundEvidenceDuplicates(db: MutableTracker) {
  const groups = new Map<string, string[]>();
  for (const match of db.matches || []) {
    const fingerprint = exactRoundEvidenceFingerprint((db.rounds || []).filter((round: any) => round.matchId === match.id));
    if (fingerprint) groups.set(fingerprint, [...(groups.get(fingerprint) || []), match.id]);
  }
  return [...groups].filter(([, matchIds]) => matchIds.length > 1).map(([fingerprint, matchIds]) => ({ fingerprint, matchIds }));
}

const finiteCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const resultCode = (value: unknown) => { const result = text(value).toUpperCase(); return result === 'W' || result === 'L' ? result : null; };
const observedName = (value: unknown) => { const raw = text(value); return normalizeCaptureName(raw.toLocaleLowerCase('en').startsWith('name:') ? raw.slice(5) : raw); };

const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Scoreboard key when all ten rows carry a name and K/D/A; null when any cell is unread. */
function completeScoreboardKey(match: any): string | null {
  const board = Array.isArray(match?.screenshotEvidence?.scoreboardPlayers) ? match.screenshotEvidence.scoreboardPlayers : [];
  if (board.length !== 10) return null;
  const rows = board.map((row: any) => {
    const name = observedName(row?.name ?? row?.extractedName); const kills = finiteCount(row?.kills); const deaths = finiteCount(row?.deaths); const assists = finiteCount(row?.assists);
    if (!name || kills === null || deaths === null || assists === null) return null;
    return [row?.allied === true ? 'ours' : row?.allied === false ? 'theirs' : null, name, kills, deaths, assists, finiteCount(row?.fk), finiteCount(row?.plants), finiteCount(row?.defuses)];
  });
  if (rows.some((row: unknown) => row === null) || new Set(rows.map((row: any) => row[1])).size !== 10) return null;
  return hash({ schema: 'moetracker.same-game-scoreboard/v1', rows: rows.sort((left: any, right: any) => String(left[1]).localeCompare(String(right[1]))) });
}

export interface SameGameEvidence {
  /** Round-facts fingerprint: the grouping key. */
  fingerprint: string;
  /** Present only when all ten scoreboard rows are fully read; used to tell apart games whose round facts collide. */
  scoreboard: string | null;
}

/**
 * Same-game evidence over facts that two captures of one finished game must
 * agree on and OCR noise does not touch: per round, the result, win condition
 * and ordered killer -> victim list, over at least ten rounds whose kill lists
 * are fully identified. Map label, date, capture folder, economy, loadouts and
 * OCR confidence are deliberately excluded because a re-capture changes them.
 * The scoreboard is optional: an unread cell must not let a re-capture through,
 * but two complete scoreboards that disagree prove two different games.
 * Scores, K/D/A totals or W/L sequences alone can never produce a fingerprint.
 */
export function sameGameEvidence(match: any, rounds: readonly any[]): SameGameEvidence | null {
  const ordered = [...rounds].sort((left, right) => Number(left?.roundNo || 0) - Number(right?.roundNo || 0));
  if (ordered.length < 10 || ordered.some(row => !Number.isInteger(Number(row?.roundNo)) || !resultCode(row?.result))) return null;
  let roundsWithKills = 0;
  const roundFacts = ordered.map(row => {
    const evidence = row?.screenshotEvidence;
    const names = new Map<string, string>((evidence?.players || []).map((player: any) => [text(player?.playerId), observedName(player?.displayName)]));
    const who = (id: unknown) => names.get(text(id)) || observedName(id) || null;
    const kills = [...(evidence?.events || [])]
      .sort((left: any, right: any) => Number(left?.sequence) - Number(right?.sequence))
      .map((event: any) => [who(event?.killerPlayerId), who(event?.victimPlayerId)]);
    if (kills.length && kills.every(([killer, victim]) => killer && victim)) roundsWithKills += 1;
    return [Number(row.roundNo), resultCode(row.result), text(row.winBy).toLocaleLowerCase('en') || null, kills];
  });
  if (roundsWithKills < 10) return null;
  return { fingerprint: hash({ schema: 'moetracker.same-game/v2', rounds: roundFacts }), scoreboard: completeScoreboardKey(match) };
}

export function stableMatchEvidenceFingerprint(match: any, rounds: readonly any[]): string | null {
  return sameGameEvidence(match, rounds)?.fingerprint ?? null;
}

/**
 * Re-evaluate same-game duplicates across the workspace. In each group the
 * first stored match is the original and carries no review. A later copy is
 * quarantined (excluded from analytics, never deleted) until a coach keeps or
 * discards it. A coach's keep decision stays in force when further copies
 * arrive; it only gains the new candidate ids. Returns the quarantined ids.
 */
export function refreshDuplicateQuarantine(db: MutableTracker, now = new Date().toISOString()) {
  const groups = new Map<string, Array<{ match: any; scoreboard: string | null }>>();
  if (!Array.isArray(db.matches)) return [];
  const rounds = Array.isArray(db.rounds) ? db.rounds : [];
  for (const match of db.matches) {
    const evidence = sameGameEvidence(match, rounds.filter((round: any) => round.matchId === match.id));
    if (evidence) groups.set(evidence.fingerprint, [...(groups.get(evidence.fingerprint) || []), { match, scoreboard: evidence.scoreboard }]);
    else if (match.duplicateReview) delete match.duplicateReview;
  }
  const quarantined: string[] = [];
  for (const [fingerprint, members] of groups) {
    members.forEach((member, index) => {
      const compatible = (other: { scoreboard: string | null }) => !member.scoreboard || !other.scoreboard || other.scoreboard === member.scoreboard;
      const earlier = members.slice(0, index).filter(compatible);
      const match = member.match; const prior: MatchDuplicateReview | undefined = match.duplicateReview;
      if (!earlier.length) { if (prior) delete match.duplicateReview; return; }
      const candidateMatchIds = members.filter(other => other !== member && compatible(other)).map(other => other.match.id);
      const known = prior?.fingerprint === fingerprint;
      if (known && prior!.status === 'kept-distinct') { match.duplicateReview = { ...prior!, candidateMatchIds }; return; }
      match.duplicateReview = { schema: 'moetracker.duplicate-review/v1', status: 'quarantined', fingerprint, candidateMatchIds, detectedAt: known ? prior!.detectedAt : now } satisfies MatchDuplicateReview;
      quarantined.push(match.id);
    });
  }
  return quarantined;
}

export const isDuplicateQuarantined = (match: any) => match?.duplicateReview?.status === 'quarantined';

/** Preserve round identity by explicit id first and round number second. */
export function stableRoundReplacement(existing: readonly any[], submitted: readonly any[], uid: () => string) {
  const byId = new Map(existing.map(row => [row.id, row]));
  const byRoundNo = new Map(existing.filter(row => Number.isInteger(row.roundNo)).map(row => [row.roundNo, row]));
  const seenIds = new Set<string>(); const seenRoundNos = new Set<number>();
  return submitted.map(row => {
    const roundNo = Number(row.roundNo);
    if (!Number.isInteger(roundNo) || roundNo < 1 || roundNo > 100) throw Object.assign(new Error('Every round requires a unique number from 1 to 100.'), { status: 400 });
    if (seenRoundNos.has(roundNo)) throw Object.assign(new Error('Round numbers must be unique within a match.'), { status: 400 });
    seenRoundNos.add(roundNo);
    const explicitId = text(row.id); const prior = explicitId ? byId.get(explicitId) : byRoundNo.get(roundNo);
    if (explicitId && !prior && existing.length) throw Object.assign(new Error('A submitted round ID does not belong to this match.'), { status: 409 });
    const id = prior?.id || explicitId || uid();
    if (seenIds.has(id)) throw Object.assign(new Error('Round IDs must be unique within a match.'), { status: 400 });
    seenIds.add(id);
    return { ...row, id, roundNo };
  });
}

export function purgeRemovedRoundReferences(db: MutableTracker, matchId: string, retainedRoundIds: ReadonlySet<string>) {
  const removedRoundIds = new Set((db.rounds || []).filter((row: any) => row.matchId === matchId && !retainedRoundIds.has(row.id)).map((row: any) => row.id));
  if (!removedRoundIds.size) return { removedResolutions: 0, detachedGoals: 0, detachedSignals: 0, detachedActions: 0 };
  const before = (db.evidenceFusionResolutions || []).length;
  db.evidenceFusionResolutions = (db.evidenceFusionResolutions || []).filter((item: any) => item.matchId !== matchId || !removedRoundIds.has(item.roundId));
  let detachedGoals = 0; for (const goal of db.goals || []) if (removedRoundIds.has(goal.roundId)) { delete goal.roundId; delete goal.evidenceClipId; detachedGoals += 1; }
  let detachedSignals = 0; for (const signal of db.coachingSignals || []) if (signal.evidence?.roundIds?.some((id: string) => removedRoundIds.has(id))) { signal.evidence.roundIds = signal.evidence.roundIds.filter((id: string) => !removedRoundIds.has(id)); detachedSignals += 1; }
  let detachedActions = 0; for (const action of db.coachingActions || []) if (action.evidence?.roundIds?.some((id: string) => removedRoundIds.has(id))) { action.evidence.roundIds = action.evidence.roundIds.filter((id: string) => !removedRoundIds.has(id)); detachedActions += 1; }
  return { removedResolutions: before - db.evidenceFusionResolutions.length, detachedGoals, detachedSignals, detachedActions };
}

/** Remove only references whose parent match no longer exists. Used once by the
 * schema-13 migration; live deletions use purgeMatchGraph for the richer policy. */
export function repairOrphanMatchReferences(db: MutableTracker) {
  const matchIds = new Set((db.matches || []).map((match: any) => match.id));
  const removed: Record<string, number> = {};
  for (const key of ['playerStats', 'rounds', 'vetos', 'stratRuns', 'vodSubmissions', 'evidenceFusionResolutions']) {
    if (!Array.isArray(db[key])) continue;
    const before = db[key].length;
    db[key] = db[key].filter((item: any) => {
      const reference = item.matchId || item.linkedMatchId;
      return !reference || matchIds.has(reference);
    });
    count(removed, key, before - db[key].length);
  }
  if (db.analyticsBuilds && typeof db.analyticsBuilds === 'object') for (const key of Object.keys(db.analyticsBuilds)) if (!matchIds.has(key)) { delete db.analyticsBuilds[key]; count(removed, 'analyticsBuilds'); }
  return removed;
}
