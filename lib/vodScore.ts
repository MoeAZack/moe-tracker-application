import type { Match, VodTimelineEvidence } from '../src/types';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';

type DerivedScore = { left: number; right: number; basis: 'final-read' | 'last-round'; reads: number };
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

/**
 * Which HUD side is ours in one VOD, from its games whose score came from a
 * scoreboard and whose HUD reads give the same final score one way round or
 * the other. Null unless at least one game shows it and none disagree.
 */
export function vodHudOrientation(matches: Match[]): { orientation: 'left-is-ours' | 'right-is-ours'; fromMatchId: string } | null {
  let found: { orientation: 'left-is-ours' | 'right-is-ours'; fromMatchId: string } | null = null;
  for (const match of matches) {
    if (match.scoreEvidence || typeof match.ourScore !== 'number' || typeof match.theirScore !== 'number' || match.ourScore === match.theirScore) continue;
    const read = deriveFinalScore((match as any).vodTimelineEvidence);
    if (!read) continue;
    const orientation = read.left === match.ourScore && read.right === match.theirScore ? 'left-is-ours' : read.left === match.theirScore && read.right === match.ourScore ? 'right-is-ours' : null;
    if (!orientation || (found && found.orientation !== orientation)) return null;
    found ||= { orientation, fromMatchId: match.id };
  }
  return found;
}

/**
 * Applies a VOD's learned HUD orientation to its games whose score was read
 * from the HUD and not confirmed or oriented yet. Returns the games changed.
 */
export function orientVodHudScores(db: any, vod: string, matchIds: readonly string[], fromMatchIds: readonly string[]) {
  const sameVod = (ids: readonly string[]) => ids.map(id => (db.matches || []).find((match: Match) => match.id === id)).filter((match: Match | undefined): match is Match => !!match && match.vod === vod);
  const learned = vodHudOrientation(sameVod(fromMatchIds));
  if (!learned) return { orientation: null, changed: [] as Array<{ id: string; ourScore: number; theirScore: number }> };
  const changed: Array<{ id: string; ourScore: number; theirScore: number }> = [];
  for (const match of sameVod(matchIds)) {
    const evidence = match.scoreEvidence;
    if (evidence?.source !== 'vod-hud' || evidence.orientationFrom || typeof match.ourScore !== 'number' || typeof match.theirScore !== 'number') continue;
    if (learned.orientation !== evidence.orientation) [match.ourScore, match.theirScore] = [match.theirScore, match.ourScore];
    match.scoreEvidence = { ...evidence, orientation: learned.orientation, orientationFrom: learned.fromMatchId };
    changed.push({ id: match.id, ourScore: match.ourScore, theirScore: match.theirScore });
  }
  return { orientation: learned.orientation, changed };
}
