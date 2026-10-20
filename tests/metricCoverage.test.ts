import { describe, expect, it } from 'vitest';
import { buildPlayerMetricCoverage } from '../lib/metricCoverage';

describe('player metric coverage ledger', () => {
  it('distinguishes known zero, partial coverage and unavailable evidence', () => {
    const rows: any[] = [{ kills: 0, trades: 0, kastSuccessful: 0, kastCovered: 12, sourceMetadata: { method: 'provider-import', provider: 'vrfkit' } }, { kills: 10 }];
    const ledger = buildPlayerMetricCoverage(rows); const by = new Map(ledger.map(row => [row.key, row]));
    expect(by.get('kills')).toMatchObject({ status: 'complete', coveredRows: 2, coveragePercent: 100, publishable: false, unknownReason: 'insufficient-samples' });
    expect(by.get('trades')).toMatchObject({ status: 'partial', coveredRows: 1, coveragePercent: 50 });
    expect(by.get('kast')).toMatchObject({ status: 'partial', denominator: 12 });
    expect(by.get('orbs')).toMatchObject({ status: 'unavailable', unknownReason: 'metric-not-provided-by-accepted-sources' });
  });
});
