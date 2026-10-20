import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_MIGRATION_SCHEMA,
  MAP_ROUND_BUILDER,
  buildAcceptedMatchAggregatePlan,
  buildCanonicalAnalyticsExport,
  migrateAcceptedMatchAggregates,
  recomputeAcceptedMatchAggregates,
} from '../lib/aggregateVersioning';
import { buildMapRoundIntelligence } from '../lib/mapRoundAnalytics';
import { buildShareableBackupPayload, toPublicTrackerData, toWebsiteTrackerData } from '../lib/publicData';
import { ensureStorageSchema } from '../lib/storageSchema';
import { selectDashboardPersonalRows } from '../src/components/Dashboard';
import { buildEconomySpecialConversions } from '../src/components/EconomyAnalytics';
import { compositionMatchOutcome } from '../src/components/TeamCompositions';

function fixture() {
  return {
    matches: [{ id: 'm1', date: '2026-10-14', type: 'Scrim', opponent: 'B', map: 'Ascent', attW: 7, attL: 5, defW: 6, defL: 5, source: 'manual', roundAnalytics: { schemaVersion: 1, map: 'Ascent', coveredRounds: 999 } }],
    playerStats: [
      { id: 's1', matchId: 'm1', playerId: 'p1', player: 'Same', displayNameSnapshot: 'Same', agent: 'Omen' },
      { id: 's2', matchId: 'm1', player: 'Same', displayNameSnapshot: 'Same', agent: 'Jett', screenshotMetrics: { schemaVersion: 1, coveredRounds: 7 } },
    ],
    rounds: [
      { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Attack', result: 'L', buy: 'Full', enemyBuy: 'Eco' },
      { id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W', screenshotEvidence: { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'confirmed', players: [{ playerId: 'p1', displayName: 'Same', team: 'ours', assists: 0, survived: true }], eventsComplete: true, events: [{ sequence: 1, killerPlayerId: 'p1', victimPlayerId: 'enemy' }] } },
    ],
  } as any;
}

describe('S0.6 aggregate migration', () => {
  it('recomputes from retained source, versions the result, and never reuses a stale aggregate', () => {
    const data = fixture();
    const result = recomputeAcceptedMatchAggregates(data, 'm1');
    expect(result).toMatchObject({ schema: AGGREGATE_MIGRATION_SCHEMA, status: 'recomputed' });
    expect(result.intelligence).toMatchObject({ schema: 'moetracker.match-intelligence/v1', calculatedAtSourceHash: result.sourceHash, fusion: { calculationVersion: 'evidence-fusion/v3' }, spatial: { calculationVersion: 'spatial-intelligence/v4' } });
    expect(data.matches[0].roundAnalytics).toMatchObject({ coveredRounds: 2, calculationVersion: MAP_ROUND_BUILDER, sourceHash: result.sourceHash });
    expect(data.matches[0].roundAnalytics.coveredRounds).not.toBe(999);
    expect(data.playerStats[0].screenshotMetrics).toMatchObject({ coveredRounds: 1, sourceHash: result.sourceHash });
    expect(data.playerStats[1].screenshotMetrics).toEqual({ schemaVersion: 1, coveredRounds: 7 });
  });

  it('offers a pure plan and canonical serialization independent of input order', () => {
    const data = fixture(); const before = JSON.stringify(data);
    const first = buildAcceptedMatchAggregatePlan(data, 'm1');
    data.rounds.reverse();
    const second = buildAcceptedMatchAggregatePlan(data, 'm1');
    expect(first).toEqual(second);
    data.rounds.reverse();
    expect(JSON.stringify(data)).toBe(before);
  });

  it('is order-independent and idempotent without duplicating matches, stats, or unrelated signals', () => {
    const left = fixture(); const right = fixture();
    right.rounds.reverse();
    left.reviewSignals = [{ id: 'keep' }]; right.reviewSignals = [{ id: 'keep' }];
    const first = migrateAcceptedMatchAggregates(left);
    const once = JSON.stringify(left);
    const second = migrateAcceptedMatchAggregates(left);
    migrateAcceptedMatchAggregates(right);
    expect(first).toEqual(second);
    expect(JSON.stringify(left)).toBe(once);
    expect(left.analyticsBuilds).toEqual(right.analyticsBuilds);
    expect(left.matches).toHaveLength(1); expect(left.playerStats).toHaveLength(2);
    expect(left.reviewSignals).toEqual([{ id: 'keep' }]);
  });

  it('changes the fingerprint after a corrected source without appending records', () => {
    const data = fixture();
    migrateAcceptedMatchAggregates(data);
    const before = data.analyticsBuilds.m1.sourceHash;
    data.rounds[0].result = 'W';
    migrateAcceptedMatchAggregates(data);
    expect(data.analyticsBuilds.m1.sourceHash).not.toBe(before);
    expect(Object.keys(data.analyticsBuilds)).toEqual(['m1']);
    const correctedEvidenceHash = data.analyticsBuilds.m1.sourceHash;
    data.playerStats[0].playerId = 'p2';
    migrateAcceptedMatchAggregates(data);
    expect(data.analyticsBuilds.m1.sourceHash).not.toBe(correctedEvidenceHash);
    const correctedIdentityHash = data.analyticsBuilds.m1.sourceHash;
    data.playerStats[0].kills = 17;
    migrateAcceptedMatchAggregates(data);
    expect(data.analyticsBuilds.m1.sourceHash).not.toBe(correctedIdentityHash);
    expect(data.playerStats).toHaveLength(2);
  });

  it('applies a persisted evidence resolution to downstream map and economy analytics', () => {
    const data = fixture();
    const before = recomputeAcceptedMatchAggregates(data, 'm1');
    expect(data.matches[0].roundAnalytics.fullBuyLosses).toMatchObject({ lost: 1, total: 1 });
    data.evidenceFusionResolutions = [{ id: 'fusion:m1:r2:result', matchId: 'm1', roundId: 'r2', field: 'result', selectedSource: 'coach', selectedValue: 'W', reason: 'Coach verified the round result.', revision: 1, updatedAt: '2026-10-20T10:00:00.000Z', updatedBy: 'coach', history: [] }];
    const after = recomputeAcceptedMatchAggregates(data, 'm1');
    expect(after.sourceHash).not.toBe(before.sourceHash);
    expect(data.matches[0].roundAnalytics.fullBuyLosses).toMatchObject({ lost: 0, total: 1 });
    expect(after.intelligence?.fusion.rounds.find(round => round.roundId === 'r2')?.facts.find(fact => fact.field === 'result')).toMatchObject({ resolved: true, value: 'W' });
  });

  it('excludes screenshot drafts and records machine-readable missing/contradictory reasons', () => {
    const draft = fixture();
    draft.matches[0].sourceMetadata = { method: 'screenshot', capturedAt: '2026-10-14T10:00:00.000Z' };
    expect(recomputeAcceptedMatchAggregates(draft, 'm1')).toMatchObject({ status: 'draft-excluded', unknownReason: 'unaccepted-evidence' });
    const missing = fixture(); missing.rounds = [];
    expect(recomputeAcceptedMatchAggregates(missing, 'm1')).toMatchObject({ status: 'source-unavailable', unknownReason: 'missing-round-evidence' });
    const duplicate = fixture(); duplicate.matches.push({ ...duplicate.matches[0] });
    expect(recomputeAcceptedMatchAggregates(duplicate, 'm1')).toMatchObject({ status: 'duplicate-match-id', unknownReason: 'contradictory-match-identity' });
  });

  it('exports S0.2 envelopes for accepted, partial, zero-denominator, legacy, and contradictory inputs', () => {
    const accepted = fixture();
    accepted.workspace = { schemaVersion: 1, id: 'ws_teamAlphaWorkspace0001', createdAt: '2026-10-01T00:00:00.000Z' };
    accepted.rounds.find((round: any) => round.id === 'r2').result = 'W';
    accepted.rounds.push({ id: 'r3', matchId: 'm1', roundNo: 3, side: 'Attack', result: '' });
    const exported = buildCanonicalAnalyticsExport(accepted, 'm1');
    expect(exported.metrics.pistolConversion).toMatchObject({ schema: 'moetracker.derived-metric/v1', calculationVersion: 'canonical-analytics/v1', provenance: 'accepted-only', coverage: { covered: 2, total: 3 } });
    expect(exported.metrics.openingWinLossRatio).toMatchObject({ value: null, denominator: 0, unknownReason: 'denominator-zero' });
    expect(exported.canonicalJson).toBe(buildCanonicalAnalyticsExport(accepted, 'm1').canonicalJson);

    const legacy = fixture(); legacy.workspace = accepted.workspace; legacy.rounds = [];
    expect(buildCanonicalAnalyticsExport(legacy, 'm1').metrics.availability.unknownReason).toBe('unsupported-calculation');
    delete legacy.matches[0].roundAnalytics;
    expect(buildCanonicalAnalyticsExport(legacy, 'm1').metrics.availability.unknownReason).toBe('missing-evidence');
    const conflict = fixture(); conflict.workspace = accepted.workspace; conflict.matches.push({ ...conflict.matches[0] });
    expect(buildCanonicalAnalyticsExport(conflict, 'm1').metrics.availability.unknownReason).toBe('contradictory-evidence');
  });

  it('keeps the canonical map, economy, dashboard payload, and export sample in parity', () => {
    const data = fixture();
    data.workspace = { schemaVersion: 1, id: 'ws_teamAlphaWorkspace0001', createdAt: '2026-10-01T00:00:00.000Z' };
    data.settings = {};
    data.rosterPlayers = [{ id: 'p1', displayName: 'Same' }];
    const builder = buildMapRoundIntelligence([{ ...data.matches[0], roundAnalytics: undefined }], data.rounds)[0];
    const publicData = toPublicTrackerData(data, 'coach');
    const websiteData = toWebsiteTrackerData(data, 'coach');
    const backupData = buildShareableBackupPayload(data);
    const exported = buildCanonicalAnalyticsExport(data, 'm1');
    const economy = buildEconomySpecialConversions(data.matches, data.rounds);
    data.authenticatedViewer = { playerId: 'p1' };
    const personal = selectDashboardPersonalRows(data);
    expect(publicData.matches[0].roundAnalytics.pistol).toEqual(builder.pistol);
    expect(publicData.matches[0].roundAnalytics.postPistol).toEqual(builder.postPistol);
    expect(websiteData.matches[0].roundAnalytics.pistol).toEqual(builder.pistol);
    expect(backupData.matches[0].roundAnalytics.pistol).toEqual(builder.pistol);
    expect(economy.pistol).toEqual({ attW: builder.pistolBySide.attack.won, attT: builder.pistolBySide.attack.total, defW: builder.pistolBySide.defense.won, defT: builder.pistolBySide.defense.total });
    expect(publicData.canonicalAnalytics[0].metrics.pistolConversion).toEqual(exported.metrics.pistolConversion);
    expect(exported.metrics.pistolConversion.numerator).toBe(builder.pistol.won);
    expect(exported.metrics.pistolConversion.denominator).toBe(builder.pistol.total);
    expect(compositionMatchOutcome(data.matches[0])).toBe('win');
    expect(personal.viewer?.id).toBe('p1');
    expect(personal.rows.map(row => row.id)).toEqual(['s1']);
  });

  it('selects personal dashboard rows only from the authenticated stable player ID', () => {
    const base: any = {
      rosterPlayers: [{ id: 'p1', displayName: 'Renamed Player' }],
      playerStats: [{ id: 's1', matchId: 'm1', playerId: 'p1', player: 'Old Label' }],
    };
    expect(selectDashboardPersonalRows({ ...base, authenticatedViewer: { playerId: null } })).toEqual({ viewer: null, rows: [] });
    const bound = selectDashboardPersonalRows({ ...base, authenticatedViewer: { playerId: 'p1' } });
    expect(bound.viewer?.displayName).toBe('Renamed Player');
    expect(bound.rows.map(row => row.id)).toEqual(['s1']);
    base.rosterPlayers[0].displayName = 'Renamed Again';
    expect(selectDashboardPersonalRows({ ...base, authenticatedViewer: { playerId: 'p1' } }).rows.map(row => row.id)).toEqual(['s1']);
  });

  it('applies the current storage schema once and records the versioned migration', () => {
    const data = fixture();
    data._storage = { schemaVersion: 2, migratedAt: '2026-10-01T00:00:00.000Z', migrationLedger: [] };
    ensureStorageSchema(data, '2026-10-15T10:00:00.000Z');
    expect(data._storage).toMatchObject({ schemaVersion: 12, migrationLedger: [{ from: 2, to: 12, at: '2026-10-15T10:00:00.000Z' }] });
    expect(data.analyticsBuilds.m1).toMatchObject({ status: 'recomputed', builders: [MAP_ROUND_BUILDER, 'player-screenshot-metrics/v2'] });
    expect(data.calibratedPlayerRatings).toEqual(expect.any(Array));
    ensureStorageSchema(data, '2026-10-15T11:00:00.000Z');
    expect(data._storage.migrationLedger).toHaveLength(1);
  });
});
