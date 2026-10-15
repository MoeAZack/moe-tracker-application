/**
 * S0.2 — Canonical derived-metric envelope.
 *
 * This module wraps current analytics outputs on demand. It does not migrate or
 * rewrite persisted match, round, screenshot or replay records.
 */
import crypto from 'crypto';
import {
  evidenceReferenceKey,
  normalizeEvidenceReference,
  resolveEvidenceReference,
  type EvidenceReferenceV1,
  type EvidenceResolution,
} from './evidenceReference';

export const DERIVED_METRIC_SCHEMA = 'moetracker.derived-metric/v1' as const;
export const DERIVED_METRIC_VERSION = 1 as const;

export const DERIVED_METRIC_KINDS = ['count', 'scalar', 'average', 'ratio', 'rate', 'percentage'] as const;
export const DERIVED_METRIC_UNKNOWN_REASONS = [
  'no-samples',
  'missing-evidence',
  'incomplete-coverage',
  'contradictory-evidence',
  'denominator-zero',
  'unsupported-calculation',
] as const;
export const DERIVED_METRIC_CONFIDENCE_LEVELS = ['confirmed', 'high', 'medium', 'low', 'unknown'] as const;
export const DERIVED_METRIC_PROVENANCE = ['accepted-only', 'includes-unaccepted', 'unreferenced'] as const;

export type DerivedMetricKind = typeof DERIVED_METRIC_KINDS[number];
export type DerivedMetricUnknownReason = typeof DERIVED_METRIC_UNKNOWN_REASONS[number];
export type DerivedMetricConfidenceLevel = typeof DERIVED_METRIC_CONFIDENCE_LEVELS[number];
export type DerivedMetricProvenance = typeof DERIVED_METRIC_PROVENANCE[number];

export interface DerivedMetricV1 {
  schema: typeof DERIVED_METRIC_SCHEMA;
  scope: { workspaceId: string };
  kind: DerivedMetricKind;
  /** Null is unknown. A measured zero is always retained as zero. */
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  /** Independent observations used in the calculation. */
  sampleCount: number;
  coverage: { covered: number; total: number };
  confidence: { level: DerivedMetricConfidenceLevel; score: number | null };
  /** Required exactly when value is null. */
  unknownReason: DerivedMetricUnknownReason | null;
  /** Derived from source states; callers cannot label draft/rejected evidence accepted. */
  provenance: DerivedMetricProvenance;
  sourceReferences: EvidenceReferenceV1[];
  calculationVersion: string;
}

export type DerivedMetricIssue = { path: string; code: string };

export class DerivedMetricError extends Error {
  status = 400;
  constructor(readonly code: string, readonly issues: DerivedMetricIssue[] = []) {
    super(issues.length
      ? `Derived metric is invalid: ${issues.map(issue => `${issue.path} ${issue.code}`).join('; ')}.`
      : `Derived metric is invalid: ${code}.`);
  }
}

export interface DerivedMetricValidationOptions {
  /** S1+ accepted analytics can turn this on to reject drafts, rejections and missing provenance. */
  requireAcceptedSources?: boolean;
}

const ROOT_KEYS = [
  'schema', 'scope', 'kind', 'value', 'numerator', 'denominator', 'sampleCount', 'coverage',
  'confidence', 'unknownReason', 'provenance', 'sourceReferences', 'calculationVersion',
];
const SCOPE_KEYS = ['workspaceId'];
const COVERAGE_KEYS = ['covered', 'total'];
const CONFIDENCE_KEYS = ['level', 'score'];
const WORKSPACE_ID = /^ws_[A-Za-z0-9_-]{16,64}$/;
const VERSION_LABEL = /^[A-Za-z0-9][A-Za-z0-9._@/+:-]{0,119}$/;
const MAX_SAMPLE_COUNT = 10_000_000;
const MAX_ABSOLUTE_VALUE = 1_000_000_000_000_000;
const MAX_SOURCE_REFERENCES = 128;
const MAX_ENVELOPE_BYTES = 256 * 1024;
const FRACTION_TOLERANCE = 1e-12;
const CONFIDENCE_RANK: Record<DerivedMetricConfidenceLevel, number> = {
  unknown: 0, low: 1, medium: 2, high: 3, confirmed: 4,
};

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify(value, (_key, nested) => isObject(nested)
  ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
  : nested);

class Reader {
  issues: DerivedMetricIssue[] = [];
  fail(path: string, code: string) { this.issues.push({ path, code }); return null; }
  exactKeys(value: Record<string, any>, keys: readonly string[], path = '') {
    for (const key of Object.keys(value)) if (!keys.includes(key)) this.fail(path ? `${path}.${key}` : key, 'unknown-field');
  }
  number(value: unknown, path: string): number | null {
    if (value === null || value === undefined) return null;
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_VALUE
      ? (Object.is(value, -0) ? 0 : value) : this.fail(path, 'invalid-number');
  }
  integer(value: unknown, path: string): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAMPLE_COUNT
      ? value : this.fail(path, 'invalid-sample-count');
  }
  oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T | null {
    return values.includes(value as T) ? value as T : this.fail(path, 'invalid-enum');
  }
}

function provenanceFor(references: readonly EvidenceReferenceV1[]): DerivedMetricProvenance {
  if (!references.length) return 'unreferenced';
  return references.every(reference => reference.state === 'accepted') ? 'accepted-only' : 'includes-unaccepted';
}

function sameNumber(left: number, right: number) {
  return Math.abs(left - right) <= FRACTION_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right));
}

/** Strictly normalize and validate an envelope; unknown fields and future schemas fail closed. */
export function validateDerivedMetric(
  raw: unknown,
  options: DerivedMetricValidationOptions = {},
): { ok: true; value: DerivedMetricV1 } | { ok: false; issues: DerivedMetricIssue[] } {
  const reader = new Reader();
  if (!isObject(raw)) return { ok: false, issues: [{ path: '', code: 'invalid-object' }] };
  let bytes = Infinity;
  try { bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8'); } catch { /* reported below */ }
  if (bytes > MAX_ENVELOPE_BYTES) return { ok: false, issues: [{ path: '', code: 'too-large' }] };
  if (raw.schema !== DERIVED_METRIC_SCHEMA) return { ok: false, issues: [{ path: 'schema', code: 'unsupported-schema' }] };
  reader.exactKeys(raw, ROOT_KEYS);

  const scope = isObject(raw.scope) ? raw.scope : {};
  if (!isObject(raw.scope)) reader.fail('scope', 'invalid-object');
  reader.exactKeys(scope, SCOPE_KEYS, 'scope');
  const workspaceId = typeof scope.workspaceId === 'string' && WORKSPACE_ID.test(scope.workspaceId)
    ? scope.workspaceId : reader.fail('scope.workspaceId', 'invalid-workspace-id');
  const kind = reader.oneOf(raw.kind, DERIVED_METRIC_KINDS, 'kind');
  const value = reader.number(raw.value, 'value');
  const numerator = reader.number(raw.numerator, 'numerator');
  const denominator = reader.number(raw.denominator, 'denominator');
  const sampleCount = reader.integer(raw.sampleCount, 'sampleCount');

  const coverageRaw = isObject(raw.coverage) ? raw.coverage : {};
  if (!isObject(raw.coverage)) reader.fail('coverage', 'invalid-object');
  reader.exactKeys(coverageRaw, COVERAGE_KEYS, 'coverage');
  const covered = reader.integer(coverageRaw.covered, 'coverage.covered');
  const total = reader.integer(coverageRaw.total, 'coverage.total');
  if (covered !== null && total !== null && covered > total) reader.fail('coverage', 'covered-exceeds-total');
  if (sampleCount !== null && covered !== null && sampleCount > covered) reader.fail('sampleCount', 'exceeds-covered');

  const confidenceRaw = isObject(raw.confidence) ? raw.confidence : {};
  if (!isObject(raw.confidence)) reader.fail('confidence', 'invalid-object');
  reader.exactKeys(confidenceRaw, CONFIDENCE_KEYS, 'confidence');
  const confidenceLevel = reader.oneOf(confidenceRaw.level, DERIVED_METRIC_CONFIDENCE_LEVELS, 'confidence.level');
  const confidenceScore = reader.number(confidenceRaw.score, 'confidence.score');
  if (confidenceScore !== null && (confidenceScore < 0 || confidenceScore > 1)) reader.fail('confidence.score', 'out-of-range');
  if (confidenceLevel === 'unknown' && confidenceScore !== null) reader.fail('confidence', 'unknown-with-score');

  const unknownReason = raw.unknownReason === null
    ? null : reader.oneOf(raw.unknownReason, DERIVED_METRIC_UNKNOWN_REASONS, 'unknownReason');
  if (value === null && unknownReason === null) reader.fail('unknownReason', 'required-when-value-unknown');
  if (value !== null && unknownReason !== null) reader.fail('unknownReason', 'only-when-value-unknown');

  const fractionKind = kind === 'average' || kind === 'ratio' || kind === 'rate' || kind === 'percentage';
  if (unknownReason === 'no-samples' && sampleCount !== 0) reader.fail('unknownReason', 'inconsistent-with-facts');
  if (unknownReason === 'denominator-zero' && (!fractionKind || denominator !== 0)) reader.fail('unknownReason', 'inconsistent-with-facts');
  if (unknownReason === 'incomplete-coverage' && (covered === null || total === null || covered >= total)) {
    reader.fail('unknownReason', 'inconsistent-with-facts');
  }
  if (!fractionKind && (numerator !== null || denominator !== null)) reader.fail('numerator', 'not-allowed-for-kind');
  if (fractionKind) {
    if ((numerator === null) !== (denominator === null)) reader.fail('numerator', 'fraction-pair-required');
    if (numerator !== null && (numerator < 0 || !Number.isSafeInteger(numerator))) {
      reader.fail('numerator', 'invalid-count');
    }
    if (denominator !== null && (denominator < 0 || !Number.isSafeInteger(denominator))) reader.fail('denominator', 'invalid-count');
    if (value !== null && numerator === null) reader.fail('numerator', 'required-when-value-known');
    if (value !== null && (denominator === null || denominator === 0)) reader.fail('denominator', 'positive-required-when-value-known');
    if ((kind === 'rate' || kind === 'percentage') && numerator !== null && denominator !== null && numerator > denominator) {
      reader.fail('numerator', 'exceeds-denominator');
    }
    if (value !== null && numerator !== null && denominator !== null && denominator > 0) {
      const expected = numerator / denominator * (kind === 'percentage' ? 100 : 1);
      if (!sameNumber(value, expected)) reader.fail('value', 'inconsistent-with-fraction');
    }
    if (denominator === 0 && value === null) {
      const allowed = sampleCount === 0 ? ['no-samples', 'denominator-zero'] : ['denominator-zero'];
      if (!unknownReason || !allowed.includes(unknownReason)) reader.fail('unknownReason', 'denominator-zero-required');
    }
  }
  if (kind === 'count' && value !== null && !Number.isSafeInteger(value)) reader.fail('value', 'invalid-count');
  if (kind === 'rate' && value !== null && (value < 0 || value > 1)) reader.fail('value', 'out-of-range');
  if (kind === 'percentage' && value !== null && (value < 0 || value > 100)) reader.fail('value', 'out-of-range');
  if (value !== null && sampleCount === 0) reader.fail('sampleCount', 'positive-required-when-value-known');

  const references: EvidenceReferenceV1[] = [];
  if (!Array.isArray(raw.sourceReferences)) reader.fail('sourceReferences', 'invalid-array');
  else if (raw.sourceReferences.length > MAX_SOURCE_REFERENCES) reader.fail('sourceReferences', 'too-many');
  else {
    for (const [index, reference] of raw.sourceReferences.entries()) {
      try {
        const normalized = normalizeEvidenceReference(reference);
        if (workspaceId && normalized.scope.workspaceId !== workspaceId) reader.fail(`sourceReferences[${index}].scope.workspaceId`, 'cross-workspace');
        references.push(normalized);
      } catch (error) {
        const issues = error && typeof error === 'object' && 'issues' in error
          ? (error as { issues?: Array<{ path: string; code: string }> }).issues || [] : [];
        if (issues.length) for (const issue of issues) reader.fail(`sourceReferences[${index}]${issue.path ? `.${issue.path}` : ''}`, issue.code);
        else reader.fail(`sourceReferences[${index}]`, 'invalid-reference');
      }
    }
  }
  const uniqueReferences = [...new Map(references.map(reference => [evidenceReferenceKey(reference), reference])).entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en')).map(([, reference]) => reference);
  const provenance = provenanceFor(uniqueReferences);
  if (raw.provenance !== provenance) reader.fail('provenance', 'inconsistent-with-source-states');
  if (options.requireAcceptedSources && provenance !== 'accepted-only') reader.fail('sourceReferences', 'accepted-sources-required');
  if (confidenceLevel && confidenceLevel !== 'unknown' && uniqueReferences.length) {
    const weakestSource = uniqueReferences.reduce((weakest, reference) => {
      const level = reference.confidence || 'unknown';
      return CONFIDENCE_RANK[level] < CONFIDENCE_RANK[weakest] ? level : weakest;
    }, 'confirmed' as DerivedMetricConfidenceLevel);
    if (CONFIDENCE_RANK[confidenceLevel] > CONFIDENCE_RANK[weakestSource]) reader.fail('confidence.level', 'exceeds-source-confidence');
  }

  const calculationVersion = typeof raw.calculationVersion === 'string' && VERSION_LABEL.test(raw.calculationVersion)
    ? raw.calculationVersion : reader.fail('calculationVersion', 'invalid-version-label');

  if (reader.issues.length || !workspaceId || !kind || sampleCount === null || covered === null || total === null || !confidenceLevel || !calculationVersion) {
    return { ok: false, issues: reader.issues };
  }
  return { ok: true, value: {
    schema: DERIVED_METRIC_SCHEMA,
    scope: { workspaceId },
    kind,
    value,
    numerator,
    denominator,
    sampleCount,
    coverage: { covered, total },
    confidence: { level: confidenceLevel, score: confidenceScore },
    unknownReason,
    provenance,
    sourceReferences: uniqueReferences,
    calculationVersion,
  } };
}

export function normalizeDerivedMetric(raw: unknown, options: DerivedMetricValidationOptions = {}): DerivedMetricV1 {
  const result = validateDerivedMetric(raw, options);
  if (result.ok === false) throw new DerivedMetricError('invalid-envelope', result.issues);
  return result.value;
}

export function serializeDerivedMetric(metric: DerivedMetricV1): string {
  return canonical(normalizeDerivedMetric(metric));
}

export function parseDerivedMetric(text: string, options: DerivedMetricValidationOptions = {}): DerivedMetricV1 {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new DerivedMetricError('invalid-json'); }
  return normalizeDerivedMetric(raw, options);
}

export function derivedMetricKey(metric: DerivedMetricV1): string {
  return crypto.createHash('sha256').update(serializeDerivedMetric(metric)).digest('hex');
}

export function requireAcceptedMetricSources(metric: DerivedMetricV1): DerivedMetricV1 {
  return normalizeDerivedMetric(metric, { requireAcceptedSources: true });
}

export type DerivedMetricResolution =
  | { ok: true; metric: DerivedMetricV1; sources: Array<Extract<EvidenceResolution, { ok: true }>> }
  | { ok: false; reason: 'invalid-envelope' | 'source-resolution-failed'; issues?: DerivedMetricIssue[]; sourceIndex?: number; sourceReason?: string };

/**
 * Publication boundary for accepted team analytics. In addition to contract
 * validation, every reference is resolved against the authenticated caller's
 * current store and must still be accepted there.
 */
export function resolveDerivedMetricSources(
  db: any,
  raw: unknown,
  caller: { workspaceId: string },
): DerivedMetricResolution {
  const validated = validateDerivedMetric(raw, { requireAcceptedSources: true });
  if (validated.ok === false) return { ok: false, reason: 'invalid-envelope', issues: validated.issues };
  const sources: Array<Extract<EvidenceResolution, { ok: true }>> = [];
  for (const [sourceIndex, reference] of validated.value.sourceReferences.entries()) {
    const resolution = resolveEvidenceReference(db, reference, caller);
    if (resolution.ok === false) {
      return {
        ok: false,
        reason: 'source-resolution-failed',
        sourceIndex,
        sourceReason: resolution.reason,
      };
    }
    if (resolution.storedState !== 'accepted') return { ok: false, reason: 'source-resolution-failed', sourceIndex, sourceReason: 'state-mismatch' };
    sources.push(resolution);
  }
  return { ok: true, metric: validated.value, sources };
}

export interface DerivedMetricAdapterOptions {
  workspaceId: string;
  calculationVersion: string;
  sourceReferences?: readonly EvidenceReferenceV1[];
  coverage?: { covered: number; total: number };
  confidence?: { level: DerivedMetricConfidenceLevel; score: number | null };
  unknownReason?: DerivedMetricUnknownReason;
  requireAcceptedSources?: boolean;
}

function envelope(
  input: Pick<DerivedMetricV1, 'kind' | 'value' | 'numerator' | 'denominator' | 'sampleCount'>,
  options: DerivedMetricAdapterOptions,
): DerivedMetricV1 {
  const sourceReferences = [...(options.sourceReferences || [])];
  const raw = {
    schema: DERIVED_METRIC_SCHEMA,
    scope: { workspaceId: options.workspaceId },
    ...input,
    coverage: options.coverage || { covered: input.sampleCount, total: input.sampleCount },
    confidence: options.confidence || { level: 'unknown' as const, score: null },
    unknownReason: input.value === null ? (options.unknownReason || (input.sampleCount === 0 ? 'no-samples' : 'missing-evidence')) : null,
    provenance: provenanceFor(sourceReferences),
    sourceReferences,
    calculationVersion: options.calculationVersion,
  };
  return normalizeDerivedMetric(raw, { requireAcceptedSources: options.requireAcceptedSources });
}

/** Compatibility adapter for existing `{ total, samples }` count outputs. */
export function derivedMetricFromCount(
  metric: { total: number | null; samples: number },
  options: DerivedMetricAdapterOptions,
): DerivedMetricV1 {
  return envelope({ kind: 'count', value: metric.total, numerator: null, denominator: null, sampleCount: metric.samples }, options);
}

/** Compatibility adapter for current `{ won, total }` conversion outputs. */
export function derivedMetricFromPercentage(
  metric: { won: number; total: number },
  options: DerivedMetricAdapterOptions,
): DerivedMetricV1 {
  return envelope({
    kind: 'percentage',
    value: metric.total > 0 ? metric.won / metric.total * 100 : null,
    numerator: metric.won,
    denominator: metric.total,
    sampleCount: metric.total,
  }, { ...options, unknownReason: metric.total === 0 ? 'no-samples' : options.unknownReason });
}

/** Compatibility adapter for current `{ value, numerator, denominator, samples }` ratio outputs. */
export function derivedMetricFromRatio(
  metric: { value: number | null; numerator: number | null; denominator: number | null; samples: number },
  options: DerivedMetricAdapterOptions,
): DerivedMetricV1 {
  const zeroDenominator = metric.denominator === 0;
  return envelope({ kind: 'ratio', value: metric.value, numerator: metric.numerator, denominator: metric.denominator, sampleCount: metric.samples }, {
    ...options,
    unknownReason: metric.value === null && zeroDenominator ? 'denominator-zero' : options.unknownReason,
  });
}

/** Compatibility adapter for current `{ value, samples }` scalar/average outputs. */
export function derivedMetricFromValue(
  metric: { value: number | null; samples: number },
  options: DerivedMetricAdapterOptions,
): DerivedMetricV1 {
  return envelope({ kind: 'scalar', value: metric.value, numerator: null, denominator: null, sampleCount: metric.samples }, options);
}
