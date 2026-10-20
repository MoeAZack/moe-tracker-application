import { describe, expect, it } from 'vitest';
import { buildPlayerScreenshotMetrics, classifyAverageLoadout, classifyTeamEquipment, combinePlayerScreenshotMetrics, combineStoredScreenshotMetrics, deriveSpecialRoundConversions, materializeFirstDeathsFromRoundEvidence, materializeRoundOpeningsFromScreenshotEvidence, materializeRoundPlantsFromScreenshotEvidence } from '../lib/scrimRoundAnalytics';

const round = (overrides: any = {}) => ({
  id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W',
  screenshotEvidence: { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'confirmed', ourAverageLoadout: 1800, enemyAverageLoadout: 4100,
    players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', equippedWeapon: 'Sheriff', kills: 2, assists: 0, survived: true }],
    eventsComplete: true,
    events: [{ sequence: 1, killerPlayerId: 'p1', victimPlayerId: 'x1', killerTeam: 'ours', victimTeam: 'theirs', weapon: 'Sheriff' }, { sequence: 2, killerPlayerId: 'p1', victimPlayerId: 'x2', killerTeam: 'ours', victimTeam: 'theirs', weapon: 'Sheriff' }] },
  ...overrides,
});

describe('scrim screenshot analytics', () => {
  it('uses stable economy thresholds', () => {
    expect([1999, 2000, 3499, 3500, 3899, 3900].map(classifyAverageLoadout)).toEqual(['eco', 'low', 'low', 'half', 'half', 'full']);
    expect(classifyTeamEquipment(Array.from({ length: 5 }, () => ({ team: 'ours', equippedWeapon: 'Bandit' })), 'ours')).toBe('eco');
  });
  it('derives weapon, opening, multikill, KAST and low-budget wins from confirmed evidence', () => {
    expect(buildPlayerScreenshotMetrics([round()] as any)).toEqual([expect.objectContaining({ identity: 'p1', coveredRounds: 1, wins: 1, firstKills: 1, lowBudgetWins: 1, multikills: { two: 1, three: 0, four: 0, ace: 0 }, kast: { successful: 1, covered: 1 }, weapons: [{ weapon: 'Sheriff', rounds: 1, wins: 1, kills: 2, deaths: 0 }] })]);
  });
  it('uses the cumulative scoreboard assist delta instead of counting an old assist every round', () => {
    const first = round({ roundNo: 1, screenshotEvidence: { ...round().screenshotEvidence, players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', assists: 1, survived: false }], events: [{ sequence: 1, killerPlayerId: 'x1', victimPlayerId: 'p1' }] } });
    const second = round({ id: 'r2', roundNo: 2, screenshotEvidence: { ...round().screenshotEvidence, players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', assists: 1, survived: false }], events: [{ sequence: 1, killerPlayerId: 'x1', victimPlayerId: 'p1' }] } });
    expect(buildPlayerScreenshotMetrics([first, second] as any)[0].kast).toEqual({ successful: 1, covered: 2 });
  });
  it('keeps KAST unknown when assist coverage is unavailable even on a successful round', () => {
    const survived = round({ roundNo: 7, screenshotEvidence: {
      ...round().screenshotEvidence,
      players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', survived: true }],
    } });
    expect(buildPlayerScreenshotMetrics([survived] as any)[0].kast).toEqual({ successful: 0, covered: 0 });
  });
  it('detects full-buy and anti-eco losses without counting review-required evidence', () => {
    const loss = round({ result: 'L', screenshotEvidence: { ...round().screenshotEvidence, ourAverageLoadout: 4300, enemyAverageLoadout: 1700 } });
    const ignored = round({ id: 'r2', screenshotEvidence: { ...round().screenshotEvidence, reviewStatus: 'review-required' } });
    expect(buildPlayerScreenshotMetrics([loss, ignored] as any)[0]).toMatchObject({ losses: 1, highBudgetLosses: 1, antiEcoLosses: 1 });
  });
  it('does not invent openings for players without mapped identities', () => {
    const unmapped = round({ screenshotEvidence: { ...round().screenshotEvidence, players: [{ displayName: 'Alpha', team: 'ours', equippedWeapon: 'Sheriff', assists: 0, survived: true }], events: [{ sequence: 1, killerTeam: 'ours', victimTeam: 'theirs', weapon: 'Sheriff' }] } });
    expect(buildPlayerScreenshotMetrics([unmapped] as any)[0]).toMatchObject({ firstKills: 0, firstDeaths: 0, kast: { successful: 0, covered: 0 } });
  });
  it('requires an explicitly complete event list for event-derived metrics', () => {
    const partial = round({ screenshotEvidence: { ...round().screenshotEvidence, eventsComplete: false, events: [{ sequence: 8, killerPlayerId: 'p1', victimPlayerId: 'x1', weapon: 'Vandal' }] } });
    expect(buildPlayerScreenshotMetrics([partial] as any)[0]).toMatchObject({ firstKills: 0, multikills: { two: 0, three: 0, four: 0, ace: 0 }, kast: { successful: 0, covered: 0 }, weapons: [{ weapon: 'Sheriff', rounds: 1, wins: 1, kills: 0, deaths: 0 }] });
  });
  it('keeps a resolved first death when later kill-feed rows are incomplete', () => {
    const openingOnly = round({ screenshotEvidence: {
      ...round().screenshotEvidence,
      openingEventComplete: true,
      eventsComplete: false,
      players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', equippedWeapon: 'Sheriff', assists: 0, survived: null }],
      events: [{ sequence: 1, killerPlayerId: 'x1', victimPlayerId: 'p1', killerTeam: 'theirs', victimTeam: 'ours', weapon: 'Vandal' }],
    } });
    expect(buildPlayerScreenshotMetrics([openingOnly] as any)[0]).toMatchObject({
      firstKills: 0, firstDeaths: 1,
      multikills: { two: 0, three: 0, four: 0, ace: 0 },
      kast: { successful: 0, covered: 0 },
    });
  });
  it('backfills scoreboard FD and round opening names from complete retained evidence', () => {
    const evidenceRound = round({ screenshotEvidence: {
      ...round().screenshotEvidence,
      reviewStatus: 'review-required',
      openingEventComplete: true,
      players: [
        { playerId: 'name:alpha', displayName: 'Alpha', team: 'ours' },
        { playerId: 'name:enemy', displayName: 'Enemy One', team: 'theirs' },
      ],
      events: [{ sequence: 1, killerPlayerId: 'name:enemy', victimPlayerId: 'name:alpha', killerTeam: 'theirs', victimTeam: 'ours' }],
    } });
    const data: any = {
      matches: [{ id: 'm1', ourScore: 0, theirScore: 1 }],
      rounds: [evidenceRound],
      playerStats: [{ matchId: 'm1', player: 'Alpha', fd: null }],
    };
    expect(materializeRoundOpeningsFromScreenshotEvidence(data)).toBe(2);
    expect(data.rounds[0]).toMatchObject({ firstKillBy: 'Enemy One', firstDeathBy: 'Alpha' });
    expect(materializeFirstDeathsFromRoundEvidence(data)).toBe(1);
    expect(data.playerStats[0].fd).toBe(1);
  });
  it('does not replace coach-entered round openings or existing FD totals', () => {
    const evidenceRound = round({ firstKillBy: 'Reviewed Killer', firstDeathBy: 'Reviewed Victim' });
    const data: any = {
      matches: [{ id: 'm1', ourScore: 1, theirScore: 0 }], rounds: [evidenceRound],
      playerStats: [{ matchId: 'm1', playerId: 'p1', player: 'Alpha', fd: 7 }],
    };
    expect(materializeRoundOpeningsFromScreenshotEvidence(data)).toBe(0);
    expect(materializeFirstDeathsFromRoundEvidence(data)).toBe(0);
    expect(data.rounds[0]).toMatchObject({ firstKillBy: 'Reviewed Killer', firstDeathBy: 'Reviewed Victim' });
    expect(data.playerStats[0].fd).toBe(7);
  });
  it('never writes FD zero for a player missing from the round evidence', () => {
    const data: any = {
      matches: [{ id: 'm1', ourScore: 1, theirScore: 0 }], rounds: [round()],
      playerStats: [{ matchId: 'm1', playerId: 'p1', player: 'Alpha', fd: null }, { matchId: 'm1', playerId: 'p-unseen', player: 'Unseen', fd: null }],
    };
    expect(materializeFirstDeathsFromRoundEvidence(data, { matchId: 'm1' })).toBe(1);
    expect(data.playerStats[0]).toMatchObject({ fd: 0, fdDerivedFrom: 'round-evidence' });
    expect(data.playerStats[1].fd).toBeNull();
  });
  it('refreshes only its own derived FD and retracts it when evidence becomes incomplete', () => {
    const victimRound = round({ screenshotEvidence: { ...round().screenshotEvidence, events: [{ sequence: 1, killerPlayerId: 'x1', victimPlayerId: 'p1', killerTeam: 'theirs', victimTeam: 'ours' }] } });
    const data: any = {
      matches: [{ id: 'm1', ourScore: 0, theirScore: 1 }], rounds: [round()],
      playerStats: [{ matchId: 'm1', playerId: 'p1', player: 'Alpha', fd: null }, { matchId: 'm1', playerId: 'p2', player: 'Coach Set', fd: 4 }],
    };
    data.rounds[0].screenshotEvidence.players.push({ playerId: 'p2', displayName: 'Coach Set', team: 'ours' });
    materializeFirstDeathsFromRoundEvidence(data); expect(data.playerStats[0].fd).toBe(0);
    data.rounds = [{ ...victimRound, screenshotEvidence: { ...victimRound.screenshotEvidence, players: data.rounds[0].screenshotEvidence.players } }];
    materializeFirstDeathsFromRoundEvidence(data);
    expect(data.playerStats[0]).toMatchObject({ fd: 1, fdDerivedFrom: 'round-evidence' });
    expect(data.playerStats[1].fd).toBe(4);
    data.rounds[0].screenshotEvidence = { ...data.rounds[0].screenshotEvidence, openingEventComplete: false, eventsComplete: false };
    materializeFirstDeathsFromRoundEvidence(data);
    expect(data.playerStats[0].fd).toBeNull(); expect(data.playerStats[0]).not.toHaveProperty('fdDerivedFrom');
    expect(data.playerStats[1].fd).toBe(4);
  });
  it('backfills positive plant evidence without inventing negatives or replacing coach review', () => {
    const positive = round({ plant: '', screenshotEvidence: { ...round().screenshotEvidence, objectives: [{ type: 'plant', sourceRow: 4 }] } });
    const unknown = round({ id: 'r2', roundNo: 2, plant: '', screenshotEvidence: { ...round().screenshotEvidence, objectives: [] } });
    const corrected = round({ id: 'r3', roundNo: 3, plant: 'FALSE', screenshotEvidence: { ...round().screenshotEvidence, objectives: [{ type: 'plant', sourceRow: 5 }] } });
    const data: any = { rounds: [positive, unknown, corrected] };
    expect(materializeRoundPlantsFromScreenshotEvidence(data)).toBe(1);
    expect(data.rounds.map((item: any) => item.plant)).toEqual(['TRUE', '', 'FALSE']);
  });
  it('does not count the same match round twice', () => {
    const duplicate = round({ id: 'different-row-id' });
    expect(buildPlayerScreenshotMetrics([round(), duplicate] as any)[0]).toMatchObject({ coveredRounds: 1, wins: 1, firstKills: 1 });
  });
  it('uses the same identity for names with spaces in rounds and stored scoreboards', () => {
    const spaced = round({ screenshotEvidence: { ...round().screenshotEvidence, players: [{ playerId: 'name:rafblack', displayName: 'RAF BLACK', team: 'ours', equippedWeapon: 'Vandal', kills: 1, assists: 0, survived: true }] } });
    const metric = buildPlayerScreenshotMetrics([spaced] as any)[0];
    expect(metric.identity).toBe('unlinked:m1:rafblack');
    expect(combineStoredScreenshotMetrics([{ id: 'legacy-row', player: 'RAF BLACK', screenshotMetrics: metric } as any])[0].identity).toBe('unlinked-name:rafblack');
  });
  it('attributes kills to the event weapon while keeping equipped-round results separate', () => {
    const mixedWeapon = round({ screenshotEvidence: { ...round().screenshotEvidence, events: [
      { sequence: 1, killerPlayerId: 'p1', victimPlayerId: 'x1', weapon: 'Classic' },
      { sequence: 2, killerPlayerId: 'x2', victimPlayerId: 'p1', weapon: 'Vandal' },
    ], players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', equippedWeapon: 'Operator', kills: 1, assists: 0, survived: false }] } });
    expect(buildPlayerScreenshotMetrics([mixedWeapon] as any)[0].weapons).toEqual([
      { weapon: 'Operator', rounds: 1, wins: 1, kills: 0, deaths: 1 },
      { weapon: 'Classic', rounds: 0, wins: 0, kills: 1, deaths: 0 },
    ]);
  });
  it('combines materialized match summaries for the reduced website', () => {
    const metric: any = buildPlayerScreenshotMetrics([round()] as any)[0];
    const { identity: _identity, displayName: _displayName, ...stored } = metric;
    expect(combineStoredScreenshotMetrics([{ playerId: 'p1', player: 'Alpha', screenshotMetrics: stored }, { playerId: 'p1', player: 'Alpha', screenshotMetrics: stored }])[0]).toMatchObject({ coveredRounds: 2, lowBudgetWins: 2, weapons: [{ weapon: 'Sheriff', rounds: 2, wins: 2, kills: 4 }] });
  });
  it('combines same-name unlinked stored appearances for player-facing totals', () => {
    const metric: any = buildPlayerScreenshotMetrics([round()] as any)[0];
    const { identity: _identity, displayName: _displayName, ...stored } = metric;
    const combined = combineStoredScreenshotMetrics([
      { id: 'row-a', player: 'Same Name', screenshotMetrics: stored },
      { id: 'row-b', player: 'Same Name', screenshotMetrics: stored },
    ]);
    expect(combined.map(item => item.identity)).toEqual(['unlinked-name:samename']);
    expect(combined[0]).toMatchObject({ coveredRounds: 2, multikills: { two: 2, three: 0, four: 0, ace: 0 } });
  });
  it('joins an unlinked observed name to its one unambiguous stable identity', () => {
    const metric: any = buildPlayerScreenshotMetrics([round()] as any)[0];
    const combined = combinePlayerScreenshotMetrics([
      { ...metric, identity: 'unlinked:match-a:alpha', displayName: 'Alpha' },
      { ...metric, identity: 'player-alpha', displayName: 'Alpha' },
    ]);
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({ identity: 'player-alpha', displayName: 'Alpha', coveredRounds: 2, multikills: { two: 2 } });
  });
  it('does not guess when the same observed name has multiple stable identities', () => {
    const metric: any = buildPlayerScreenshotMetrics([round()] as any)[0];
    const combined = combinePlayerScreenshotMetrics([
      { ...metric, identity: 'unlinked:match-a:alpha', displayName: 'Alpha' },
      { ...metric, identity: 'player-alpha-one', displayName: 'Alpha' },
      { ...metric, identity: 'player-alpha-two', displayName: 'Alpha' },
    ]);
    expect(combined.map(item => item.identity).sort()).toEqual(['player-alpha-one', 'player-alpha-two', 'unlinked-name:alpha']);
  });
  it('attributes a five-second follow-up kill to the player who made the trade', () => {
    const traded = round({ screenshotEvidence: {
      ...round().screenshotEvidence,
      players: [
        { playerId: 'p1', displayName: 'Alpha', team: 'ours', assists: 0, survived: true },
        { playerId: 'p2', displayName: 'Bravo', team: 'ours', assists: 0, survived: false },
      ],
      events: [
        { sequence: 1, killerPlayerId: 'x1', victimPlayerId: 'p2', killerTeam: 'theirs', victimTeam: 'ours', occurredAtSeconds: 10, tradedWithinSeconds: 3 },
        { sequence: 2, killerPlayerId: 'p1', victimPlayerId: 'x1', killerTeam: 'ours', victimTeam: 'theirs', occurredAtSeconds: 13, tradedWithinSeconds: null },
      ],
    } });
    expect(buildPlayerScreenshotMetrics([traded] as any).find(item => item.identity === 'p1')).toMatchObject({ trades: 1 });
  });
  it('keeps same-name raw screenshot appearances separate across matches', () => {
    const first = round({ matchId: 'match-a', screenshotEvidence: { ...round().screenshotEvidence, players: [{ displayName: 'Same Name', team: 'ours', equippedWeapon: 'Vandal' }] } });
    const second = round({ id: 'r2', matchId: 'match-b', screenshotEvidence: { ...round().screenshotEvidence, players: [{ displayName: 'Same Name', team: 'ours', equippedWeapon: 'Phantom' }] } });
    const metrics = buildPlayerScreenshotMetrics([first, second] as any);
    expect(metrics.map(item => item.identity)).toEqual(['unlinked:match-a:samename', 'unlinked:match-b:samename']);
    expect(metrics.every(item => item.coveredRounds === 1)).toBe(true);
  });
  it('separates ambiguous duplicate unlinked names within a round and declines event attribution', () => {
    const ambiguous = round({ screenshotEvidence: {
      ...round().screenshotEvidence,
      players: [
        { playerId: 'name:same', displayName: 'Same', team: 'ours', equippedWeapon: 'Vandal', assists: 0, survived: true },
        { playerId: 'name:same', displayName: 'Same', team: 'ours', equippedWeapon: 'Phantom', assists: 0, survived: false },
      ],
      events: [{ sequence: 1, killerPlayerId: 'name:same', victimPlayerId: 'enemy', killerTeam: 'ours', victimTeam: 'theirs', weapon: 'Vandal' }],
    } });
    const metrics = buildPlayerScreenshotMetrics([ambiguous] as any);
    expect(metrics.map(item => item.identity)).toEqual(['unlinked:m1:1:same:1', 'unlinked:m1:1:same:2']);
    expect(metrics.map(item => item.coveredRounds)).toEqual([1, 1]);
    expect(metrics.every(item => item.firstKills === 0 && item.kast?.covered === 0 && item.weapons.every(weapon => weapon.kills === 0))).toBe(true);
  });
  it('derives pistol, eco and earned bonus conversion by side from rounds', () => {
    const rows = [
      { roundNo: 1, side: 'Attack', result: 'W', buy: 'Eco' },
      { roundNo: 2, side: 'Attack', result: 'W', buy: 'Low' },
      { roundNo: 3, side: 'Attack', result: 'L', buy: 'Low' },
      { roundNo: 13, side: 'Defense', result: 'L', buy: 'Eco' },
      { roundNo: 14, side: 'Defense', result: 'W', buy: 'Eco' },
    ].map(item => ({ id: `r${item.roundNo}`, matchId: 'm1', ...item }));
    expect(deriveSpecialRoundConversions(rows as any)).toEqual({
      pistol: { attW: 1, attT: 1, defW: 0, defT: 1 },
      eco: { attW: 1, attT: 2, defW: 1, defT: 1 },
      bonus: { attW: 0, attT: 1, defW: 0, defT: 0 },
    });
  });
});
