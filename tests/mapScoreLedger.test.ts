import { describe, expect, it } from 'vitest';
import { buildMapScoreLedger } from '../lib/mapScoreLedger';

describe('best map contribution ledger', () => {
  it('excludes unknown and undersampled inputs instead of inventing neutral values', () => {
    const gated = buildMapScoreLedger({ winRate: { label: 'Win rate', value: .7, weight: 25, known: true, samples: 8 }, pistol: { label: 'Pistols', value: 0, weight: 20, known: false, samples: 0 } }, 15);
    expect(gated).toMatchObject({ calculationVersion: 'best-map-ledger/v2', score: null, totalWeight: 45, observedWeight: 0, coveragePercent: 0, confidence: 'unavailable', experimental: true });
    expect(gated.contributions[0]).toMatchObject({ observedValue: .7, effectiveValue: null, weightedPoints: 0, status: 'insufficient-sample' });
    expect(gated.contributions[1]).toMatchObject({ observedValue: null, effectiveValue: null, weightedPoints: 0, status: 'unknown', unknownReason: 'missing-evidence' });
    const publishable = buildMapScoreLedger({ winRate: { label: 'Win rate', value: .7, weight: 25, known: true, samples: 15 }, pistol: { label: 'Pistols', value: 0, weight: 20, known: false, samples: 0 } }, 15);
    expect(publishable).toMatchObject({ score: 70, observedWeight: 25, coveragePercent: 56, confidence: 'low' });
  });
});
