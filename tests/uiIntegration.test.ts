import { describe, expect, it } from 'vitest';
import { activeObservedPlayerStats, activeRosterCount, aggregateObservedPlayerDashboard, aggregateObservedPlayerKd, cairoDateKeyAt, canOpenPrivateMatchReview, engineAdapterUiSummary, matchDateWindow, rankedIntegrationReadiness, replayIntegrationReadiness, resolveInitialVodSelection, selectedVodMatchId, shadowRatingReadiness, vodContextMatchId } from '../lib/uiIntegration';
import type { Match, VodReview } from '../src/types';

const review = (id: string, matchId?: string): VodReview => ({ id, matchId, title: id, vodUrl: 'https://example.invalid', notes: [] });

describe('VOD selection behavior', () => {
  it('selects the initial linked review once and preserves a later user selection across refreshed objects', () => {
    const first = [review('a', 'm1'), review('b', 'm2')];
    expect(resolveInitialVodSelection(first, 'm1')).toBe('a');
    const refreshed = first.map(item => ({ ...item }));
    expect(selectedVodMatchId(refreshed, 'b')).toBe('m2');
  });
  it('does not fall back to initial match context for an unlinked selected review', () => {
    const reviews = [review('unlinked'), review('linked', 'm1')];
    expect(selectedVodMatchId(reviews, 'unlinked')).toBeNull();
    expect(resolveInitialVodSelection(reviews, 'missing')).toBeNull();
    expect(vodContextMatchId(reviews, 'unlinked', 'm1', true)).toBeNull();
  });
  it('preserves an initially requested unlinked match until a review is explicitly selected', () => {
    const reviews = [review('unlinked'), review('linked', 'm2')];
    expect(vodContextMatchId(reviews, null, 'm1', false)).toBe('m1');
    expect(vodContextMatchId(reviews.map(item => ({ ...item })), null, 'm1', false)).toBe('m1');
    expect(vodContextMatchId(reviews, 'unlinked', 'm1', true)).toBeNull();
  });
});

describe('observed player K/D aggregation', () => {
  it('uses only finite kills and deaths paired on the same row', () => {
    const result = aggregateObservedPlayerKd([
      { id: 'a', matchId: 'm1', player: 'Alpha', playerId: 'p1', kills: 10, deaths: null },
      { id: 'b', matchId: 'm2', player: 'Alpha', playerId: 'p1', kills: null, deaths: 5 },
      { id: 'c', matchId: 'm3', player: 'Alpha', playerId: 'p1', kills: 8, deaths: 4 },
    ] as any);
    expect(result[0]).toMatchObject({ pairedSamples: 1, recordedRows: 3, kd: 2 });
  });
  it('keeps identical display names with different stable IDs separate', () => {
    const result = aggregateObservedPlayerKd([
      { id: 'a', matchId: 'm1', player: 'Same', playerId: 'p1', kills: 10, deaths: 5 },
      { id: 'b', matchId: 'm2', player: 'Same', playerId: 'p2', kills: 3, deaths: 6 },
    ] as any);
    expect(result.map(row => [row.playerId, row.kd])).toEqual([['p1', 2], ['p2', 0.5]]);
  });
  it('combines exact-name legacy rows that have no stable ID', () => {
    const result = aggregateObservedPlayerKd([
      { id: 'a', matchId: 'm1', player: ' Bellatrix ', kills: 14, deaths: 18 },
      { id: 'b', matchId: 'm2', displayNameSnapshot: 'bellatrix', kills: 17, deaths: 16 },
      { id: 'c', matchId: 'm3', player: 'BELLATRIX', kills: 16, deaths: 26 },
    ] as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ displayName: 'Bellatrix', recordedRows: 3, pairedSamples: 3, playerId: null });
    expect(result[0].kd).toBeCloseTo(47 / 60);
  });
});

describe('observed roster dashboard', () => {
  it('restores retired-ID history for a currently observed alias while hiding archived-only people', () => {
    const data: any = {
      rosterPlayers: [
        { id: 'old-bellatrix', displayName: 'bellatr1x', retiredAt: '2026-10-18T00:00:00.000Z' },
        { id: 'old-elyystan', displayName: 'twitch elyystan', retiredAt: '2026-10-18T00:00:00.000Z' },
      ],
      playerStats: [
        { id: 'old', matchId: 'm1', playerId: 'old-bellatrix', displayNameSnapshot: 'bellatr1x' },
        { id: 'new', matchId: 'm2', playerId: 'observed-new', displayNameSnapshot: 'bellatrix' },
        { id: 'archived', matchId: 'm1', displayNameSnapshot: 'twitch elyystan' },
      ],
    };
    expect(activeObservedPlayerStats(data).map(row => row.id)).toEqual(['old', 'new']);
  });

  it('combines repeated unlinked appearances into one player row and match count', () => {
    const rows = aggregateObservedPlayerDashboard({
      rosterPlayers: [], coreMemberships: [], tryoutBatches: [],
      matches: [{ id: 'm1', date: '2026-10-13', map: 'Haven' }, { id: 'm2', date: '2026-10-14', map: 'Lotus' }, { id: 'm3', date: '2026-10-15', map: 'Pearl' }],
      playerStats: [
        { id: 'a', matchId: 'm1', player: 'bellatrix', kills: 14, deaths: 18, assists: 3 },
        { id: 'b', matchId: 'm2', player: 'Bellatrix', kills: 17, deaths: 16, assists: 5 },
        { id: 'c', matchId: 'm3', displayNameSnapshot: ' BELLATRIX ', kills: 16, deaths: 26, assists: 12 },
      ],
    } as any);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: 'bellatrix', matches: 3, recordedRows: 3, kills: 47, deaths: 60, assists: 20 });
  });

  it('merges orphaned replay IDs and OCR-equivalent names into one dashboard player', () => {
    const rows = aggregateObservedPlayerDashboard({
      rosterPlayers: [], coreMemberships: [], tryoutBatches: [],
      matches: Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, date: `2026-10-${10 + index}`, map: 'Ascent' })),
      playerStats: [
        { id: 'old', matchId: 'm0', playerId: 'orphan-a', displayNameSnapshot: 'bellatr1x', appearanceType: 'standIn', kills: 10, deaths: 5, assists: 2 },
        ...Array.from({ length: 5 }, (_, index) => ({ id: `new-${index}`, matchId: `m${index + 1}`, playerId: 'orphan-b', displayNameSnapshot: 'bellatrix', appearanceType: 'tryout', kills: 10, deaths: 5, assists: 2 })),
      ],
    } as any);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: 'bellatrix', playerId: null, status: 'tryout', matches: 6, recordedRows: 6, kills: 60, deaths: 30, assists: 12, sourceRowIds: ['old', 'new-0', 'new-1', 'new-2', 'new-3', 'new-4'] });
  });

  it('reconciles duplicate rows per match without inflating combat totals and keeps unknown counters unknown', () => {
    const [row] = aggregateObservedPlayerDashboard({
      rosterPlayers: [], coreMemberships: [], tryoutBatches: [], rounds: [], matches: [{ id: 'm1', date: '2026-10-18', map: 'Ascent' }],
      playerStats: [
        { id: 'a', matchId: 'm1', playerId: 'orphan-a', displayNameSnapshot: 'Alpha', kills: 10, deaths: 5, assists: 2, plants: null, defuses: null },
        { id: 'b', matchId: 'm1', playerId: 'orphan-b', displayNameSnapshot: 'alpha', kills: 10, deaths: 5, assists: 2, plants: null, defuses: null },
      ],
    } as any);
    expect(row).toMatchObject({ matches: 1, kills: 10, deaths: 5, assists: 2, plants: null, defuses: null, multikills: { two: null, three: null, four: null, ace: null }, evidence: { duplicateRowsReconciled: 1 } });
  });

  it('reconciles screenshot metrics per match instead of dropping stored history when live rounds exist', () => {
    const stored = { schemaVersion: 1, coveredRounds: 2, wins: 1, losses: 1, firstKills: 1, firstDeaths: 0, trades: 0, multikills: { two: 1, three: 0, four: 0, ace: 0 }, lowBudgetWins: 0, highBudgetLosses: 0, antiEcoLosses: 0, kast: { successful: 1, covered: 2 }, weapons: [] };
    const [row] = aggregateObservedPlayerDashboard({
      rosterPlayers: [], coreMemberships: [], tryoutBatches: [], matches: [{ id: 'm1', date: '2026-10-17' }, { id: 'm2', date: '2026-10-18' }],
      playerStats: [{ id: 'a', matchId: 'm1', playerId: 'p1', displayNameSnapshot: 'Alpha', screenshotMetrics: stored }, { id: 'b', matchId: 'm2', playerId: 'p1', displayNameSnapshot: 'Alpha' }],
      rounds: [{ id: 'r1', matchId: 'm2', roundNo: 1, result: 'W', screenshotEvidence: { reviewStatus: 'confirmed', players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', survived: true }], eventsComplete: true, events: [] } }],
    } as any);
    expect(row.evidence.screenshotRounds).toBe(3);
    expect(row.multikills.two).toBe(1);
  });

  it('does not merge distinct active roster identities that share a normalized name', () => {
    const rows = aggregateObservedPlayerDashboard({
      rosterPlayers: [{ id: 'p1', displayName: 'Same', createdAt: '2026-10-01' }, { id: 'p2', displayName: 'same', createdAt: '2026-10-02' }], coreMemberships: [], tryoutBatches: [], matches: [],
      playerStats: [{ id: 'a', matchId: 'm1', playerId: 'p1', player: 'Same' }, { id: 'b', matchId: 'm2', playerId: 'p2', player: 'same' }],
    } as any);
    expect(rows.map(row => row.playerId)).toEqual(['p2', 'p1']);
  });

  it('never lets equal names override conflicting stable screenshot identities', () => {
    const rows = aggregateObservedPlayerDashboard({
      rosterPlayers: [{ id: 'p1', displayName: 'Same', createdAt: '2026-10-01' }, { id: 'p2', displayName: 'same', createdAt: '2026-10-02' }], coreMemberships: [], tryoutBatches: [],
      matches: [{ id: 'm1', date: '2026-10-18' }],
      playerStats: [{ id: 'a', matchId: 'm1', playerId: 'p1', player: 'Same' }, { id: 'b', matchId: 'm1', playerId: 'p2', player: 'same' }],
      rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, result: 'W', screenshotEvidence: { reviewStatus: 'confirmed', players: [{ playerId: 'p1', displayName: 'Same', team: 'ours', survived: true }, { playerId: 'p2', displayName: 'same', team: 'ours', survived: true }], eventsComplete: true, events: [{ sequence: 1, killerPlayerId: 'p1', victimPlayerId: 'enemy', killerTeam: 'ours', victimTeam: 'theirs' }] } }],
    } as any);
    const first = rows.find(row => row.playerId === 'p1')!; const second = rows.find(row => row.playerId === 'p2')!;
    expect(first).toMatchObject({ firstKills: 1, evidence: { screenshotRounds: 1 }, sourceRowIds: ['a'] });
    expect(second).toMatchObject({ firstKills: 0, evidence: { screenshotRounds: 1 }, sourceRowIds: ['b'] });
  });

  it('does not guess an unlinked same-name screenshot when multiple stable candidates exist', () => {
    const rows = aggregateObservedPlayerDashboard({
      rosterPlayers: [{ id: 'p1', displayName: 'Same', createdAt: '2026-10-01' }, { id: 'p2', displayName: 'same', createdAt: '2026-10-02' }], coreMemberships: [], tryoutBatches: [],
      matches: [{ id: 'm1', date: '2026-10-18' }],
      playerStats: [{ id: 'a', matchId: 'm1', playerId: 'p1', player: 'Same' }, { id: 'b', matchId: 'm1', playerId: 'p2', player: 'same' }],
      rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, result: 'W', screenshotEvidence: { reviewStatus: 'confirmed', players: [{ displayName: 'Same', team: 'ours', survived: true }], eventsComplete: true, events: [] } }],
    } as any);
    expect(rows.map(row => row.evidence.screenshotRounds)).toEqual([0, 0]);
  });

  it('surfaces scoreboard, opening, economy, weapon, map and evidence metrics for unmatched names', () => {
    const [row] = aggregateObservedPlayerDashboard({
      rosterPlayers: [], coreMemberships: [], tryoutBatches: [],
      matches: [{ id: 'm1', date: '2026-10-14', map: 'Ascent', ourScore: 13, theirScore: 8 }],
      playerStats: [{ id: 's1', matchId: 'm1', player: 'Trial', agent: 'Jett', kills: 20, deaths: 10, assists: 5, acs: 250, adr: 160, hs: 30, fk: 4, fd: 2, plants: 1, defuses: 0, screenshotMetrics: { schemaVersion: 1, coveredRounds: 21, wins: 13, losses: 8, firstKills: 4, firstDeaths: 2, trades: 2, multikills: { two: 3, three: 1, four: 0, ace: 0 }, lowBudgetWins: 2, highBudgetLosses: 1, antiEcoLosses: 1, kast: { successful: 16, covered: 21 }, weapons: [{ weapon: 'Vandal', rounds: 12, wins: 8, kills: 15, deaths: 6 }] } }],
    } as any);
    expect(row).toMatchObject({ displayName: 'Trial', status: 'tryout', matches: 1, wins: 1, losses: 0, mainAgent: 'Jett', kills: 20, firstKills: 4, firstDeaths: 2, trades: 2, multikills: { two: 3, three: 1, four: 0, ace: 0 }, lowBudgetWins: 2, highBudgetLosses: 1, antiEcoLosses: 1, maps: [{ name: 'Ascent', matches: 1, wins: 1 }], weapons: [{ name: 'Vandal', rounds: 12 }] });
    expect(row.kast).toBeCloseTo(16 / 21);
  });
});

describe('role-safe match actions', () => {
  it('permits private match review only for coaches', () => {
    expect(canOpenPrivateMatchReview('coach')).toBe(true);
    expect(canOpenPrivateMatchReview('player')).toBe(false);
    expect(canOpenPrivateMatchReview(null)).toBe(false);
  });
});

describe('engine adapter UI summary', () => {
  it('labels accepted evidence without implying ranked activation or rating authority', () => {
    expect(engineAdapterUiSummary({
      replay: [{ status: 'accepted' }], ratings: [{ status: 'accepted' }],
      ranked: { consents: [{ revokedAt: null }] },
    })).toEqual({
      replay: { configured: true, note: '1 persisted review; acceptance required' },
      shadowRating: { configured: true, note: '1 recomputed shadow record; uncalibrated results stay experimental and never authoritative' },
      rankedConsent: { configured: true, note: 'Offline consent/status only; provider sync remains disabled' },
    });
  });
  it('derives readiness and ranked health from persisted adapter facts', () => {
    const payload = { replay: [{ status: 'accepted' }], ratings: { records: { r: { status: 'accepted', calibrationStatus: 'uncalibrated', result: { eligibleForShadowAggregate: true } } } }, ranked: { providers: [{ approvedStatus: 'approved' }], accounts: [{}], consents: [{ revokedAt: null }], states: [{ status: 'fresh' }, { status: 'partial' }, { status: 'never-synced' }] } };
    expect(replayIntegrationReadiness(payload)).toMatchObject({ status: 'ready', detail: expect.stringContaining('1 accepted') });
    expect(shadowRatingReadiness(payload)).toMatchObject({ status: 'ready', detail: expect.stringContaining('1 accepted with coverage') });
    const ranked = rankedIntegrationReadiness(payload); expect(ranked.status).toBe('ready'); expect(ranked.detail).toContain('1 fresh'); expect(ranked.detail).toContain('1 partial'); expect(ranked.detail).toContain('1 never-synced'); expect(ranked.detail).not.toContain('healthy');
  });
  it('counts an accepted player-safe shadow projection without private coach result input', () => {
    const readiness = shadowRatingReadiness({ ratings: [{ status: 'accepted', acceptedWithCoverage: true, calibrationStatus: 'uncalibrated', experimental: true, coverage: { availableWeight: .8, totalWeight: 1, ratio: .8 }, score: 1.07, authoritativeScore: null }] });
    expect(readiness).toMatchObject({ status: 'ready', detail: expect.stringContaining('1 accepted with coverage') });
  });
});

describe('dashboard normalization', () => {
  it('uses Africa/Cairo for winter, summer DST and UTC-midnight date defaults', () => {
    expect(cairoDateKeyAt(new Date('2026-01-01T22:00:00.000Z'))).toBe('2026-01-02');
    expect(cairoDateKeyAt(new Date('2026-07-01T21:00:00.000Z'))).toBe('2026-07-02');
    expect(cairoDateKeyAt(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01');
  });
  it('includes offset timestamps by Cairo date and excludes malformed dates without throwing', () => {
    const matches = [
      { date: '2026-10-11T22:30:00Z' },
      { date: 'bad-date' },
      { date: '2026-10-13' },
    ] as Match[];
    expect(matchDateWindow(matches)).toEqual({ start: '2026-10-12', end: '2026-10-13' });
  });
  it('distinguishes a valid zero-active membership model from missing legacy membership data', () => {
    const settings = { players: ['Legacy'] } as any;
    expect(activeRosterCount({ coreMemberships: [{ id: 'm', playerId: 'p', joinedAt: '2026-01-01', endedAt: '2026-02-01' }], settings })).toEqual({ count: 0, source: 'membership' });
    expect(activeRosterCount({ coreMemberships: undefined as any, settings })).toEqual({ count: 1, source: 'legacy' });
  });
});
