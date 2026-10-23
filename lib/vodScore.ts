import type { Match, VodTimelineEvidence } from '../src/types';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';

type DerivedScore = { left: number; right: number; basis: 'final-read' | 'last-round' | 'end-banner'; reads: number };
const { deriveFinalScore, deriveLastHudScore } = evidenceModule as { deriveFinalScore: (evidence: VodTimelineEvidence | null | undefined) => DerivedScore | null; deriveLastHudScore: (evidence: VodTimelineEvidence | null | undefined) => { left: number; right: number; basis: 'last-hud'; reads: number } | null };

const AUTOMATIC_CORRECTION_MARKERS = new Set(['replay-evidence-overlay']);
export function manuallyCorrectedScoreFields(match: any) {
  return new Set<string>((match?.corrections || []).flatMap((item: any) => Array.isArray(item?.fields) ? item.fields : [])
    .filter((field: any) => typeof field === 'string' && !AUTOMATIC_CORRECTION_MARKERS.has(field)));
}

/** Verified board/replay facts replace automatic VOD score evidence, never explicit coach corrections. */
export function applyVerifiedMatchScore(match: any, ourScore: number | null, theirScore: number | null, source: 'scoreboard' | 'replay') {
  // Score authority is pair-level: one missing side cannot prove a result and
  // must not clear uncertainty or block a later complete source.
  if (!Number.isSafeInteger(ourScore) || !Number.isSafeInteger(theirScore)) return match;
  const corrected = manuallyCorrectedScoreFields(match);
  if (source === 'scoreboard' && match.scoreVerification?.source === 'replay') return match;
  if (!corrected.has('ourScore') && Number.isSafeInteger(ourScore)) match.ourScore = ourScore;
  if (!corrected.has('theirScore') && Number.isSafeInteger(theirScore)) match.theirScore = theirScore;
  if (Number.isSafeInteger(match.ourScore) && Number.isSafeInteger(match.theirScore)) { delete match.scoreEvidence; delete match.partialScore; match.scoreVerification = { source }; }
  return match;
}

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
