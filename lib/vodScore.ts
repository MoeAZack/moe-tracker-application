import type { Match, VodTimelineEvidence } from '../src/types';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';

type DerivedScore = { left: number; right: number; basis: 'final-read' | 'last-round' | 'end-banner'; reads: number };
const { deriveFinalScore, deriveLastHudScore } = evidenceModule as { deriveFinalScore: (evidence: VodTimelineEvidence | null | undefined) => DerivedScore | null; deriveLastHudScore: (evidence: VodTimelineEvidence | null | undefined) => { left: number; right: number; basis: 'last-hud'; reads: number } | null };

/**
 * Fills a VOD match's missing final score from the HUD score reads of its
 * timeline. A score that is already set, by a scoreboard or the coach, is
 * never replaced, and a match whose score was derived once is not derived
 * again (the coach may have cleared it on purpose).
 */
export function applyVodHudScore(match: Match, evidence: VodTimelineEvidence | null | undefined, now = new Date().toISOString()) {
  if (match.ourScore !== null && match.ourScore !== undefined) return null;
  if (match.theirScore !== null && match.theirScore !== undefined) return null;
  if (match.scoreEvidence) return null;
  const derived = deriveFinalScore(evidence);
  if (!derived) return null;
  match.ourScore = derived.left; match.theirScore = derived.right; delete match.partialScore;
  match.scoreEvidence = { source: 'vod-hud', basis: derived.basis, reads: derived.reads, orientation: 'left-is-ours', derivedAt: now };
  return derived;
}

/**
 * A VOD game with no final score keeps the last HUD score it showed as partial: the match stays
 * "Score pending" with no result, and the partial score is replaced whenever a final one arrives.
 */
export function applyVodPartialScore(match: Match, evidence: VodTimelineEvidence | null | undefined, now = new Date().toISOString()) {
  if (match.ourScore !== null && match.ourScore !== undefined) return null;
  if (match.theirScore !== null && match.theirScore !== undefined) return null;
  const read = deriveLastHudScore(evidence);
  if (!read) { delete match.partialScore; return null; }
  match.partialScore = { ours: read.left, theirs: read.right, source: 'vod-hud', basis: 'last-hud', reads: read.reads, orientation: 'left-is-ours', derivedAt: now };
  return read;
}
