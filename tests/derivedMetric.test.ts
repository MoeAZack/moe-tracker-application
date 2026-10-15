import { describe, expect, it } from 'vitest';
import {
  DERIVED_METRIC_SCHEMA,
  derivedMetricFromCount,
  derivedMetricFromPercentage,
  derivedMetricFromRatio,
  derivedMetricFromValue,
  derivedMetricKey,
  normalizeDerivedMetric,
  parseDerivedMetric,
  requireAcceptedMetricSources,
  resolveDerivedMetricSources,
  serializeDerivedMetric,
  validateDerivedMetric,
  type DerivedMetricAdapterOptions,
  type DerivedMetricV1,
} from '../lib/derivedMetric';
import { EVIDENCE_REFERENCE_SCHEMA, evidenceReferenceKey, type EvidenceReferenceV1 } from '../lib/evidenceReference';

// Synthetic identifiers only. No private match evidence is used in these tests.
const WS = 'ws_metricWorkspace000001';
const OTHER_WS = 'ws_otherWorkspace000002';

function reference(
  state: EvidenceReferenceV1['state'] = 'accepted',
  overrides: Partial<EvidenceReferenceV1> = {},
): EvidenceReferenceV1 {
  return {
    schema: EVIDENCE_REFERENCE_SCHEMA,
    scope: { workspaceId: WS, ownerDeviceId: null },
    state,
    sourceTypes: ['manual'],
    matchId: 'match-one',
    round: null,
    captureSessionId: null,
    screenshot: null,
    replay: null,
    vod: null,
    producer: { parser: null, ocr: null, capture: null },
    capturedAt: '2026-10-15T06:00:00.000Z',
    acceptedAt: state === 'accepted' ? '2026-10-15T06:30:00.000Z' : null,
    observedIdentities: [],
    confidence: 'high',
    fieldProvenance: null,
    ...overrides,
  };
}

const options = (overrides: Partial<DerivedMetricAdapterOptions> = {}): DerivedMetricAdapterOptions => ({
  workspaceId: WS,
  calculationVersion: 'coach-analytics.test/v1',
  sourceReferences: [reference()],
  confidence: { level: 'high', score: 0.9 },
  ...overrides,
});

function mutable(metric: DerivedMetricV1): any {
  return JSON.parse(JSON.stringify(metric));
}

describe('S0.2 canonical derived-metric envelope', () => {
  it('normalizes complete and partial percentages without changing the input', () => {
    const source = { won: 3, total: 4 };
    const complete = derivedMetricFromPercentage(source, options({ requireAcceptedSources: true }));
    expect(source).toEqual({ won: 3, total: 4 });
    expect(complete).toMatchObject({
      schema: DERIVED_METRIC_SCHEMA,
      scope: { workspaceId: WS },
      kind: 'percentage', value: 75, numerator: 3, denominator: 4, sampleCount: 4,
      coverage: { covered: 4, total: 4 }, confidence: { level: 'high', score: 0.9 },
      unknownReason: null, provenance: 'accepted-only', calculationVersion: 'coach-analytics.test/v1',
    });

    const partial = derivedMetricFromPercentage(source, options({ coverage: { covered: 4, total: 10 } }));
    expect(partial.value).toBe(75);
    expect(partial.coverage).toEqual({ covered: 4, total: 10 });
  });

  it('keeps unknown, empty and contradictory metrics distinct from observed zero', () => {
    expect(derivedMetricFromCount({ total: null, samples: 0 }, options()).unknownReason).toBe('no-samples');
    expect(derivedMetricFromPercentage({ won: 0, total: 0 }, options())).toMatchObject({
      value: null, numerator: 0, denominator: 0, sampleCount: 0, unknownReason: 'no-samples',
    });
    expect(derivedMetricFromCount({ total: null, samples: 2 }, options({
      coverage: { covered: 2, total: 3 }, unknownReason: 'contradictory-evidence',
    }))).toMatchObject({ value: null, sampleCount: 2, unknownReason: 'contradictory-evidence' });
    expect(derivedMetricFromPercentage({ won: 0, total: 4 }, options())).toMatchObject({
      value: 0, numerator: 0, denominator: 4, unknownReason: null,
    });
    expect(derivedMetricFromValue({ value: 0, samples: 1 }, options())).toMatchObject({ value: 0, sampleCount: 1 });
  });

  it('requires explicit, non-contradictory known and unknown semantics', () => {
    const known = mutable(derivedMetricFromCount({ total: 2, samples: 2 }, options()));
    known.unknownReason = 'missing-evidence';
    expect(validateDerivedMetric(known)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'unknownReason', code: 'only-when-value-unknown' },
    ]) });
    const unknown = mutable(derivedMetricFromCount({ total: null, samples: 0 }, options()));
    unknown.unknownReason = null;
    expect(validateDerivedMetric(unknown)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'unknownReason', code: 'required-when-value-unknown' },
    ]) });
  });

  it('requires unknown reasons to agree with sample, denominator and coverage facts', () => {
    const sampled = mutable(derivedMetricFromCount({ total: null, samples: 1 }, options()));
    sampled.unknownReason = 'no-samples';
    expect(validateDerivedMetric(sampled)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'unknownReason', code: 'inconsistent-with-facts' },
    ]) });

    const scalar = mutable(derivedMetricFromCount({ total: null, samples: 0 }, options()));
    scalar.unknownReason = 'denominator-zero';
    expect(validateDerivedMetric(scalar)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'unknownReason', code: 'inconsistent-with-facts' },
    ]) });

    const nonzeroDenominator = mutable(derivedMetricFromRatio({
      value: null, numerator: 1, denominator: 2, samples: 1,
    }, options()));
    nonzeroDenominator.unknownReason = 'denominator-zero';
    expect(validateDerivedMetric(nonzeroDenominator)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'unknownReason', code: 'inconsistent-with-facts' },
    ]) });

    const complete = mutable(derivedMetricFromCount({ total: null, samples: 1 }, options()));
    complete.unknownReason = 'incomplete-coverage';
    expect(validateDerivedMetric(complete)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'unknownReason', code: 'inconsistent-with-facts' },
    ]) });

    expect(derivedMetricFromCount({ total: null, samples: 0 }, options())).toMatchObject({
      sampleCount: 0, unknownReason: 'no-samples',
    });
    expect(derivedMetricFromRatio({ value: null, numerator: 1, denominator: 0, samples: 1 }, options())).toMatchObject({
      denominator: 0, unknownReason: 'denominator-zero',
    });
    expect(derivedMetricFromCount({ total: null, samples: 1 }, options({
      coverage: { covered: 1, total: 2 }, unknownReason: 'incomplete-coverage',
    }))).toMatchObject({ coverage: { covered: 1, total: 2 }, unknownReason: 'incomplete-coverage' });
  });

  it('rejects invalid sample counts, coverage and confidence', () => {
    const base = mutable(derivedMetricFromCount({ total: 2, samples: 2 }, options()));
    for (const [path, mutate, code] of [
      ['sampleCount', (raw: any) => { raw.sampleCount = -1; }, 'invalid-sample-count'],
      ['sampleCount', (raw: any) => { raw.sampleCount = 1.5; }, 'invalid-sample-count'],
      ['coverage', (raw: any) => { raw.coverage = { covered: 3, total: 2 }; }, 'covered-exceeds-total'],
      ['confidence.score', (raw: any) => { raw.confidence.score = 1.1; }, 'out-of-range'],
      ['confidence', (raw: any) => { raw.confidence = { level: 'unknown', score: 0.5 }; }, 'unknown-with-score'],
    ] as const) {
      const raw = mutable(base); mutate(raw);
      const result = validateDerivedMetric(raw);
      expect(result).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ path, code })]) });
    }
  });

  it('enforces fraction invariants, exact values and normalized negative zero', () => {
    expect(derivedMetricFromRatio({ value: null, numerator: 10, denominator: 0, samples: 1 }, options())).toMatchObject({
      value: null, numerator: 10, denominator: 0, unknownReason: 'denominator-zero',
    });
    const rate = mutable(derivedMetricFromPercentage({ won: 1, total: 2 }, options()));
    rate.value = 60;
    expect(validateDerivedMetric(rate)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'value', code: 'inconsistent-with-fraction' },
    ]) });
    rate.value = 50; rate.numerator = 3;
    expect(validateDerivedMetric(rate)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'numerator', code: 'exceeds-denominator' },
    ]) });
    rate.value = null; rate.unknownReason = 'missing-evidence'; rate.numerator = null;
    expect(validateDerivedMetric(rate)).toMatchObject({ ok: false, issues: expect.arrayContaining([
      { path: 'numerator', code: 'fraction-pair-required' },
    ]) });
    const negative = mutable(derivedMetricFromCount({ total: 0, samples: 1 }, options()));
    negative.value = -0;
    expect(Object.is(normalizeDerivedMetric(negative).value, -0)).toBe(false);
  });

  it('validates draft, rejected and accepted sources while making the accepted-only gate explicit', () => {
    const accepted = derivedMetricFromCount({ total: 1, samples: 1 }, options());
    expect(requireAcceptedMetricSources(accepted).provenance).toBe('accepted-only');
    for (const state of ['draft', 'rejected'] as const) {
      const metric = derivedMetricFromCount({ total: 1, samples: 1 }, options({
        sourceReferences: [reference(state)], requireAcceptedSources: false,
      }));
      expect(metric.provenance).toBe('includes-unaccepted');
      expect(() => requireAcceptedMetricSources(metric)).toThrow(/accepted-sources-required/);
    }
    const unreferenced = derivedMetricFromCount({ total: 1, samples: 1 }, options({ sourceReferences: [] }));
    expect(unreferenced.provenance).toBe('unreferenced');
    expect(() => requireAcceptedMetricSources(unreferenced)).toThrow(/accepted-sources-required/);
  });

  it('rejects cross-workspace references and confidence above the weakest source', () => {
    expect(() => derivedMetricFromCount({ total: 1, samples: 1 }, options({
      sourceReferences: [reference('accepted', { scope: { workspaceId: OTHER_WS, ownerDeviceId: null } })],
    }))).toThrow(/cross-workspace/);
    expect(() => derivedMetricFromCount({ total: 1, samples: 1 }, options({
      sourceReferences: [reference('accepted', { confidence: 'low' })],
      confidence: { level: 'high', score: null },
    }))).toThrow(/exceeds-source-confidence/);
  });

  it('de-duplicates and sorts sources before stable serialization and keying', () => {
    const second = reference('accepted', { matchId: 'match-two' });
    const first = reference();
    const metric = derivedMetricFromCount({ total: 2, samples: 2 }, options({ sourceReferences: [second, first, second] }));
    expect(metric.sourceReferences).toHaveLength(2);
    expect(metric.sourceReferences.map(evidenceReferenceKey)).toEqual(
      [...metric.sourceReferences.map(evidenceReferenceKey)].sort((a, b) => a.localeCompare(b, 'en')),
    );
    const roundTrip = parseDerivedMetric(serializeDerivedMetric(metric));
    expect(roundTrip).toEqual(metric);
    expect(derivedMetricKey(roundTrip)).toBe(derivedMetricKey(metric));
  });

  it('rejects future schemas, unknown fields and oversized source collections', () => {
    const metric = mutable(derivedMetricFromCount({ total: 1, samples: 1 }, options()));
    metric.schema = 'moetracker.derived-metric/v2';
    expect(validateDerivedMetric(metric)).toEqual({ ok: false, issues: [{ path: 'schema', code: 'unsupported-schema' }] });
    metric.schema = DERIVED_METRIC_SCHEMA; metric.future = true;
    expect(validateDerivedMetric(metric)).toMatchObject({ ok: false, issues: expect.arrayContaining([{ path: 'future', code: 'unknown-field' }]) });
    metric.sourceReferences = Array.from({ length: 129 }, () => reference());
    expect(validateDerivedMetric(metric)).toMatchObject({ ok: false, issues: expect.arrayContaining([{ path: 'sourceReferences', code: 'too-many' }]) });
  });

  it('adapts representative coach analytics outputs without rewriting them', () => {
    const count = { total: 0, samples: 1 };
    const ratio = { value: 2, numerator: 10, denominator: 5, samples: 1 };
    const value = { value: 247.5, samples: 2 };
    expect(derivedMetricFromCount(count, options())).toMatchObject({ kind: 'count', value: 0, sampleCount: 1 });
    expect(derivedMetricFromRatio(ratio, options())).toMatchObject({ kind: 'ratio', value: 2, numerator: 10, denominator: 5 });
    expect(derivedMetricFromValue(value, options())).toMatchObject({ kind: 'scalar', value: 247.5, sampleCount: 2 });
    expect(count).toEqual({ total: 0, samples: 1 });
    expect(ratio).toEqual({ value: 2, numerator: 10, denominator: 5, samples: 1 });
    expect(value).toEqual({ value: 247.5, samples: 2 });
  });

  it('resolves publishable accepted sources against the caller and current store', () => {
    const metric = derivedMetricFromCount({ total: 1, samples: 1 }, options());
    const db = {
      workspace: { schemaVersion: 1, id: WS, createdAt: '2026-10-01T00:00:00.000Z' },
      matches: [{ id: 'match-one', sourceMetadata: { method: 'manual', capturedAt: '2026-10-15T06:00:00.000Z' } }],
      seasonArchives: [], rounds: [], rosterPlayers: [], vodReviews: [],
    };
    expect(resolveDerivedMetricSources(db, metric, { workspaceId: WS })).toMatchObject({ ok: true });
    expect(resolveDerivedMetricSources(db, metric, { workspaceId: OTHER_WS })).toMatchObject({
      ok: false, reason: 'source-resolution-failed', sourceReason: 'cross-workspace',
    });
    db.matches = [];
    expect(resolveDerivedMetricSources(db, metric, { workspaceId: WS })).toMatchObject({
      ok: false, reason: 'source-resolution-failed', sourceReason: 'match-not-found',
    });
  });
});
