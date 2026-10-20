export const DEFAULT_MINIMUM_METRIC_SAMPLES = 15;

export type MetricSampleGate = {
  samples: number;
  minimumSamples: number;
  publishable: boolean;
  confidence: 'high' | 'medium' | 'low' | 'unavailable';
  reason: 'no-samples' | 'insufficient-samples' | null;
};

/** One shared publication gate for coach-facing rates and composite scores. */
export function metricSampleGate(samples: number, minimumSamples = DEFAULT_MINIMUM_METRIC_SAMPLES): MetricSampleGate {
  const observed = Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : 0;
  const minimum = Number.isFinite(minimumSamples) ? Math.max(1, Math.floor(minimumSamples)) : DEFAULT_MINIMUM_METRIC_SAMPLES;
  if (!observed) return { samples: 0, minimumSamples: minimum, publishable: false, confidence: 'unavailable', reason: 'no-samples' };
  if (observed < minimum) return { samples: observed, minimumSamples: minimum, publishable: false, confidence: 'low', reason: 'insufficient-samples' };
  return { samples: observed, minimumSamples: minimum, publishable: true, confidence: observed >= minimum * 2 ? 'high' : 'medium', reason: null };
}

export function trustedPercentage(numerator: number, denominator: number, minimumSamples = DEFAULT_MINIMUM_METRIC_SAMPLES) {
  const gate = metricSampleGate(denominator, minimumSamples);
  return { ...gate, numerator, denominator, value: gate.publishable && denominator > 0 ? numerator / denominator * 100 : null };
}
