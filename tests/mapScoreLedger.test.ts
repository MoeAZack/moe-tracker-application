import { describe, expect, it } from 'vitest';
import { buildMapScoreLedger } from '../lib/mapScoreLedger';

describe('best map contribution ledger', () => {
  it('makes observed and neutral fallback contributions explicit', () => {
    const ledger = buildMapScoreLedger({ winRate: { label: 'Win rate', value: .7, weight: 25, known: true, samples: 8 }, pistol: { label: 'Pistols', value: 0, weight: 20, known: false, samples: 0 } });
    expect(ledger).toMatchObject({ calculationVersion: 'best-map-ledger/v1', totalWeight: 45, observedWeight: 25, coveragePercent: 56, confidence: 'low' });
    expect(ledger.contributions[0]).toMatchObject({ observedValue: .7, weightedPoints: 17.5, status: 'observed' });
    expect(ledger.contributions[1]).toMatchObject({ observedValue: null, effectiveValue: .5, weightedPoints: 10, status: 'neutral-fallback', unknownReason: 'missing-evidence-neutral-baseline' });
  });
});
