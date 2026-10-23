import { describe, expect, it } from 'vitest';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import { createSeed } from '../lib/seed';
import { integrateVodSubmission } from '../lib/vodSubmissions';
import { applyVodHudScore } from '../lib/vodScore';
import { matchResult, matchScore, sideSplit } from '../src/utils/matchScore';

const { parseRoundStateSnapshot, parseEndBannerSnapshot, deriveFinalScore, aggregateVideoEvidence, learnTabAliases, wordMatchesName } = evidenceModule;

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

  it('reads the custom-game end screen "ALLIES n - m ENEMIES" as the final score, Allies first', () => {
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: 'ALLIES 7 – 17 ENEMIES' })).toMatchObject({ kind: 'end-banner', score: [7, 17] });
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: 'Allies  13\n- 11  Enemies' })).toMatchObject({ score: [13, 11] });
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: 'ALLIES 40 - 2 ENEMIES' })).toBeNull();
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: 'ALLIES\n7\n17\nENEMIES' })).toMatchObject({ score: [7, 17] });
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: 'ALLIES ENEMIES' })).toBeNull();
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: 'ALLIES 13 11 ENEMIES' })).toMatchObject({ score: [13, 11] });
    expect(parseEndBannerSnapshot({ timestampMs: 5, text: '7 1:23 5' })).toBeNull();
    // The banner beats HUD reads, and comes through the analyzer from whichever region read it.
    const aggregated = aggregateVideoEvidence({ players: [], roundStateSnapshots: hud([[0, 0], [5, 12], [5, 17]]).map((item: any) => ({ timestampMs: item.timestampMs, text: item.rawText })), scoreboardSnapshots: [{ timestampMs: 900_000, text: 'ALLIES 7 - 17 ENEMIES' }] });
    expect(deriveFinalScore(aggregated)).toEqual({ left: 7, right: 17, basis: 'end-banner', reads: 1 });
    // The analyzer's own centre-band crop of the end screen is read too.
    expect(deriveFinalScore(aggregateVideoEvidence({ players: [], endBannerSnapshots: [{ timestampMs: 900_000, text: 'ALLIES  7      17  ENEMIES' }] }))).toEqual({ left: 7, right: 17, basis: 'end-banner', reads: 1 });
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

describe('the last HUD read and kill-feed names', () => {
  it('reads a HUD with no timer as a bare score used only for the partial', () => {
    expect(parseRoundStateSnapshot({ timestampMs: 1, text: '12  12' })).toMatchObject({ score: null, bareScore: [12, 12] });
    const result = aggregateVideoEvidence({ players: [], roundStateSnapshots: [{ timestampMs: 1000, text: '9  1:40  9' }, { timestampMs: 90_000, text: '10  1:12  10' }, { timestampMs: 200_000, text: '12  12' }] });
    expect(deriveFinalScore(result)).toBeNull();
    expect(deriveFinalScore(result, { partial: true })).toMatchObject({ left: 12, right: 12 });
  });

  it('matches feed names loosely: case, prefix and a few OCR edits', () => {
    expect(wordMatchesName('anaval', 'anava1')).toBe(true);
    expect(wordMatchesName('benj', 'benjamin')).toBe(true);
    expect(wordMatchesName('ana', 'zed')).toBe(false);
  });

  it('learns in-game names from the TAB board so feed kills credit typed players', () => {
    const players = [{ name: 'Ana', team: 'ours' }, { name: 'Benji', team: 'ours' }, { name: 'EnemyOne', team: 'theirs' }];
    const board = { timestampMs: 1000, rows: [{ name: 'AnaVal', kills: 0, deaths: 0, assists: 0 }, { name: 'xQ7zz', kills: 0, deaths: 0, assists: 0 }] };
    expect(learnTabAliases(players, [board]).map((player: any) => player.aliases || [])).toEqual([['AnaVal'], ['xQ7zz'], []]);
    const result = aggregateVideoEvidence({ players, tabBoards: [board], killFeedSnapshots: [{ timestampMs: 5000, text: 'AnaVal Vandal EnemyOne' }, { timestampMs: 9000, text: 'xQ7zz Phantom EnemyOne' }] });
    expect(result.playerMetrics.filter((row: any) => row.team === 'ours').map((row: any) => row.kills)).toEqual([1, 1]);
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

  it('saves five typed names with blank K/D/A on a game with no scoreboard, as observed players', () => {
    const blank = { agent: null, kills: null, deaths: null, assists: null, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null };
    const state = db(); const saved = integrateVodSubmission(state, submission({ coachTeamEvidence: true, addObservedPlayers: true, players: ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'].map(observedName => ({ observedName, ...blank })) }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    expect(saved.integration.addedPlayers).toHaveLength(5);
    expect(state.playerStats.filter((stat: any) => stat.matchId === state.matches[0].id)).toHaveLength(5);
    expect(state.playerStats.every((stat: any) => stat.kills === null || stat.kills === undefined)).toBe(true);
  });

  it('counts kills and deaths from the kill feed only as partial, and a scoreboard replaces them', () => {
    const blank = { agent: null, kills: null, deaths: null, assists: null, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null };
    const five = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'];
    const feed = (kills: number) => ({ ...timeline([[0, 0], [6, 4], [12, 7]]), playerMetrics: five.map((playerName, index) => ({ playerName, team: 'ours', kills: index ? kills : 0, deaths: 2, trades: 0 })) });
    const state = db(); const saved = integrateVodSubmission(state, submission({ imageSha256: 'f'.repeat(64), coachTeamEvidence: true, addObservedPlayers: true, players: five.map(observedName => ({ observedName, ...blank })), timelineEvidence: feed(4) }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    const rows = () => state.playerStats.filter((stat: any) => stat.matchId === saved.linkedMatchId);
    expect(rows().map((stat: any) => [stat.kills, stat.deaths, stat.assists])).toEqual(five.map((_, index) => [index ? 4 : 0, 2, null]));
    expect(rows().every((stat: any) => stat.vodEvidence.killFeed?.coverage === 'partial' && stat.vodEvidence.killFeed.fields.join() === 'kills,deaths')).toBe(true);
    // A board for the same match replaces the partial counts and clears the mark.
    integrateVodSubmission(state, submission({ imageSha256: '9'.repeat(64), vodUrl: 'https://example.test/board', matchId: saved.linkedMatchId, coachTeamEvidence: true, players: five.map(observedName => ({ observedName, ...blank, kills: 20, deaths: 15, assists: 3 })), timelineEvidence: null }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    expect(rows().map((stat: any) => [stat.kills, stat.deaths, stat.assists, stat.vodEvidence.killFeed])).toEqual(five.map(() => [20, 15, 3, undefined]));
    // A feed that resolved no kill at all leaves K/D blank, never 0.
    const empty = db(); const none = integrateVodSubmission(empty, submission({ imageSha256: '8'.repeat(64), coachTeamEvidence: true, addObservedPlayers: true, players: five.map(observedName => ({ observedName, ...blank })), timelineEvidence: { ...feed(0), playerMetrics: five.map(playerName => ({ playerName, team: 'ours', kills: 0, deaths: 0, trades: 0 })) } }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    expect(empty.playerStats.filter((stat: any) => stat.matchId === none.linkedMatchId).map((stat: any) => [stat.kills, stat.vodEvidence.killFeed])).toEqual(five.map(() => [null, undefined]));
  });

  it('takes K/D/A from the last TAB board and adds the kill feed after it', () => {
    const players = [{ name: 'Ana', team: 'ours' }, { name: 'Ben', team: 'ours' }];
    const evidence: any = { observations: [{ kind: 'elimination', timestampMs: 50_000, killer: 'Ana', victim: 'x' }, { kind: 'elimination', timestampMs: 150_000, killer: 'Ana', victim: 'x' }, { kind: 'elimination', timestampMs: 160_000, killer: 'x', victim: 'Ben' }], playerMetrics: players.map(player => ({ playerName: player.name, team: 'ours', kills: 0, deaths: 0, trades: 0 })) };
    evidenceModule.applyTabBoards(evidence, [{ timestampMs: 20_000, rows: [{ row: 0, name: 'Ana', kills: 1, deaths: 1, assists: 1 }] }, { timestampMs: 100_000, rows: [{ row: 0, name: 'ANA', kills: 10, deaths: 5, assists: 3 }, { row: 1, name: 'Bxx', kills: 2, deaths: 2, assists: 2 }] }]);
    // Ana: board 10/5/3 at 100 s plus one kill after. Ben's row did not match his name, so he keeps the feed count.
    expect(evidence.playerMetrics.map((metric: any) => [metric.kills, metric.deaths, metric.assists ?? null, metric.source ?? null])).toEqual([[11, 5, 3, 'tab-board+kill-feed'], [0, 0, null, null]]);
    expect(evidence.tabBoard).toMatchObject({ timestampMs: 100_000, rows: 2, matched: 1 });
  });

  it('saves TAB-board assists with the kill-feed counts, marked partial', () => {
    const blank = { agent: null, kills: null, deaths: null, assists: null, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null };
    const five = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'];
    const state = db(); const saved = integrateVodSubmission(state, submission({ imageSha256: '7'.repeat(64), coachTeamEvidence: true, addObservedPlayers: true, players: five.map(observedName => ({ observedName, ...blank })), timelineEvidence: { ...timeline([[0, 0], [6, 4], [12, 7]]), playerMetrics: five.map(playerName => ({ playerName, team: 'ours', kills: 11, deaths: 5, assists: 3, source: 'tab-board+kill-feed', trades: 0 })) } }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    const rows = state.playerStats.filter((stat: any) => stat.matchId === saved.linkedMatchId);
    expect(rows.map((stat: any) => [stat.kills, stat.deaths, stat.assists, stat.vodEvidence.killFeed.source, stat.vodEvidence.killFeed.fields.join()])).toEqual(five.map(() => [11, 5, 3, 'tab-board+kill-feed', 'kills,deaths,assists']));
  });

  it('gives each game of one VOD its own match when the same five names are typed for every game', () => {
    const blank = { agent: null, kills: null, deaths: null, assists: null, acs: null, adr: null, hs: null, fk: null, fd: null, plants: null, defuses: null, trades: null };
    const state = db(); const five = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'];
    const saved = ['b', 'c', 'd'].map(hash => integrateVodSubmission(state, submission({ imageSha256: hash.repeat(64), coachTeamEvidence: true, addObservedPlayers: true, players: five.map(observedName => ({ observedName, ...blank })) }), 'Coach', ids(), '2026-10-23T00:00:00Z'));
    expect(new Set(saved.map(item => item.linkedMatchId)).size).toBe(3);
    expect(saved.map(item => item.linkMode)).toEqual(['new-match', 'new-match', 'new-match']);
    expect(state.rosterPlayers.filter((player: any) => five.includes(player.displayName))).toHaveLength(5);
  });

  it('keeps the last HUD score of a game with no end screen as partial, with no result', () => {
    // The game stopped at 12-12 (network problem, then the lobby): no final score, no W/L.
    const state = db(); const saved = integrateVodSubmission(state, submission({ imageSha256: 'e'.repeat(64), timelineEvidence: timeline([[0, 0], [6, 5], [11, 11], [12, 11], [12, 12]]) }), 'Coach', ids(), '2026-10-23T00:00:00Z');
    const match = state.matches.find((item: any) => item.id === saved.linkedMatchId);
    expect(match).toMatchObject({ ourScore: null, theirScore: null, partialScore: { ours: 12, theirs: 12, basis: 'last-hud', source: 'vod-hud' } });
    expect(matchResult(match)).toBeNull();
    expect(saved.integration.partialScoreFromHud).toEqual({ ourScore: 12, theirScore: 12 });
    expect(saved.integration.scoreFromHud).toBeUndefined();
    // A final score replaces it.
    const final = { ...match, partialScore: { ...match.partialScore } }; applyVodHudScore(final, { observations: [{ kind: 'end-banner', timestampMs: 1, score: [13, 12] }] } as any);
    expect(final).toMatchObject({ ourScore: 13, theirScore: 12 }); expect(final.partialScore).toBeUndefined();
  });

  it('keeps a partial score from just two HUD reads (the VOD ends mid-game), but never a final one', () => {
    const two = { observations: hud([[11, 10], [12, 11]]) } as any;
    expect(evidenceModule.deriveLastHudScore(two)).toMatchObject({ left: 12, right: 11, basis: 'last-hud', reads: 2 });
    expect(deriveFinalScore(two)).toBeNull();
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
