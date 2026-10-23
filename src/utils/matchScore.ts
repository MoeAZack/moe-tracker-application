// A match's final score: the saved final score first, then the side split.
// A match with neither has no score yet, and no result is shown for it.
type ScoreFields = { ourScore?: number | null; theirScore?: number | null; attW?: number | null; attL?: number | null; defW?: number | null; defL?: number | null };
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function matchScore(match: ScoreFields): { ours: number; theirs: number } | null {
  if (isCount(match.ourScore) && isCount(match.theirScore)) return { ours: match.ourScore, theirs: match.theirScore };
  if ([match.attW, match.defW, match.attL, match.defL].every(isCount)) return { ours: match.attW! + match.defW!, theirs: match.attL! + match.defL! };
  return null;
}

export function matchResult(match: ScoreFields): 'WIN' | 'LOSS' | 'DRAW' | null {
  const score = matchScore(match);
  if (!score) return null;
  return score.ours > score.theirs ? 'WIN' : score.ours < score.theirs ? 'LOSS' : 'DRAW';
}

/** A side split cell such as "7W - 5L", or "–" when that side was not recorded. */
export const sideSplit = (won: number | null | undefined, lost: number | null | undefined) => isCount(won) && isCount(lost) ? `${won}W - ${lost}L` : '–';
