import type { Match, VodTimelineEvidence } from '../src/types';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';

type DerivedScore = { left: number; right: number; basis: 'final-read' | 'last-round' | 'end-banner'; reads: number };
const { deriveFinalScore } = evidenceModule as { deriveFinalScore: (evidence: VodTimelineEvidence | null | undefined) => DerivedScore | null };

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
  match.ourScore = derived.left; match.theirScore = derived.right;
  match.scoreEvidence = { source: 'vod-hud', basis: derived.basis, reads: derived.reads, orientation: 'left-is-ours', derivedAt: now };
  return derived;
}
