import { describe, expect, it } from 'vitest';
import { projectReviewContext, reviewContextSummary } from '../lib/reviewContext';

const data: any = {
  settings: {}, rosterPlayers: [], coreMemberships: [], tryoutBatches: [], seasonArchives: [], secrets: {}, schedule: [], soloq: [], strats: [], stratRuns: [], serverTime: '',
  matches: [{ id: 'm1' }, { id: 'm2' }], playerStats: [{ id: 's1', matchId: 'm1' }, { id: 's2', matchId: 'm2' }],
  rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1 }, { id: 'r2', matchId: 'm1', roundNo: 2 }, { id: 'r3', matchId: 'm2', roundNo: 1 }],
  vetos: [], goals: [{ id: 'g1', matchId: 'm1' }, { id: 'general' }], vodReviews: [{ id: 'v1', matchId: 'm1' }, { id: 'v2', matchId: 'm2' }], vodSubmissions: [],
  coachingSignals: [{ id: 'c1', matchIds: ['m1'] }, { id: 'c2', matchIds: ['m2'] }], coachingActions: [{ id: 'a1', sourceSignalId: 'c1', evidence: { matchIds: ['m1'] } }], analyticsBuilds: { m1: { ok: true }, m2: { ok: true } }, evidenceFusionResolutions: [], calibratedPlayerRatings: [],
};

describe('canonical review context projection', () => {
  it('keeps the full workspace when no match is selected', () => expect(projectReviewContext(data)).toBe(data));
  it('filters every match-derived review collection without dropping shared context', () => {
    const result = projectReviewContext(data, 'm1', 2);
    expect(result.matches.map((item: any) => item.id)).toEqual(['m1']); expect(result.playerStats.map((item: any) => item.id)).toEqual(['s1']); expect(result.rounds.map((item: any) => item.id)).toEqual(['r2']);
    expect(result.vodReviews?.map((item: any) => item.id)).toEqual(['v1']); expect(result.coachingSignals?.map((item: any) => item.id)).toEqual(['c1']); expect(result.coachingActions?.map((item: any) => item.id)).toEqual(['a1']); expect(result.analyticsBuilds).toEqual({ m1: { ok: true } });
    expect(result.goals.map((item: any) => item.id)).toEqual(['g1', 'general']); expect(result.settings).toBe(data.settings);
    expect(reviewContextSummary(data, 'm1', 2)).toEqual({ matches: 1, rounds: 1, playerRows: 1, reviews: 1, signals: 1 });
  });
});
