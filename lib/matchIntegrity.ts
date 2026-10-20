import crypto from 'crypto';

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
  for (const [kind, value] of [['screenshot', match?.screenshotEvidence?.imageSha256], ['replay', match?.comparisonEvidence?.replaySha256], ['evidence', match?.evidenceReference?.sha256]] as const) {
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
  const payload = ordered.map(row => canonical({
    roundNo: row.roundNo, side: row.side, result: row.result, winBy: row.winBy, buy: row.buy, enemyBuy: row.enemyBuy,
    plant: row.plant, site: row.site, firstKillBy: row.firstKillBy, firstDeathBy: row.firstDeathBy,
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
