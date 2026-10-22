// Synced multi-POV review: several videos of one match (one per player, or
// coach and player views) played on one match clock.
//
// Each video has an offset: the second in that video where the match clock is
// zero, so `videoTime = matchTime + offset`. Round anchors (VOD notes with a
// round number) beat the offset for round jumps, because streams drift
// (pauses, technical timeouts) and a per-video anchor is what the coach
// actually confirmed.

export const MAX_POVS = 5;
/** How far a following video may wander from the main one before it is moved back. */
export const DRIFT_TOLERANCE_SECONDS = 0.75;

export type PovKind = 'youtube' | 'local' | 'link';
export type Pov = {
  id: string;
  title: string;
  kind: PovKind;
  /** YouTube video id, for embedding. */
  videoId: string | null;
  /** Saved review this view came from; local files picked for this session have none. */
  reviewId: string | null;
  vodUrl: string;
  offset: number;
  anchors: Record<number, number>;
};

type ReviewLike = { id: string; title?: string; vodUrl?: string; matchId?: string; createdAt?: string; syncOffsetSeconds?: number; notes?: Array<{ roundNo?: number; seconds?: number }> };

export function youtubeVideoId(input: string): string | null {
  try {
    const url = new URL(String(input || '').trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const valid = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null);
    if (host === 'youtu.be') return valid(url.pathname.slice(1));
    if (!['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
    if (url.pathname === '/watch') return valid(url.searchParams.get('v'));
    return valid(url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,20})/)?.[1]);
  } catch {
    return null;
  }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The first anchor note per round, in video seconds. */
export function roundAnchors(notes: ReviewLike['notes']): Record<number, number> {
  const anchors: Record<number, number> = {};
  for (const note of notes || []) if (note.roundNo && finite(note.seconds) && anchors[note.roundNo] === undefined) anchors[note.roundNo] = note.seconds;
  return anchors;
}

/** A saved sync offset wins; otherwise round 1's anchor marks the match start; otherwise the video starts with the match. */
export function defaultOffset(review: ReviewLike): number {
  if (finite(review.syncOffsetSeconds)) return review.syncOffsetSeconds;
  return roundAnchors(review.notes)[1] ?? 0;
}

export function povFromReview(review: ReviewLike): Pov {
  const vodUrl = String(review.vodUrl || '');
  const videoId = youtubeVideoId(vodUrl);
  return { id: `review:${review.id}`, title: review.title || 'Untitled VOD', kind: videoId ? 'youtube' : 'link', videoId, reviewId: review.id, vodUrl, offset: defaultOffset(review), anchors: roundAnchors(review.notes) };
}

/** Every saved video of one match, oldest first. */
export function matchPovs(reviews: ReviewLike[], matchId: string | null | undefined): Pov[] {
  if (!matchId) return [];
  return reviews
    .filter(review => review.matchId === matchId && review.vodUrl)
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
    .map(povFromReview);
}

export const videoTimeFor = (pov: Pick<Pov, 'offset'>, matchSeconds: number) => Math.max(0, matchSeconds + pov.offset);
export const matchTimeFor = (pov: Pick<Pov, 'offset'>, videoSeconds: number) => videoSeconds - pov.offset;
/** The offset that makes this video's current frame line up with the main video's current match time. */
export const offsetToAlign = (videoSeconds: number, matchSeconds: number) => Math.round((videoSeconds - matchSeconds) * 10) / 10;

/** Match-clock time a round starts, from the first view (in order) that has that round anchored. */
export function roundMatchTime(povs: Pov[], roundNo: number): number | null {
  for (const pov of povs) if (finite(pov.anchors[roundNo])) return matchTimeFor(pov, pov.anchors[roundNo]);
  return null;
}

/** Where each view should go for a round: its own anchor when it has one, else the shared match clock. Null when no view knows the round. */
export function roundSeekTargets(povs: Pov[], roundNo: number): Record<string, number> | null {
  const matchTime = roundMatchTime(povs, roundNo);
  if (matchTime === null) return null;
  return Object.fromEntries(povs.map(pov => [pov.id, finite(pov.anchors[roundNo]) ? pov.anchors[roundNo] : videoTimeFor(pov, matchTime)]));
}

/**
 * Following views that drifted from the main view, and where to move them.
 * Views whose position is unknown (still loading) are left alone.
 */
export function driftCorrections(povs: Pov[], positions: Record<string, number | null>, mainId: string, tolerance = DRIFT_TOLERANCE_SECONDS): Array<{ id: string; seekTo: number }> {
  const main = povs.find(pov => pov.id === mainId);
  const mainPosition = positions[mainId];
  if (!main || !finite(mainPosition)) return [];
  const matchTime = matchTimeFor(main, mainPosition);
  return povs.flatMap(pov => {
    if (pov.id === mainId) return [];
    const position = positions[pov.id];
    const expected = videoTimeFor(pov, matchTime);
    return finite(position) && Math.abs(position - expected) > tolerance ? [{ id: pov.id, seekTo: expected }] : [];
  });
}

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

export const formatOffset = (offset: number) => `${offset < 0 ? '−' : '+'}${formatClock(Math.abs(offset))}`;

/**
 * A round jump for the views on screen. Each view goes to its own anchor when
 * it has one, and the offsets are re-based on the main view at that round so
 * drift correction keeps them there instead of pulling them back to the old
 * offset (streams drift over a long session).
 */
export function alignForRound(povs: Pov[], roundNo: number, mainId: string): { targets: Record<string, number>; offsets: Record<string, number> } | null {
  const targets = roundSeekTargets(povs, roundNo);
  const main = povs.find(pov => pov.id === mainId);
  if (!targets || !main) return null;
  const mainMatchTime = matchTimeFor(main, targets[main.id]);
  const offsets = Object.fromEntries(povs.map(pov => [pov.id, pov.id === main.id ? pov.offset : offsetToAlign(targets[pov.id], mainMatchTime)]));
  return { targets, offsets };
}
