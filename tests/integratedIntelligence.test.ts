import { describe, expect, it } from 'vitest';
import { buildSpatialReport, buildCrossMatchHeatmaps } from '../lib/spatialIntelligence';
import { buildEvidenceFusionReport, upsertEvidenceResolution } from '../lib/evidenceFusion';
import { buildCalibratedPlayerRatings } from '../lib/calibratedPlayerRatings';
import { buildContextualWeaponOutcomes } from '../lib/contextualEconomy';
import fs from 'fs';

describe('integrated intelligence', () => {
  it('exposes a restart bridge for retained VOD jobs', () => {
    expect(fs.readFileSync('desktop/preload.cjs', 'utf8')).toContain("desktop:resume-vod-job");
    const main = fs.readFileSync('desktop/main.cjs', 'utf8'); expect(main).toContain("handleTrusted('desktop:resume-vod-job'"); expect(main).toContain('Retained source reopened for a clean restart.');
  });
  it('fails spatial analysis closed without accepted coordinate evidence', () => {
    expect(buildSpatialReport({ status: 'accepted', draft: { evidence: { observations: [{ signal: 'position-zone', attributes: { zone: 'market' } }] } } })).toMatchObject({ available: false, points: [] });
    expect(buildSpatialReport({ status: 'review-required', draft: { evidence: { observations: [{ signal: 'position-zone', attributes: { normalizedX: .2, normalizedY: .3 } }] } } })).toMatchObject({ available: false });
  });

  it('builds replay paths, territory, spacing, kill markers and utility heatmaps from explicit coordinates', () => {
    const record = { status: 'accepted', draft: { evidence: { observations: [
      { signal: 'position-zone', roundNumber: 1, playerId: 'a', teamId: 'blue', timestampMs: 1000, attributes: { normalizedX: .1, normalizedY: .2 } },
      { signal: 'position-zone', roundNumber: 1, playerId: 'b', teamId: 'blue', timestampMs: 1000, attributes: { normalizedX: .3, normalizedY: .2 } },
      { signal: 'elimination', roundNumber: 1, victimId: 'a', teamId: 'blue', timestampMs: 2000, attributes: { normalizedX: .2, normalizedY: .2 } },
      { signal: 'utility-cast', roundNumber: 1, playerId: 'b', teamId: 'blue', timestampMs: 3000, attributes: { normalizedX: .4, normalizedY: .5, ability: 'smoke' } },
    ] } } };
    const report = buildSpatialReport(record); expect(report.available).toBe(true); expect(report.paths).toHaveLength(2); expect(report.killMarkers).toHaveLength(1); expect(report.utilityTimeline).toHaveLength(1); expect(report.spacing.average).toBe(.2);
    expect(buildCrossMatchHeatmaps([record])).toMatchObject({ matchesWithCoordinates: 1, deaths: [{ cell: '2:2', count: 1 }], utility: [{ cell: '4:5', count: 1 }] });
  });

  it('reports source conflicts and keeps coach/replay priority deterministic', () => {
    const data: any = { rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'ATT', result: 'L', buy: 'Eco', screenshotEvidence: { reviewStatus: 'confirmed', result: 'W', players: [], events: [] }, reviewCockpit: { note: 'confirmed plan', updatedAt: '' } }] };
    const report = buildEvidenceFusionReport(data, 'm1'); expect(report.coverage).toBe(100); expect(report.conflicts).toBeGreaterThan(0); expect(report.rounds[0].facts.find(fact => fact.field === 'result')?.source).toBe('screenshot');
    data.evidenceFusionResolutions = []; upsertEvidenceResolution(data.evidenceFusionResolutions, { matchId: 'm1', roundId: 'r1', field: 'result', selectedSource: 'coach', selectedValue: 'L', reason: 'Coach checked the source frame.' }, 'coach', '2026-10-20T10:00:00.000Z');
    upsertEvidenceResolution(data.evidenceFusionResolutions, { matchId: 'm1', roundId: 'r1', field: 'result', selectedSource: 'screenshot', selectedValue: 'W', reason: 'Corrected after second review.' }, 'coach', '2026-10-20T10:01:00.000Z');
    const resolved = buildEvidenceFusionReport(data, 'm1'); expect(resolved.unresolvedConflicts).toBe(0); expect(resolved.rounds[0].facts.find(fact => fact.field === 'result')).toMatchObject({ source: 'screenshot', value: 'W', resolved: true }); expect(data.evidenceFusionResolutions[0].history).toHaveLength(2);
  });

  it('shrinks calibrated ratings toward 50 and preserves context on weapon outcomes', () => {
    const data: any = { rosterPlayers: [], matches: [{ id: 'm1', map: 'Ascent' }, { id: 'm2', map: 'Bind' }], playerStats: [
      { id: 's1', matchId: 'm1', playerId: 'p1', player: 'One', kills: 20, deaths: 10, assists: 5, fk: 4, fd: 1, kastCovered: 10, kastSuccessful: 8, agent: 'Jett' },
      { id: 's2', matchId: 'm2', playerId: 'p2', player: 'Two', kills: 8, deaths: 15, assists: 3, fk: 1, fd: 4, kastCovered: 10, kastSuccessful: 5, agent: 'Omen' },
    ], rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, result: 'W', side: 'ATT', site: 'A', buy: 'Full', enemyBuy: 'Eco', screenshotEvidence: { reviewStatus: 'confirmed', players: [{ playerId: 'p1', displayName: 'One', team: 'ours', equippedWeapon: 'Vandal' }] } }] };
    const ratings = buildCalibratedPlayerRatings(data); expect(ratings[0].rating).toBeLessThan(60); expect(ratings[0].reliability).toBe(17);
    expect(ratings[0]).toMatchObject({ calculationVersion: 'calibrated-player-rating/v2', validationStatus: 'descriptive-unvalidated' }); expect(ratings[0].contexts.maps.length).toBeGreaterThan(0);
    expect(buildContextualWeaponOutcomes(data)[0]).toMatchObject({ weapon: 'Vandal', map: 'Ascent', buyClass: 'Full buy', enemyBuyClass: 'Eco', side: 'ATT', site: 'A', player: 'One', agent: 'Jett', wins: 1 });
  });
});
