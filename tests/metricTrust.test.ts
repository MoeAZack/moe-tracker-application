import { describe, expect, it } from 'vitest';
import { metricSampleGate, trustedPercentage } from '../lib/metricTrust';

describe('canonical metric publication gate', () => {
  it('keeps zero and undersampled rates unpublished while preserving their facts', () => {
    expect(metricSampleGate(0, 15)).toMatchObject({ publishable: false, reason: 'no-samples', confidence: 'unavailable' });
    expect(trustedPercentage(6, 10, 15)).toMatchObject({ numerator: 6, denominator: 10, value: null, publishable: false, reason: 'insufficient-samples' });
  });

  it('publishes one canonical numerator/denominator rate after the configured gate', () => {
    expect(trustedPercentage(9, 15, 15)).toMatchObject({ numerator: 9, denominator: 15, value: 60, publishable: true, reason: null, confidence: 'medium' });
  });
});
