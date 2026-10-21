import { describe, expect, it } from 'vitest';
import { knownTotal, playerRowKastEvidence, publishKast, publishRate, publishRowKast, screenshotKastEvidence } from '../lib/metricTrust';
import { aggregateObservedPlayerDashboard } from '../lib/uiIntegration';
import { buildPracticeBlockSummary, generateReviewSignalDrafts, reconcileReviewSignals, signalIdentity, transitionSignal } from '../lib/coachingWorkflow';
import { buildCalibratedPlayerRatings, CALIBRATED_RATING_VERSION, currentCalibratedRatings, ratingThresholdPassed } from '../lib/calibratedPlayerRatings';

import { buildPlayerDevelopment } from '../lib/playerDevelopment';
import { buildAgentPerformance, buildMapCompositions } from '../src/components/TeamCompositions';
import { personalTotals } from '../src/components/Dashboard';
import { agentProficiency, buildPeriodMetrics, kpiRecommendation } from '../lib/tacticalHubMetrics';
import { buildTryoutComparison } from '../lib/tryoutComparison';
import { refreshCoachingWorkflow } from '../lib/routes/coaching';

// Synthetic rows only.
const match = (id: string, extra: Record<string, unknown> = {}) => ({ id, date: '2026-10-10', map: 'Ascent', ourScore: 13, theirScore: 9, ...extra });

describe('one publication gate per metric', () => {
  it('never turns a missing row into zero', () => {
    expect(knownTotal([{ fd: 2 }, { fd: undefined }], row => row.fd)).toBeNull();
    expect(knownTotal([{ fd: 2 }, { fd: 0 }], row => row.fd)).toBe(2);
    expect(knownTotal([], (row: { fd?: number }) => row.fd)).toBeNull();
  });

  it('carries numerator, denominator, coverage and the withheld reason', () => {
    expect(publishRate({ numerator: 9, denominator: 15, observed: 3, expected: 3, minimumSamples: 15 })).toMatchObject({ value: 60, numerator: 9, denominator: 15, coverage: { observed: 3, expected: 3, complete: true }, publishable: true, withheldReason: null });
    expect(publishRate({ numerator: 9, denominator: 15, observed: 2, expected: 3, minimumSamples: 15 })).toMatchObject({ value: null, publishable: false, withheldReason: 'incomplete-coverage' });
    expect(publishRate({ numerator: 4, denominator: 10, observed: 2, expected: 2, minimumSamples: 15 })).toMatchObject({ value: null, numerator: 4, denominator: 10, withheldReason: 'insufficient-samples' });
    expect(publishRate({ numerator: null, denominator: null, observed: 0, expected: 0 })).toMatchObject({ value: null, withheldReason: 'no-evidence', confidence: 'unavailable' });
  });
});

describe('KAST has one implementation and fails closed', () => {
  it('rejects screenshot KAST that covers only part of the confirmed rounds', () => {
    expect(screenshotKastEvidence({ coveredRounds: 20, kast: { successful: 15, covered: 18 } })).toBeNull();
    expect(screenshotKastEvidence({ coveredRounds: 20, kast: { successful: 15, covered: 20 } })).toEqual({ successful: 15, covered: 20 });
    expect(playerRowKastEvidence({ kastSuccessful: 15, kastCovered: 20, screenshotMetrics: { coveredRounds: 20, kast: { successful: 15, covered: 18 } } })).toBeNull();
  });

  it('does not let a covered subset stand in for failed rounds or matches', () => {
    expect(publishKast([{ successful: 18, covered: 24 }, null])).toMatchObject({ value: null, withheldReason: 'incomplete-coverage', coverage: { observed: 1, expected: 2 } });
    expect(publishRowKast([{ kastSuccessful: 18, kastCovered: 24 }, { kastSuccessful: 15, kastCovered: 20 }])).toMatchObject({ value: 75, numerator: 33, denominator: 44 });
  });

  it('withholds dashboard KAST when one match has no complete KAST', () => {
    const rows = (second: Record<string, unknown>) => aggregateObservedPlayerDashboard({
      rosterPlayers: [], coreMemberships: [], tryoutBatches: [], rounds: [], settings: { stats: { lowSample: 15 } },
      matches: [match('m1'), match('m2')],
      playerStats: [{ id: 'a', matchId: 'm1', player: 'Alpha', kills: 20, deaths: 10, assists: 5, kastSuccessful: 18, kastCovered: 24 }, { id: 'b', matchId: 'm2', player: 'Alpha', kills: 20, deaths: 10, assists: 5, ...second }],
    } as any)[0];
    expect(rows({}).kast).toBeNull();
    expect(rows({}).kastPublication.withheldReason).toBe('incomplete-coverage');
    expect(rows({ screenshotMetrics: { schemaVersion: 1, coveredRounds: 20, wins: 10, losses: 10, firstKills: 0, firstDeaths: 0, multikills: { two: 0, three: 0, four: 0, ace: 0 }, lowBudgetWins: 0, highBudgetLosses: 0, antiEcoLosses: 0, kast: { successful: 15, covered: 18 }, weapons: [] } }).kast).toBeNull();
    expect(rows({ kastSuccessful: 15, kastCovered: 20 }).kast).toBeCloseTo(33 / 44);
  });

  it('treats a drawn score as undecided in the dashboard record', () => {
    const [row] = aggregateObservedPlayerDashboard({ rosterPlayers: [], coreMemberships: [], tryoutBatches: [], rounds: [], matches: [match('m1', { ourScore: 12, theirScore: 12 })], playerStats: [{ id: 'a', matchId: 'm1', player: 'Alpha' }] } as any);
    expect(row).toMatchObject({ wins: 0, losses: 0 });
  });
});

describe('experimental player score cohort', () => {
  const cohort = (players: number, matches = 10) => ({
    matches: Array.from({ length: matches }, (_, index) => ({ id: `m${index}`, map: 'Ascent' })),
    playerStats: Array.from({ length: players }, (_, player) => Array.from({ length: matches }, (_, match) => ({
      id: `p${player}-m${match}`, matchId: `m${match}`, playerId: `p${player}`, player: `Player ${player}`,
      kills: 12 + player, deaths: 10 + (player % 3), assists: 4 + (player % 2), fk: 2 + (player % 2), fd: 1, kastCovered: 20, kastSuccessful: 12 + (player % 5),
    }))).flat(),
  });

  it('rates a complete ten-player, ten-match cohort', () => {
    const ratings = buildCalibratedPlayerRatings({ rosterPlayers: [], ...cohort(10) } as any);
    expect(ratings.every(rating => typeof rating.rating === 'number')).toBe(true);
    expect(ratings[0].calibration.cohortSize).toBe(10);
  });

  it('does not let a tryout complete the ten-player cohort', () => {
    const data = cohort(10) as any;
    for (const row of data.playerStats.filter((row: any) => row.playerId === 'p9')) row.appearanceType = 'tryout';
    const ratings = buildCalibratedPlayerRatings({ rosterPlayers: [], ...data });
    expect(ratings.every(rating => rating.rating === null)).toBe(true);
    expect(ratings.find(rating => rating.playerId === 'p9')!.unknownReasons).toContain('tryout-not-in-rating-cohort');
    expect(ratings.find(rating => rating.playerId === 'p0')!.calibration.cohortSize).toBe(9);
    const byStatus = buildCalibratedPlayerRatings({ rosterPlayers: [{ id: 'p9', displayName: 'Player 9', createdAt: '2026-10-01', rosterStatus: 'tryout' }], ...cohort(10) } as any);
    expect(byStatus.every(rating => rating.rating === null)).toBe(true);
    const byBatch = buildCalibratedPlayerRatings({ rosterPlayers: [], tryoutBatches: [{ id: 'b', name: 'B', status: 'active', candidatePlayerIds: ['p9'], createdAt: '2026-10-01' }], ...cohort(10) } as any);
    expect(byBatch.every(rating => rating.rating === null)).toBe(true);
  });

  it('does not count a player with fewer than ten matches toward the cohort', () => {
    const data = cohort(10) as any;
    data.playerStats = data.playerStats.filter((row: any) => !(row.playerId === 'p9' && row.matchId === 'm9'));
    const ratings = buildCalibratedPlayerRatings({ rosterPlayers: [], ...data });
    expect(ratings.every(rating => rating.rating === null)).toBe(true);
    expect(ratings[0].calibration.cohortSize).toBe(9);
  });

  it('recomputes stale stored ratings instead of showing them as threshold passed', () => {
    const stale = [{ playerId: 'p1', player: 'One', rating: 61, publicationStatus: 'experimental-only', unknownReasons: [], calculationVersion: 'calibrated-player-rating/v3' }] as any;
    const current = currentCalibratedRatings(stale, () => buildCalibratedPlayerRatings({ rosterPlayers: [], ...cohort(2, 2) } as any));
    expect(current.every(rating => rating.calculationVersion === CALIBRATED_RATING_VERSION && rating.rating === null)).toBe(true);
    expect(ratingThresholdPassed(stale[0])).toBe(false);
    expect(current.some(ratingThresholdPassed)).toBe(false);
  });
});

describe('coaching signals survive refresh', () => {
  const data = (fullBuyLosses: number) => ({
    settings: { inactiveMaps: [] }, rosterPlayers: [], practiceBlocks: [], playerStats: [],
    matches: [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'Synthetic', map: 'Ascent', attW: 5, attL: 7, defW: 8, defL: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }],
    rounds: Array.from({ length: 4 }, (_, index) => ({ id: `r${index}`, matchId: 'm1', roundNo: index + 2, side: 'Att', buy: 'Full', enemyBuy: 'Full', result: index < fullBuyLosses ? 'L' : 'W' })),
  }) as any;
  const drafts = (losses: number) => generateReviewSignalDrafts(buildPracticeBlockSummary(data(losses), { id: 'b1', name: 'Prac', matchIds: ['m1'] }, '2026-10-18T15:00:00Z'), { minimumSamples: 1 }).filter(draft => draft.type === 'full-buy-loss');

  it('keeps the same signal and its review state when its metric moves', () => {
    const [first] = reconcileReviewSignals([], drafts(2));
    const accepted = transitionSignal(first, 'accepted', 'coach', 'Seen in VOD');
    const refreshed = reconcileReviewSignals([accepted], drafts(3));
    expect(refreshed.filter(item => item.type === 'full-buy-loss')).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({ id: accepted.id, status: 'accepted', metric: { value: 75 } });
    expect(refreshed[0].audit.at(-1)).toMatchObject({ by: 'coach', to: 'accepted' });
  });

  it('keeps a triaged signal that is no longer generated and drops only untriaged ones', () => {
    const [first] = reconcileReviewSignals([], drafts(2));
    expect(reconcileReviewSignals([transitionSignal(first, 'dismissed', 'coach', 'Not relevant')], drafts(0))).toMatchObject([{ id: first.id, status: 'dismissed' }]);
    expect(reconcileReviewSignals([first], drafts(0))).toEqual([]);
  });
});

describe('unknown never becomes zero in coach surfaces', () => {
  it('does not call openings positive when first deaths are missing', () => {
    const data: any = { settings: {}, rosterPlayers: [], matches: [match('m1'), match('m2')], rounds: [], coachingActions: [], playerStats: [{ id: 'a', matchId: 'm1', player: 'Alpha', fk: 3 }, { id: 'b', matchId: 'm2', player: 'Alpha', fk: 2, fd: 1 }] };
    expect(buildPlayerDevelopment(data).find(row => row.player === 'Alpha')?.strengths ?? []).not.toContainEqual(expect.stringContaining('Positive openings'));
    data.playerStats[0].fd = 1;
    expect(buildPlayerDevelopment(data).find(row => row.player === 'Alpha')?.strengths).toContain('Positive openings 5–2');
  });

  it('keeps Dashboard totals and opening rate unknown when one row is incomplete', () => {
    expect(personalTotals([{ kills: 20, deaths: 10, assists: 5, fk: 3, fd: 2 }, { kills: 18, deaths: 12, assists: 4, fk: 4 }], 1)).toMatchObject({ kills: 38, deaths: 22, firstKills: 7, firstDeaths: null, openingRate: null });
    expect(personalTotals([{ kills: 20, deaths: 10, assists: 5, fk: 3, fd: 1 }], 1)).toMatchObject({ openingRate: 75 });
    expect(personalTotals([{ kills: 20, deaths: 10, assists: 5, fk: 3, fd: 1 }], 15).openingRate).toBeNull();
  });

  const compositionData = (rows: number, outcomes: Array<[number, number]>) => ({
    settings: { theme: 'midnight', maps: ['Ascent'], agents: ['Jett', 'Sova', 'Omen', 'Killjoy', 'Fade'] }, resources: [],
    matches: outcomes.map(([ours, theirs], index) => match(`m${index}`, { ourScore: ours, theirScore: theirs })),
    playerStats: outcomes.flatMap((_, index) => ['Jett', 'Sova', 'Omen', 'Killjoy', 'Fade'].slice(0, rows).map((agent, slot) => ({ id: `m${index}-${slot}`, matchId: `m${index}`, player: `P${slot}`, agent }))),
  }) as any;
  const agentKeys = new Set(['jett', 'sova', 'omen', 'killjoy', 'fade']);

  it('reports an undecided or undersampled agent win rate as unknown, not 0%', () => {
    const undecided = buildAgentPerformance(compositionData(5, [[12, 12]]), ['Jett'], 1)[0];
    expect(undecided).toMatchObject({ played: 1, winRate: null });
    expect(buildAgentPerformance(compositionData(5, [[13, 9], [9, 13]]), ['Jett'], 15)[0].winRate).toBeNull();
    expect(buildAgentPerformance(compositionData(5, [[13, 9], [9, 13]]), ['Jett'], 2)[0]).toMatchObject({ winRate: 50, pickRate: 20 });
  });

  it('counts only full five-agent lineups as compositions', () => {
    expect(Object.keys(buildMapCompositions(compositionData(4, [[13, 9]]), ['Ascent'], agentKeys, 1).Ascent)).toHaveLength(0);
    const full = Object.values(buildMapCompositions(compositionData(5, [[13, 9], [13, 5]]), ['Ascent'], agentKeys, 2).Ascent);
    expect(full).toMatchObject([{ wins: 2, losses: 0, winRate: 100 }]);
    expect(Object.values(buildMapCompositions(compositionData(5, [[13, 9]]), ['Ascent'], agentKeys, 15).Ascent)[0].winRate).toBeNull();
  });

  it('gives AI hub totals and coaching focus only from complete, gated evidence', () => {
    const rows: any[] = [{ id: 'a', matchId: 'm1', playerId: 'p1', kills: 20, deaths: 10, cl: 1, clAtt: 3 }, { id: 'b', matchId: 'm2', playerId: 'p1', kills: 15 }];
    const metrics = buildPeriodMetrics(rows, [], new Set(['m1', 'm2']), ['player:p1'], row => `player:${row.playerId}`, name => name)['player:p1'];
    expect(metrics).toMatchObject({ rows: 2, kills: 35, deaths: null, clutchesWon: null, clutchesAttempted: null });
    const empty = buildPeriodMetrics([], [], new Set(), ['player:p1'], row => `player:${row.playerId}`, name => name)['player:p1'];
    const focus = kpiRecommendation('Alpha', metrics, empty, 15);
    expect(focus.severity).toBe('unavailable');
    expect(focus.text).not.toMatch(/0%/);
  });

  it('gives an unplayed agent no proficiency grade instead of a neutral B', () => {
    expect(agentProficiency([], new Map(), 1)).toEqual({ grade: null, rating: null, count: 0, winRate: null });
    expect(agentProficiency([{ id: 'a', matchId: 'm1', kills: 5 } as any], new Map([['m1', match('m1') as any]]), 1)).toMatchObject({ grade: null, rating: null, winRate: 100 });
  });

  it('withholds tryout KAST when one compared match has none', () => {
    const source = { method: 'manual' as const, capturedAt: '2026-10-15T10:00:00Z' };
    const row = (id: string, matchId: string, extra: any = {}) => ({ id, matchId, playerId: 'p1', displayNameSnapshot: 'Trial', player: 'Trial', appearanceType: 'tryout', agent: 'Sova', kills: 10, deaths: 5, assists: 2, sourceMetadata: source, ...extra });
    const data: any = { matches: [{ ...match('m1'), sourceMetadata: source }, { ...match('m2'), sourceMetadata: source }], rounds: [], practiceBlocks: [], rosterPlayers: [{ id: 'p1', displayName: 'Trial', createdAt: '' }], playerStats: [row('a', 'm1', { kastSuccessful: 18, kastCovered: 20 }), row('b', 'm2')] };
    const kast = (input: any) => buildTryoutComparison(input, { mode: 'player-player', leftId: 'p1', rightId: 'p1', minimumSamples: 1 }).metrics.find((item: any) => item.id === 'kast');
    expect(kast(data)?.left).toBeNull();
    data.playerStats[1].kastSuccessful = 10; data.playerStats[1].kastCovered = 20;
    expect(kast(data)?.left).toBeCloseTo(0.7);
  });

  it('keeps a deleted signal deleted after its metric moves', () => {
    const db: any = { settings: { inactiveMaps: [], stats: { lowSample: 1 } }, rosterPlayers: [], practiceBlocks: [], playerStats: [], coachingActions: [],
      matches: [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'Synthetic', map: 'Ascent', attW: 5, attL: 7, defW: 8, defL: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }],
      rounds: Array.from({ length: 4 }, (_, index) => ({ id: `r${index}`, matchId: 'm1', roundNo: index + 2, side: 'Att', buy: 'Full', enemyBuy: 'Full', result: index < 2 ? 'L' : 'W' })) };
    refreshCoachingWorkflow(db, 'coach', '2026-10-18T15:00:00Z');
    const signal = db.coachingSignals.find((item: any) => item.type === 'full-buy-loss');
    db.settings.deletedCoachingSignalFingerprints = [signal.fingerprint, signalIdentity(signal)]; db.coachingSignals = [];
    db.rounds[2].result = 'L';
    refreshCoachingWorkflow(db, 'coach', '2026-10-18T16:00:00Z');
    expect(db.coachingSignals.some((item: any) => item.type === 'full-buy-loss')).toBe(false);
  });
});
