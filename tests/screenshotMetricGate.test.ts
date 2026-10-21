import { describe, expect, it } from 'vitest';
import { PLAYER_SCREENSHOT_BUILDER, recomputeAcceptedMatchAggregates, withCurrentScreenshotMetrics } from '../lib/aggregateVersioning';
import { toPublicTrackerData } from '../lib/publicData';
import { refreshCoachingWorkflow } from '../lib/routes/coaching';
import { buildTryoutComparison } from '../lib/tryoutComparison';

// One accepted manual match. With linkedEvidence the round names the player by
// roster id, so 0.2.0 can rebuild the metric; without it the evidence is
// name-only (as on every 0.1.x workspace) and the stored value cannot be rebuilt.
const workspace = (linkedEvidence: boolean) => ({
  settings: { inactiveMaps: [], stats: { lowSample: 1 } },
  rosterPlayers: [{ id: 'p1', displayName: 'Synthetic One' }, { id: 'p2', displayName: 'Synthetic Two' }], coreMemberships: [{ playerId: 'p1' }, { playerId: 'p2' }],
  practiceBlocks: [], tryoutBatches: [],
  matches: [{ id: 'm1', date: '2026-10-14', type: 'Scrim', opponent: 'Synthetic B', map: 'Ascent', attW: 1, attL: 0, defW: 0, defL: 0, source: 'manual', ourScore: 1, theirScore: 0, sourceMetadata: { method: 'manual' } }],
  playerStats: [{ id: 's1', matchId: 'm1', playerId: 'p1', player: 'Synthetic One', displayNameSnapshot: 'Synthetic One', kills: 2, deaths: 0, assists: 0,
    // A 0.1.x value: the old builder, no source hash.
    screenshotMetrics: { schemaVersion: 1, calculationVersion: 'player-screenshot/v0', coveredRounds: 1, kast: { successful: 1, covered: 1 }, multikills: { two: 1, three: 0, four: 0, ace: 0 }, weapons: [] } },
    { id: 's2', matchId: 'm1', playerId: 'p2', player: 'Synthetic Two', displayNameSnapshot: 'Synthetic Two', kills: 0, deaths: 1, assists: 0 }],
  rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W', screenshotEvidence: { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'confirmed', eventsComplete: true,
    players: [{ ...(linkedEvidence ? { playerId: 'p1' } : {}), displayName: 'Synthetic One', team: 'ours', assists: 0, survived: true }],
    events: [{ sequence: 1, killerPlayerId: linkedEvidence ? 'p1' : 'name:Synthetic One', victimPlayerId: 'enemy-1' }, { sequence: 2, killerPlayerId: linkedEvidence ? 'p1' : 'name:Synthetic One', victimPlayerId: 'enemy-2' }] } }],
}) as any;

const practiceRow = (db: any) => refreshCoachingWorkflow(db, 'test', '2026-10-21T12:00:00.000Z').summaries[0].roster[0];
const ratingKast = (db: any) => db.calibratedPlayerRatings.find((row: any) => row.playerId === 'p1');

describe('stored screenshot metrics read through the publication gate', () => {
  it('withholds a stored metric that is not from the current builder and source', () => {
    const db = workspace(false);
    expect(withCurrentScreenshotMetrics(db).playerStats[0]).not.toHaveProperty('screenshotMetrics');
    // A current builder stamp is not enough without the matching source hash.
    db.playerStats[0].screenshotMetrics = { ...db.playerStats[0].screenshotMetrics, calculationVersion: PLAYER_SCREENSHOT_BUILDER, sourceHash: 'stale' };
    expect(withCurrentScreenshotMetrics(db).playerStats[0]).not.toHaveProperty('screenshotMetrics');
    // The stored value itself is never touched.
    expect(db.playerStats[0].screenshotMetrics.kast).toEqual({ successful: 1, covered: 1 });
  });

  it('keeps a metric the current builder made from the current source', () => {
    const db = workspace(true); recomputeAcceptedMatchAggregates(db, 'm1');
    expect(db.playerStats[0].screenshotMetrics.calculationVersion).toBe(PLAYER_SCREENSHOT_BUILDER);
    expect(withCurrentScreenshotMetrics(db).playerStats[0].screenshotMetrics).toEqual(db.playerStats[0].screenshotMetrics);
  });

  it('reads as unknown in practice-block multi-kills and KAST', () => {
    const stale = workspace(false); recomputeAcceptedMatchAggregates(stale, 'm1');
    expect(practiceRow(stale)).toMatchObject({ multikills: null, kast: null });
    const current = workspace(true); recomputeAcceptedMatchAggregates(current, 'm1');
    expect(practiceRow(current).multikills).toBe(1);
    expect(practiceRow(current).kast).toBe(100);
  });

  it('reads as unknown in calibrated ratings', () => {
    const stale = workspace(false); recomputeAcceptedMatchAggregates(stale, 'm1');
    const current = workspace(true); recomputeAcceptedMatchAggregates(current, 'm1');
    expect(ratingKast(stale).contexts.maps[0].kast).toBeNull();
    expect(ratingKast(stale).unknownReasons).toContain('survival-evidence-incomplete');
    expect(ratingKast(current).contexts.maps[0].kast).toBe(100);
    expect(ratingKast(current).unknownReasons).not.toContain('survival-evidence-incomplete');
  });

  it('reads as unknown in tryout comparison KAST, which reads the coach payload', () => {
    const kast = (db: any) => buildTryoutComparison(toPublicTrackerData(db, 'coach') as any, { mode: 'player-player', leftId: 'p1', rightId: 'p2', minimumSamples: 1 } as any).metrics.find((metric: any) => metric.id === 'kast');
    const stale = workspace(false); recomputeAcceptedMatchAggregates(stale, 'm1');
    expect(kast(stale)).toMatchObject({ left: null, leftSamples: 0 });
    const current = workspace(true); recomputeAcceptedMatchAggregates(current, 'm1');
    expect(kast(current)).toMatchObject({ left: 1, leftSamples: 1 });
  });
});
