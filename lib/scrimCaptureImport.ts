import type { RoundScreenshotEvidence } from '../src/types';

export function normalizeCaptureName(value: unknown): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+[0-9]{1,2}$/g, '')
    // Keep letters from every script (Cyrillic, Greek, CJK, ...). Stripping
    // to a-z collapsed non-Latin names to '' so they collided on one id.
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function captureNameDistance(left: string, right: string): number {
  if (left === right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]; previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

const closeCaptureName = (left: string, right: string) => {
  if (Math.min(left.length, right.length) < 4) return false;
  if (left.includes(right) || right.includes(left)) return true;
  return captureNameDistance(left, right) <= (Math.max(left.length, right.length) >= 8 ? 2 : 1);
};

export function cleanCaptureDisplayName(value: unknown): string {
  const raw = String(value || '').trim();
  const cleaned = raw.replace(/\s+[0-9]{1,2}$/g, '').trim();
  return cleaned.length >= 3 ? cleaned : raw;
}

export function cleanCaptureMap(value: unknown): string {
  const cleaned = String(value || '').trim().replace(/^map\s*[-:]\s*/i, '').trim();
  return cleaned.replace(/\b[a-z]+\b/gi, word => word[0].toUpperCase() + word.slice(1).toLocaleLowerCase());
}

export function scoreFromCompleteRounds(rounds: ReadonlyArray<{ result?: unknown }>) {
  if (!rounds.length || rounds.some(round => round.result !== 'W' && round.result !== 'L')) return null;
  return {
    ourScore: rounds.filter(round => round.result === 'W').length,
    theirScore: rounds.filter(round => round.result === 'L').length,
  };
}

/**
 * The round detail table is grouped by team even when the final scoreboard is
 * individually sorted. Use repeated round observations to identify our five
 * scoreboard rows without requiring a configured roster.
 */
export function inferAlliedScoreboardNames(
  scoreboardPlayers: ReadonlyArray<{ extractedName?: string }>,
  rounds: ReadonlyArray<{ screenshotEvidence?: RoundScreenshotEvidence }>,
): Set<string> {
  const observed = new Map<string, number>();
  for (const round of rounds) {
    for (const player of round.screenshotEvidence?.players || []) {
      if (player.team !== 'ours') continue;
      const key = normalizeCaptureName(player.displayName);
      if (key) observed.set(key, (observed.get(key) || 0) + 1);
    }
  }
  const inferred = new Set<string>();
  for (const player of scoreboardPlayers) {
    const key = normalizeCaptureName(player.extractedName);
    if (!key) continue;
    if (observed.has(key)) { inferred.add(key); continue; }
    // OCR occasionally appends one glyph to a name. Only accept a unique
    // containment match seen in at least two round screens.
    const candidates = [...observed].filter(([candidate, count]) => count >= 2
      && Math.min(candidate.length, key.length) >= 4
      && closeCaptureName(candidate, key));
    if (candidates.length === 1) inferred.add(key);
  }
  return inferred;
}

export function canonicalScoreboardName(
  roundName: string,
  scoreboardPlayers: ReadonlyArray<{ extractedName?: string }>,
): string {
  const key = normalizeCaptureName(roundName);
  const exact = scoreboardPlayers.find(player => normalizeCaptureName(player.extractedName) === key);
  if (exact?.extractedName) return cleanCaptureDisplayName(exact.extractedName);
  const candidates = scoreboardPlayers.filter(player => {
    const candidate = normalizeCaptureName(player.extractedName);
    return closeCaptureName(candidate, key);
  });
  return cleanCaptureDisplayName(candidates.length === 1 && candidates[0].extractedName ? candidates[0].extractedName : roundName);
}

export interface CapturedRoundLike {
  roundNo: number;
  result: string;
  winBy: string;
  extractionIssues: string[];
  screenshotEvidence?: (RoundScreenshotEvidence & { displayedRoundNo?: number | null }) | any;
}

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * File each round image under the round number printed on it.
 *
 * The capture helper clicks timeline tiles by position. When the timeline is
 * scrolled (overtime, more tiles than fit), every click lands on a different
 * round than the file name says. The "ROUND N" header is authoritative: images
 * are re-keyed to it, duplicates keep the most confident read, and rounds
 * that were never captured become explicit blanks for the coach to fill.
 */
export function reconcileCapturedRoundNumbers<R extends CapturedRoundLike>(
  rounds: readonly R[],
  expectedRoundCount?: number | null,
): { rounds: Array<R | CapturedRoundLike>; rekeyed: number; duplicates: number; missing: number[] } {
  const byNumber = new Map<number, R>();
  let rekeyed = 0; let duplicates = 0;
  const unreadable: R[] = [];
  for (const round of rounds) {
    const displayed = round.screenshotEvidence?.displayedRoundNo;
    const issues = round.extractionIssues.filter(issue => issue !== 'round-number-mismatch');
    if (!Number.isInteger(displayed) || displayed < 1) { unreadable.push({ ...round, extractionIssues: issues }); continue; }
    const roundNo = displayed as number;
    const moved = roundNo !== round.roundNo;
    if (moved) rekeyed += 1;
    const candidate = {
      ...round,
      roundNo,
      extractionIssues: moved ? [...new Set([...issues, 'round-rekeyed-from-header'])] : issues,
      screenshotEvidence: round.screenshotEvidence ? { ...round.screenshotEvidence, ...(moved ? { capturedAsRoundNo: round.roundNo } : {}) } : round.screenshotEvidence,
    } as R;
    const existing = byNumber.get(roundNo);
    if (existing) {
      duplicates += 1;
      const rank = (value: R) => CONFIDENCE_RANK[String(value.screenshotEvidence?.confidence)] || 0;
      if (rank(candidate) > rank(existing)) byNumber.set(roundNo, candidate);
      continue;
    }
    byNumber.set(roundNo, candidate);
  }
  // A header that could not be read keeps its click position only when that
  // slot is still free; it stays flagged for review either way.
  for (const round of unreadable) {
    if (!byNumber.has(round.roundNo)) byNumber.set(round.roundNo, { ...round, extractionIssues: [...new Set([...round.extractionIssues, 'round-number-unreadable'])] });
    else duplicates += 1;
  }
  const highest = Math.max(0, ...byNumber.keys(), Number.isInteger(expectedRoundCount) ? Number(expectedRoundCount) : 0);
  const missing: number[] = [];
  const output: Array<R | CapturedRoundLike> = [];
  for (let roundNo = 1; roundNo <= highest; roundNo += 1) {
    const round = byNumber.get(roundNo);
    if (round) { output.push(round); continue; }
    missing.push(roundNo);
    output.push({ roundNo, result: '', winBy: '', extractionIssues: ['round-not-captured'] });
  }
  return { rounds: output, rekeyed, duplicates, missing };
}
