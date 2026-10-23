import { describe, expect, it } from 'vitest';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import { createSeed } from '../lib/seed';
import { integrateVodSubmission } from '../lib/vodSubmissions';
import { applyVodHudScore } from '../lib/vodScore';
import { matchResult, matchScore, sideSplit } from '../src/utils/matchScore';

const { parseRoundStateSnapshot, deriveFinalScore, aggregateVideoEvidence } = evidenceModule;

// HUD reads as the round-state reader stores them: "left  timer  right".
const hud = (pairs: Array<[number, number]>, stepMs = 100_000) => pairs.map(([left, right], index) => parseRoundStateSnapshot({ timestampMs: (index + 1) * stepMs, text: `${left}  1:${String(30 - (index % 30)).padStart(2, '0')}  ${right}`, confidence: .8 }));
const evidence = (observations: any[]) => ({ observations });

describe('reading the score on the in-game HUD', () => {
  it('reads the numbers either side of the timer and never takes the timer for a score', () => {
    expect(parseRoundStateSnapshot({ timestampMs: 1, text: '7  1:23  5' })).toMatchObject({ score: [7, 5], scoreSource: 'hud', timerSeconds: 83 });
    expect(parseRoundStateSnapshot({ timestampMs: 1, text: 'BUY PHASE 0:25' })).toMatchObject({ score: null, phase: 'buy', timerSeconds: 25 });
    expect(parseRoundStateSnapshot({ timestampMs: 1, text: '1:23' })).toMatchObject({ score: null });
    expect(parseRoundStateSnapshot({ timestampMs: 1, text: 'BUY PHASE 1 - 0 ROUND 2' })).toMatchObject({ score: [1, 0], scoreSource: 'dash', roundNumber: 2 });
  });

  it('numbers rounds from round text, not from the timer', () => {
    // Timer-only reads used to become scores (1:12 -> 1-12) and so round 14.
    const states = [0, 1, 2].map(index => parseRoundStateSnapshot({ timestampMs: index * 90_000, text: `BUY PHASE 0:${30 - index} ROUND ${index + 1}` }));
    const result = evidenceModule.buildRoundTimeline(states, []);
    expect(result.rounds.map((round: any) => [round.roundNumber, round.scoreBefore])).toEqual([[1, null], [2, null], [3, null]]);
  });

  it('reads a played-out custom game past 13 and ends it after round 24', () => {
    // Custom games can play all 24 rounds: 5-17 is a real HUD score there.
    expect(deriveFinalScore(evidence(hud([[0, 0], [3, 9], [5, 14], [5, 17], [7, 17]])))).toEqual({ left: 7, right: 17, basis: 'final-read', reads: 5 });
    // Seen only up to 5-17: the game had rounds left, so no score is guessed.
    expect(deriveFinalScore(evidence(hud([[0, 0], [3, 9], [5, 14], [5, 17]])))).toBeNull();
  });

  it('takes the final score when the HUD showed it', () => {
    expect(deriveFinalScore(evidence(hud([[0, 0], [1, 0], [5, 3], [9, 7], [13, 9]])))).toEqual({ left: 13, right: 9, basis: 'final-read', reads: 5 });
    expect(deriveFinalScore(evidence(hud([[10, 12], [12, 12], [13, 13], [13, 15]])))).toEqual({ left: 13, right: 15, basis: 'final-read', reads: 4 });
  });

  it('decides the last round from the score before it, because only a winning round ends the game', () => {
    expect(deriveFinalScore(evidence(hud([[0, 0], [4, 4], [8, 6], [12, 9]])))).toMatchObject({ left: 13, right: 9, basis: 'last-round' });
    expect(deriveFinalScore(evidence(hud([[0, 0], [3, 6], [7, 12]])))).toMatchObject({ left: 7, right: 13, basis: 'last-round' });
    expect(deriveFinalScore(evidence(hud([[0, 0], [11, 11], [12, 12], [13, 12]])))).toMatchObject({ left: 14, right: 12, basis: 'last-round' });
  });

  it('stays unknown when the reads cannot decide it', () => {
    // Tied in overtime, short of match point, too few reads, or the last read long before the game ended.
    expect(deriveFinalScore(evidence(hud([[0, 0], [11, 11], [12, 12]])))).toBeNull();
    expect(deriveFinalScore(evidence(hud([[0, 0], [5, 3], [9, 7]])))).toBeNull();
    expect(deriveFinalScore(evidence(hud([[0, 0], [12, 9]])))).toBeNull();
    const late = [...hud([[0, 0], [8, 6], [12, 9]]), { kind: 'elimination', timestampMs: 600_000 }];
    expect(deriveFinalScore(evidence(late))).toBeNull();
    expect(deriveFinalScore(null)).toBeNull();
  });

  it('ignores reads that are not HUD scores and reads that break the climb', () => {
    // Old timer reads (no scoreSource) and an OCR misread (3-12 between 8-6 and 12-9) are left out.
    const reads = [...hud([[0, 0], [8, 6], [3, 12], [12, 9]]), { kind: 'round-state', timestampMs: 50_000, score: [1, 23] }, { kind: 'round-state', timestampMs: 60_000, score: [0, 12] }];
    expect(deriveFinalScore(evidence(reads))).toMatchObject({ left: 13, right: 9, reads: 3 });
  });

  it('never uses reads without a HUD tag, even when they would make a valid score', () => {
    // Older evidence stored timer reads as scores with no tag; they must never count.
    const untagged = [[0, 0], [6, 4], [12, 7]].map((score, index) => ({ kind: 'round-state', timestampMs: (index + 1) * 100_000, score }));
    expect(deriveFinalScore(evidence(untagged))).toBeNull();
    expect(deriveFinalScore(evidence(untagged.map(item => ({ ...item, scoreSource: 'hud' }))))).toMatchObject({ left: 13, right: 7 });
  });

  it('keeps the HUD reads in the evidence a game produces', () => {
    const result = aggregateVideoEvidence({ players: [], roundStateSnapshots: [{ timestampMs: 1000, text: '0  1:40  0' }, { timestampMs: 90_000, text: '12  1:12  9' }] });
    expect(result.observations.filter((item: any) => item.kind === 'round-state').map((item: any) => [item.score, item.scoreSource])).toEqual([[[0, 0], 'hud'], [[12, 9], 'hud']]);
  });
});

describe('a VOD match takes its missing score from the HUD', () => {
  const db = () => { const state: any = createSeed(); Object.assign(state, { rosterPlayers: [], coreMemberships: [], matches: [], playerStats: [], rounds: [], vodSubmissions: [] }); return state; };
  const timeline = (pairs: Array<[number, number]>) => ({ schema: 'moetracker.vod-timeline-evidence/v2', grade: 'video-observation', coverage: { durationMs: 1, signals: { eliminations: 'unsupported' } }, observations: hud(pairs), rounds: [], playerMetrics: [], limitations: [] });
  const submission = (overrides: any = {}) => ({ vodUrl: 'https://example.test/vod', imageSha256: 'a'.repeat(64), playerId: null, date: '2026-10-23', map: 'Haven', opponent: null, ourScore: null, theirScore: null, players: [], timelineEvidence: timeline([[0, 0], [6, 4], [12, 7]]), ...overrides });
  let counter = 0; const ids = () => ({ submissionId: `sub-${++counter}`, matchId: `match-${counter}`, statId: () => `stat-${++counter}`, reviewId: `review-${counter}` });

  it('fills score and marks where it came from', () => {
    const state = db(); const saved = integrateVodSubmission(state, submission(), 'Coach', ids(), '2026-10-23T00:00:00Z');
    expect(state.matches[0]).toMatchObject({ ourScore: 13, theirScore: 7, opponent: 'Unknown opponent', scoreEvidence: { source: 'vod-hud', basis: 'last-round', orientation: 'left-is-ours' } });
    expect(saved.integration.scoreFromHud).toEqual({ ourScore: 13, theirScore: 7, basis: 'last-round' });
    expect(saved).toMatchObject({ ourScore: 13, theirScore: 7 });
  });

  it('does not derive the score again once the coach cleared it', () => {
    const state = db(); integrateVodSubmission(state, submission(), 'Coach', ids(), '2026-10-23T00:00:00Z');
    const match = state.matches[0]; match.ourScore = null; match.theirScore = null;
    expect(applyVodHudScore(match, match.vodTimelineEvidence)).toBeNull();
    expect(match).toMatchObject({ ourScore: null, theirScore: null });
    integrateVodSubmission(state, submission({ imageSha256: 'b'.repeat(64), matchId: match.id }), 'Coach', ids(), '2026-10-23T00:05:00Z');
    expect(state.matches[0]).toMatchObject({ ourScore: null, theirScore: null });
  });

  it('never replaces a score from a scoreboard, and leaves the score empty when the HUD cannot decide it', () => {
    const fromBoard = db(); integrateVodSubmission(fromBoard, submission({ ourScore: 9, theirScore: 13 }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    expect(fromBoard.matches[0]).toMatchObject({ ourScore: 9, theirScore: 13 }); expect(fromBoard.matches[0].scoreEvidence).toBeUndefined();
    const unknown = db(); const saved = integrateVodSubmission(unknown, submission({ timelineEvidence: timeline([[0, 0], [5, 3]]) }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    expect(unknown.matches[0]).toMatchObject({ ourScore: null, theirScore: null }); expect(saved.integration.scoreFromHud).toBeUndefined();
  });
});

describe('a match with no score shows no result', () => {
  it('uses the final score, then the side split, and otherwise has none', () => {
    expect(matchScore({ ourScore: 13, theirScore: 7, attW: null })).toEqual({ ours: 13, theirs: 7 });
    expect(matchScore({ ourScore: null, theirScore: null, attW: 7, attL: 5, defW: 6, defL: 2 })).toEqual({ ours: 13, theirs: 7 });
    expect(matchScore({ ourScore: null, theirScore: null, attW: null, attL: null, defW: null, defL: null })).toBeNull();
    // Half a side split is no score: one side was never recorded.
    expect(matchScore({ ourScore: null, theirScore: null, attW: 7, attL: 5, defW: null, defL: null })).toBeNull();
    expect(matchScore({ ourScore: 13, theirScore: null, attW: null })).toBeNull();
    expect(matchResult({ ourScore: null, theirScore: null })).toBeNull();
    expect(matchResult({ ourScore: 9, theirScore: 13 })).toBe('LOSS');
    expect(matchResult({ ourScore: 13, theirScore: 13 })).toBe('DRAW');
    expect(sideSplit(null, null)).toBe('–'); expect(sideSplit(7, 5)).toBe('7W - 5L');
  });
});
