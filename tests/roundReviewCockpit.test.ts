import { describe, expect, it } from 'vitest';
import { buildRecurringReviewPatterns, buildRoundReviewCards } from '../lib/roundReviewCockpit';
import { buildAllPracticeBlockSummaries, generateRoundReviewSignalDrafts } from '../lib/coachingWorkflow';

function data() {
  const elimination = (timestampMs: number, killer: string, victim: string, killerTeam: 'ours' | 'theirs', victimTeam: 'ours' | 'theirs') => ({ kind: 'elimination', timestampMs, killer, victim, killerTeam, victimTeam, confidence: .95 });
  return {
    settings: {}, rosterPlayers: [], coreMemberships: [], tryoutBatches: [], seasonArchives: [], secrets: {}, schedule: [], goals: [], soloq: [], analyticsBuilds: {}, vetos: [], strats: [], stratRuns: [], serverTime: '',
    matches: [{ id: 'm1', date: '2026-10-19', type: 'Scrim', opponent: 'GA', map: 'Ascent' }],
    playerStats: [
      { id: 's1', matchId: 'm1', player: 'Alpha', displayNameSnapshot: 'Alpha', agent: 'Jett' },
      { id: 's2', matchId: 'm1', player: 'Bravo', displayNameSnapshot: 'Bravo', agent: 'Omen' },
    ],
    vodReviews: [{ id: 'v1', matchId: 'm1', title: 'GA VOD', vodUrl: 'https://youtube.com/watch?v=abcdefghijk', notes: [{ id: 'n1', seconds: 52, timeLabel: '0:52', text: 'Hold the crossfire', name: 'Coach', role: 'coach', createdAt: '', roundNo: 1, replies: [] }] }],
    rounds: [1, 2].map(roundNo => ({
      id: `r${roundNo}`, matchId: 'm1', roundNo, side: 'Defense', buy: 'Full', enemyBuy: 'Eco', result: 'L', plant: 'TRUE', site: 'A', firstDeathBy: 'Alpha',
      replayEvidence: { tradeOpportunities: 2, successfulTrades: 0, tacticalAssessment: 'unreviewed' },
      reviewCockpit: { updatedAt: '', classifications: [{ type: 'first-death-review', status: 'confirmed', player: 'Alpha', updatedAt: '', updatedBy: 'Coach' }] },
      advantageEvidence: { schemaVersion: 1, source: 'vod', status: 'complete', startingPlayers: { ours: 5, theirs: 5 }, highestDifferential: 2, roundOutcome: 'lost', states: [{ oursAlive: 5, theirsAlive: 3, label: '5v3', differential: 2, afterEvent: 2, outcome: 'lost' }], reason: null },
      vodEvidence: { sourceSubmissionIds: ['sub'], roundNumber: roundNo, updatedAt: '', observations: [
        elimination(roundNo * 60_000 + 5_000, 'Alpha', 'Enemy A', 'ours', 'theirs'),
        elimination(roundNo * 60_000 + 8_000, 'Bravo', 'Enemy B', 'ours', 'theirs'),
        elimination(roundNo * 60_000 + 14_000, 'Enemy C', 'Alpha', 'theirs', 'ours'),
        elimination(roundNo * 60_000 + 20_000, 'Enemy D', 'Bravo', 'theirs', 'ours'),
        { kind: 'plant', timestampMs: roundNo * 60_000 + 30_000, player: 'Bravo' },
        { kind: 'orb-capture', timestampMs: roundNo * 60_000 + 10_000, player: 'Alpha' },
      ] },
    })),
  } as any;
}

describe('round review cockpit', () => {
  it('joins canonical round facts, timestamped VOD moments and coach notes', () => {
    const cards = buildRoundReviewCards(data(), 'm1');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ economy: { ours: 'Full', theirs: 'Eco' }, trades: { opportunities: 2, successful: 0 }, objective: { plant: true, site: 'A' }, utility: { orbCaptures: 1 }, evidenceCoverage: 'complete' });
    expect(cards[0].intelligence).toMatchObject({ calculationVersion: 'contextual-round-intelligence/v1', advantage: { status: 'complete' }, utility: { status: 'complete' } });
    expect(cards[0].moments.map(moment => moment.kind)).toEqual(expect.arrayContaining(['opening-duel', 'advantage-gained', 'advantage-lost', 'failed-trade', 'plant', 'orb-capture', 'coach-note']));
  });

  it('separates proven classifications from tactical coach-review suggestions', () => {
    const suggestions = buildRoundReviewCards(data(), 'm1')[0].suggestions;
    expect(suggestions.find(item => item.type === 'advantage-collapse')).toMatchObject({ confidence: 'high', requiresCoachConfirmation: false });
    expect(suggestions.find(item => item.type === 'first-death-review')).toMatchObject({ confidence: 'review', requiresCoachConfirmation: true });
    expect(suggestions.some(item => item.label.toLowerCase() === 'overpeek')).toBe(false);
  });

  it('finds repeated issues across player, map, agent, composition and opponent', () => {
    const source = data(); const patterns = buildRecurringReviewPatterns(source, buildRoundReviewCards(source));
    expect(patterns).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'map', key: 'Ascent', issue: 'advantage-collapse', count: 2 }),
      expect.objectContaining({ dimension: 'player', key: 'Alpha', issue: 'first-death-review', count: 2 }),
      expect.objectContaining({ dimension: 'agent', key: 'Jett', issue: 'first-death-review', count: 2 }),
      expect.objectContaining({ dimension: 'opponent', key: 'GA', count: 2 }),
    ]));
  });

  it('promotes confirmed cockpit decisions to the canonical inbox and omits dismissals', () => {
    const source = data(); const summaries = buildAllPracticeBlockSummaries(source);
    let drafts = generateRoundReviewSignalDrafts(source, summaries);
    expect(drafts).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'first-death-review', evidence: expect.objectContaining({ roundIds: ['r1'] }) })]));
    source.rounds[0].reviewCockpit.classifications[0].status = 'dismissed'; drafts = generateRoundReviewSignalDrafts(source, summaries);
    expect(drafts.some(item => item.type === 'first-death-review' && item.evidence.roundIds?.includes('r1'))).toBe(false);
  });
});
