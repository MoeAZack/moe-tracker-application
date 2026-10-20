import type { TrackerData } from '../src/types';

/** One read-only projection used by every dense coach-analysis surface. It
 * filters only match-derived collections and retains roster/settings context. */
export function projectReviewContext(data: TrackerData, matchId?: string | null, roundNo?: number | null): TrackerData {
  if (!matchId) return data;
  const matchIds = new Set([matchId]);
  const selectedRoundIds = new Set((data.rounds || []).filter(item => item.matchId === matchId && (!roundNo || item.roundNo === roundNo)).map(item => item.id));
  const selectedPlayerStatIds = new Set((data.playerStats || []).filter(item => item.matchId === matchId).map(item => item.id));
  const signalIds = new Set((data.coachingSignals || []).filter(item => item.matchIds.some(id => matchIds.has(id))).map(item => item.id));
  return {
    ...data,
    matches: (data.matches || []).filter(item => matchIds.has(item.id)),
    playerStats: (data.playerStats || []).filter(item => matchIds.has(item.matchId)),
    rounds: (data.rounds || []).filter(item => matchIds.has(item.matchId) && (!roundNo || item.roundNo === roundNo)),
    vetos: (data.vetos || []).filter((item: any) => !item.matchId || matchIds.has(item.matchId)),
    goals: (data.goals || []).filter(item => !item.matchId || matchIds.has(item.matchId)),
    vodReviews: (data.vodReviews || []).filter(item => item.matchId === matchId),
    vodSubmissions: (data.vodSubmissions || []).filter(item => item.linkedMatchId === matchId),
    coachingSignals: (data.coachingSignals || []).filter(item => item.matchIds.some(id => matchIds.has(id))),
    coachingActions: (data.coachingActions || []).filter(item => signalIds.has(item.sourceSignalId) || item.evidence.matchIds.some(id => matchIds.has(id))),
    analyticsBuilds: data.analyticsBuilds?.[matchId] ? { [matchId]: data.analyticsBuilds[matchId] } : {},
    evidenceFusionResolutions: (data.evidenceFusionResolutions || []).filter(item => item.matchId === matchId && (!roundNo || selectedRoundIds.has(item.roundId) || selectedPlayerStatIds.has(item.roundId))),
    calibratedPlayerRatings: (data.calibratedPlayerRatings || []).filter(item => selectedPlayerStatIds.size === 0 || [...selectedPlayerStatIds].some(statId => (data.playerStats || []).find(stat => stat.id === statId)?.playerId === item.playerId)),
  };
}

export function reviewContextSummary(data: TrackerData, matchId?: string | null, roundNo?: number | null) {
  const projected = projectReviewContext(data, matchId, roundNo);
  return { matches: projected.matches.length, rounds: projected.rounds.length, playerRows: projected.playerStats.length, reviews: projected.vodReviews?.length || 0, signals: projected.coachingSignals?.length || 0 };
}
