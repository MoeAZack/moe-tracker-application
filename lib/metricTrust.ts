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

export type MetricWithheldReason = 'no-samples' | 'insufficient-samples' | 'incomplete-coverage' | 'no-evidence';

/** The single publication record every coach-facing rate is read from. */
export interface MetricPublication {
  /** Published value on the requested scale, or null when withheld. */
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  coverage: { observed: number; expected: number; complete: boolean };
  samples: number;
  minimumSamples: number;
  publishable: boolean;
  confidence: MetricSampleGate['confidence'];
  withheldReason: MetricWithheldReason | null;
}

export const isKnownCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Sum a field only when every row carries it; a missing row never becomes zero. */
export function knownTotal<T>(rows: readonly T[], read: (row: T) => unknown): number | null {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) { const value = read(row); if (!isKnownCount(value)) return null; total += value; }
  return total;
}

/**
 * Publish numerator/denominator as a rate. `observed`/`expected` describe how
 * many source rows supplied the counts; any shortfall withholds the value while
 * keeping the facts. `samples` defaults to the denominator.
 */
export function publishRate(input: { numerator: number | null; denominator: number | null; observed: number; expected: number; minimumSamples?: number; samples?: number; scale?: number }): MetricPublication {
  const { numerator, denominator, observed, expected, scale = 100 } = input;
  const coverage = { observed, expected, complete: expected > 0 && observed === expected };
  const countsKnown = isKnownCount(numerator) && isKnownCount(denominator);
  const gate = metricSampleGate(countsKnown ? (input.samples ?? denominator!) : 0, input.minimumSamples);
  const withheldReason: MetricWithheldReason | null = !expected || !observed ? 'no-evidence' : !coverage.complete || !countsKnown ? 'incomplete-coverage' : gate.reason;
  const publishable = withheldReason === null && denominator! > 0;
  return {
    value: publishable ? numerator! / denominator! * scale : null,
    numerator: countsKnown ? numerator : null, denominator: countsKnown ? denominator : null,
    coverage, samples: gate.samples, minimumSamples: gate.minimumSamples, publishable,
    confidence: publishable ? gate.confidence : observed ? 'low' : 'unavailable',
    withheldReason: publishable ? null : withheldReason ?? 'no-samples',
  };
}

export interface KastEvidence { successful: number; covered: number }

/** Screenshot KAST counts only when every confirmed round has survival, event and assist coverage. */
export function screenshotKastEvidence(metric: { coveredRounds?: number; kast?: { successful: number; covered: number } } | null | undefined): KastEvidence | null {
  const kast = metric?.kast; const rounds = metric?.coveredRounds;
  if (!kast || !isKnownCount(rounds) || !rounds || !isKnownCount(kast.covered) || !isKnownCount(kast.successful)) return null;
  return kast.covered === rounds && kast.successful <= kast.covered ? { successful: kast.successful, covered: kast.covered } : null;
}

/** KAST evidence for one saved player row: complete screenshot coverage, else direct counts. */
export function playerRowKastEvidence(row: { kastSuccessful?: number | null; kastCovered?: number | null; screenshotMetrics?: { coveredRounds?: number; kast?: { successful: number; covered: number } } | null }): KastEvidence | null {
  if (row.screenshotMetrics) return screenshotKastEvidence(row.screenshotMetrics);
  return isKnownCount(row.kastSuccessful) && isKnownCount(row.kastCovered) && row.kastCovered > 0 && row.kastSuccessful <= row.kastCovered ? { successful: row.kastSuccessful, covered: row.kastCovered } : null;
}

/**
 * The one KAST implementation. Each part is one match's (or row's) evidence;
 * a null part means that source had no complete KAST and withholds the total
 * rather than letting the covered subset stand in for it.
 */
export function publishKast(parts: ReadonlyArray<KastEvidence | null>, minimumSamples = 1): MetricPublication {
  const known = parts.filter((part): part is KastEvidence => part !== null);
  const complete = known.length === parts.length;
  return publishRate({
    numerator: complete && known.length ? known.reduce((sum, part) => sum + part.successful, 0) : null,
    denominator: complete && known.length ? known.reduce((sum, part) => sum + part.covered, 0) : null,
    observed: known.length, expected: parts.length, minimumSamples,
  });
}

/** KAST for saved player rows, one part per row. */
export const publishRowKast = (rows: ReadonlyArray<Parameters<typeof playerRowKastEvidence>[0]>, minimumSamples = 1) => publishKast(rows.map(playerRowKastEvidence), minimumSamples);
