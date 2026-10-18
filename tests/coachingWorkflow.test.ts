import { describe, expect, it } from 'vitest';
import { buildActionCheck, buildAllPracticeBlockSummaries, buildPracticeBlockSummary, createCoachingAction, evaluateAction, generateReviewSignalDrafts, normalizeDashboardView, reconcileReviewSignals, transitionSignal } from '../lib/coachingWorkflow';

const acceptedMatch = (id: string, date = '2026-10-18') => ({ id, date, type: 'Scrim', opponent: 'PYO', map: 'Ascent', attW: 5, attL: 7, defW: 8, defL: 4, sourceMetadata: { method: 'manual', capturedAt: `${date}T12:00:00Z` } });
const base = () => ({
  settings: { inactiveMaps: [] }, rosterPlayers: [], practiceBlocks: [], matches: [acceptedMatch('m1')],
  playerStats: [{ id: 'p1', matchId: 'm1', playerId: 'r1', player: 'caelia', displayNameSnapshot: 'caelia', agent: 'Cypher', appearanceType: 'core', kills: 22, deaths: 19, assists: 4, kAtt: 10, kDef: 12, dAtt: 10, dDef: 9, aAtt: 2, aDef: 2, acs: 240, adr: 154, hs: 31, fk: 5, fd: 2, kastSuccessful: 16, kastCovered: 20, plants: 0, defuses: 1, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }],
  rounds: [
    { id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', buy: 'Full', enemyBuy: 'Full', result: 'L', firstDeathBy: 'caelia' },
    { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Att', buy: 'Full', enemyBuy: 'Eco', result: 'L' },
    { id: 'r3', matchId: 'm1', roundNo: 3, side: 'Att', buy: 'Eco', enemyBuy: 'Full', result: 'W' },
    { id: 'r13', matchId: 'm1', roundNo: 13, side: 'Def', buy: 'Full', enemyBuy: 'Full', result: 'W' },
  ],
}) as any;

describe('S1 practice-block summaries', () => {
  it('keeps ATT and DEF openings separate and exposes economy, roster, map and evidence coverage', () => {
    const data = base(); const summary = buildPracticeBlockSummary(data, { id: 'b1', name: 'Evening prac', matchIds: ['m1'] }, '2026-10-18T15:00:00Z');
    expect(summary.coverage).toMatchObject({ matches: 1, acceptedMatches: 1, knownRounds: 4, evidenceHealth: 'complete' });
    expect(summary.openings.pistols.ATT).toMatchObject({ wins: 0, samples: 1, rate: 0 });
    expect(summary.openings.pistols.DEF).toMatchObject({ wins: 1, samples: 1, rate: 100 });
    expect(summary.economy).toMatchObject({ lowBuyWins: 1, fullBuyLosses: 2, antiEcoLosses: 1 });
    expect(summary.roster[0]).toMatchObject({ player: 'caelia', kd: 1.16, kast: 80, fk: 5, fd: 2 });
    expect(summary.mapResults[0]).toMatchObject({ map: 'Ascent', matches: 1, active: true });
  });

  it('groups unassigned matches once by Cairo date', () => {
    const summaries = buildAllPracticeBlockSummaries(base(), '2026-10-18T15:00:00Z');
    expect(summaries).toHaveLength(1); expect(summaries[0].matchIds).toEqual(['m1']);
  });
});

describe('S2 deterministic coaching inbox', () => {
  it('deduplicates regenerated signals while retaining coach review state and audit history', () => {
    const summary = buildPracticeBlockSummary(base(), { id: 'b1', name: 'Prac', matchIds: ['m1'] }, '2026-10-18T15:00:00Z');
    const drafts = generateReviewSignalDrafts(summary, { minimumSamples: 1 }); const first = reconcileReviewSignals([], drafts, 'system');
    const accepted = transitionSignal(first[0], 'accepted', 'coach', 'Confirmed in VOD'); const second = reconcileReviewSignals([accepted], drafts, 'system');
    expect(second.filter(item => item.fingerprint === accepted.fingerprint)).toHaveLength(1);
    expect(second.find(item => item.id === accepted.id)).toMatchObject({ status: 'accepted' });
    expect(second.find(item => item.id === accepted.id)?.audit.at(-1)).toMatchObject({ by: 'coach', to: 'accepted' });
  });
});

describe('S3 coaching actions', () => {
  it('preserves immutable evidence and evaluates a next-block threshold without mutating its signal', () => {
    const summary = buildPracticeBlockSummary(base(), { id: 'b1', name: 'Prac', matchIds: ['m1'] }, '2026-10-18T15:00:00Z'); const draft = generateReviewSignalDrafts(summary, { minimumSamples: 1 }).find(item => item.type === 'full-buy-loss')!;
    const source = transitionSignal(reconcileReviewSignals([], [draft])[0], 'accepted', 'coach');
    const action = createCoachingAction({ signal: source, kind: 'team-task', ownerIds: [], priority: 'high', visibility: 'team', dueBlockId: 'b2', check: { signalType: source.type, baseline: source.metric.value, target: source.metric.value - 1, direction: 'decrease', unit: source.metric.unit, minimumSamples: 1, sourceBlockId: 'b1', context: source.context } }, 'coach');
    const laterSignal = { ...source, id: 'later', blockId: 'b2', metric: { ...source.metric, value: source.metric.value - 2 } };
    const evaluated = evaluateAction(action, [summary, { ...summary, blockId: 'b2', practiceStartAt: '2026-10-19T12:00:00.000Z', practiceEndAt: '2026-10-19T13:00:00.000Z', economy: { ...summary.economy, fullBuyLosses: 0 } }], [source, laterSignal]);
    expect(evaluated.outcome?.status).toBe('satisfied'); expect(evaluated.evidence).toEqual(source.evidence); expect(source.status).toBe('accepted');
  });

  it('never treats refreshed old evidence or missing comparable evidence as improvement', () => {
    const summary = buildPracticeBlockSummary(base(), { id: 'b1', name: 'Prac', matchIds: ['m1'] }, '2026-10-20T15:00:00Z');
    const draft = generateReviewSignalDrafts(summary, { minimumSamples: 1 }).find(item => item.type === 'full-buy-loss')!;
    const source = transitionSignal(reconcileReviewSignals([], [draft])[0], 'accepted', 'coach');
    const action = createCoachingAction({ signal: source, kind: 'team-task', ownerIds: [], priority: 'high', visibility: 'team' }, 'coach', '2026-10-18T16:00:00Z');
    const refreshed = { ...summary, generatedAt: '2026-10-21T10:00:00Z' };
    expect(evaluateAction(action, [refreshed], [source]).outcome).toMatchObject({ status: 'inconclusive', later: null });
  });

  it('uses metric-specific direction, units and context for pistol improvement', () => {
    const summary = buildPracticeBlockSummary(base(), { id: 'b1', name: 'Prac', matchIds: ['m1'] });
    const pistol = generateReviewSignalDrafts(summary, { minimumSamples: 1 }).find(item => item.type === 'pistol-conversion' && item.context.side === 'ATT')!;
    const check = buildActionCheck({ ...pistol, id: 'pistol', status: 'accepted', audit: [] });
    expect(check).toMatchObject({ direction: 'increase', unit: '%', sourceBlockId: 'b1', context: { side: 'ATT' } });
    expect(check.target).toBeGreaterThan(check.baseline);
  });
});

describe('S5 bounded dashboard views', () => {
  it('restores mandatory review and evidence cards and rejects arbitrary card IDs', () => {
    const view = normalizeDashboardView({ preset: 'map-pool', cards: [{ id: 'made-up', size: 'full', minimized: false }] }, 'coach-1');
    expect(view.cards.some(card => card.id === 'made-up')).toBe(false);
    expect(view.cards.find(card => card.id === 'review-queue')?.minimized).toBe(false);
    expect(view.cards.find(card => card.id === 'evidence-health')?.minimized).toBe(false);
  });
});
