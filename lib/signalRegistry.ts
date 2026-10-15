/**
 * S0.3 — Stable coaching-signal registry.
 *
 * Definitions are code-backed and immutable. This module validates S0.2
 * envelopes but does not persist or generate S2 review signals.
 */
import crypto from 'crypto';
import {
  normalizeDerivedMetric,
  type DerivedMetricKind,
  type DerivedMetricV1,
} from './derivedMetric';
import { evidenceReferenceKey } from './evidenceReference';

export const SIGNAL_REGISTRY_SCHEMA = 'moetracker.signal-registry/v1' as const;
export const SIGNAL_REGISTRY_VERSION = 1 as const;

export const SIGNAL_IDS = Object.freeze([
  'economy.pistol-conversion',
  'economy.anti-eco-loss',
  'economy.full-buy-loss',
  'economy.low-buy-win',
  'opening.first-death-recovery',
  'opening.conversion',
  'round.advantage-collapse',
  'combat.multikill',
  'composition.result',
  'evidence.incomplete',
] as const);

export type SignalId = typeof SIGNAL_IDS[number];
export type SignalUnit = 'percent-of-eligible-rounds' | 'occurrences' | 'evidence-gaps';
export type SignalDirection = 'higher-is-better' | 'lower-is-better' | 'informational';

export interface SignalDefinition {
  readonly schema: typeof SIGNAL_REGISTRY_SCHEMA;
  readonly id: SignalId;
  readonly label: string;
  readonly description: string;
  readonly metric: {
    readonly kind: DerivedMetricKind;
    readonly unit: SignalUnit;
    readonly direction: SignalDirection;
    readonly numerator: string | null;
    readonly denominator: string | null;
    readonly sampleUnit: string;
  };
  readonly evidence: {
    readonly requiredFacts: readonly string[];
    readonly knownValueRequiresCompleteCoverage: true;
    readonly acceptedSourcesRequired: boolean;
    readonly partial: 'unknown-incomplete-coverage';
    readonly contradictory: 'unknown-contradictory-evidence';
    readonly empty: 'unknown-no-samples';
  };
}

type DefinitionInput = Omit<SignalDefinition, 'schema' | 'evidence'> & {
  evidence: Pick<SignalDefinition['evidence'], 'requiredFacts' | 'acceptedSourcesRequired'>;
};

const percent = (
  id: SignalId,
  label: string,
  description: string,
  direction: SignalDirection,
  numerator: string,
  denominator: string,
  requiredFacts: readonly string[],
): DefinitionInput => ({
  id, label, description,
  metric: { kind: 'percentage', unit: 'percent-of-eligible-rounds', direction, numerator, denominator, sampleUnit: 'eligible-round' },
  evidence: { requiredFacts, acceptedSourcesRequired: true },
});

const INPUTS: readonly DefinitionInput[] = [
  percent(
    'economy.pistol-conversion', 'Pistol conversion',
    'Share of won pistol rounds whose immediate follow-up round was also won.',
    'higher-is-better', 'won follow-up rounds', 'won pistol rounds with a known immediate follow-up result',
    ['round order', 'pistol-round classification', 'pistol result', 'immediate follow-up result'],
  ),
  percent(
    'economy.anti-eco-loss', 'Anti-eco loss',
    'Share of rounds lost while the team had a proven full-buy advantage over an opponent eco or low buy.',
    'lower-is-better', 'eligible anti-eco rounds lost', 'eligible rounds where our team is proven full buy, the opponent is proven eco or low buy, and the result is known',
    ['our team full-buy classification', 'opponent eco or low-buy classification', 'round result'],
  ),
  percent(
    'economy.full-buy-loss', 'Full-buy loss',
    'Share of the team’s proven full-buy rounds that were lost.',
    'lower-is-better', 'full-buy rounds lost', 'team full-buy rounds with a known result',
    ['team economy classification', 'round result'],
  ),
  percent(
    'economy.low-buy-win', 'Low-buy win',
    'Share of the team’s proven eco or low-buy rounds that were won.',
    'higher-is-better', 'eco or low-buy rounds won', 'team eco or low-buy rounds with a known result',
    ['team economy classification', 'round result'],
  ),
  percent(
    'opening.first-death-recovery', 'First-death recovery',
    'Share of rounds won after the team suffered the first death.',
    'higher-is-better', 'rounds won after first death', 'rounds with a proven team first death and known result',
    ['ordered elimination events or confirmed opening event', 'first-death team', 'round result'],
  ),
  percent(
    'opening.conversion', 'Opening conversion',
    'Share of rounds won after the team secured the first kill.',
    'higher-is-better', 'rounds won after first kill', 'rounds with a proven team first kill and known result',
    ['ordered elimination events or confirmed opening event', 'first-kill team', 'round result'],
  ),
  percent(
    'round.advantage-collapse', 'Advantage collapse',
    'Share of eligible rounds lost after the team held a proven multi-player advantage.',
    'lower-is-better', 'eligible rounds lost after our team held the configured multi-player advantage', 'eligible rounds where complete ordered life-state evidence proves our team held the configured multi-player advantage and the result is known',
    ['complete ordered elimination events', 'team membership', 'configured multi-player advantage held by our team', 'round result'],
  ),
  {
    id: 'combat.multikill', label: 'Multikill',
    description: 'Count of proven player round performances with at least two kills; kill-count bands remain dimensions of this one signal.',
    metric: { kind: 'count', unit: 'occurrences', direction: 'higher-is-better', numerator: null, denominator: null, sampleUnit: 'player-round multikill' },
    evidence: { requiredFacts: ['complete player-attributed eliminations for each covered round', 'kill-count band (2, 3, 4, or 5+)'], acceptedSourcesRequired: true },
  },
  percent(
    'composition.result', 'Composition result',
    'Share of decisive matches won by one observed five-player agent composition; tied or missing scores are unknown.',
    'higher-is-better', 'matches won', 'decisive matches with the complete observed composition and result known',
    ['five observed agents', 'map', 'complete non-tied match score'],
  ),
  {
    id: 'evidence.incomplete', label: 'Incomplete evidence',
    description: 'Count of explicit evidence gaps in a fully inspected scope; this is an informational quality signal, not a performance failure.',
    metric: { kind: 'count', unit: 'evidence-gaps', direction: 'informational', numerator: null, denominator: null, sampleUnit: 'explicit evidence gap' },
    evidence: { requiredFacts: ['inspection scope', 'expected facts', 'missing, partial, contradictory, or unsupported status'], acceptedSourcesRequired: false },
  },
];

function freezeDefinition(input: DefinitionInput): SignalDefinition {
  return Object.freeze({
    schema: SIGNAL_REGISTRY_SCHEMA,
    ...input,
    metric: Object.freeze({ ...input.metric }),
    evidence: Object.freeze({
      requiredFacts: Object.freeze([...input.evidence.requiredFacts]),
      knownValueRequiresCompleteCoverage: true as const,
      acceptedSourcesRequired: input.evidence.acceptedSourcesRequired,
      partial: 'unknown-incomplete-coverage' as const,
      contradictory: 'unknown-contradictory-evidence' as const,
      empty: 'unknown-no-samples' as const,
    }),
  });
}

const DEFINITIONS = Object.freeze(INPUTS.map(freezeDefinition));
const BY_ID = new Map<SignalId, SignalDefinition>(DEFINITIONS.map(definition => [definition.id, definition]));
if (BY_ID.size !== SIGNAL_IDS.length || DEFINITIONS.some((definition, index) => definition.id !== SIGNAL_IDS[index])) {
  throw new Error('Signal registry definitions must contain each canonical signal ID exactly once and in canonical order.');
}

export class SignalRegistryError extends Error {
  constructor(readonly code: string) {
    super(`Signal registry rejected ${code}.`);
  }
}

/** Returns the frozen canonical order. Callers cannot register aliases at runtime. */
export function listSignalDefinitions(): readonly SignalDefinition[] {
  return DEFINITIONS;
}

/** Exact lookup only: no trimming, case folding, aliases, or fallback. */
export function getSignalDefinition(id: string): SignalDefinition {
  const definition = BY_ID.get(id as SignalId);
  if (!definition) throw new SignalRegistryError('unknown-signal-id');
  return definition;
}

/**
 * Validate that an S0.2 envelope has the registered value kind, provenance and
 * coverage semantics. Partial evidence can never manufacture an observed zero.
 */
export function normalizeSignalMetric(id: string, raw: unknown): DerivedMetricV1 {
  const definition = getSignalDefinition(id);
  const metric = normalizeDerivedMetric(raw, { requireAcceptedSources: definition.evidence.acceptedSourcesRequired });
  if (metric.kind !== definition.metric.kind) throw new SignalRegistryError('incompatible-metric-kind');
  if (metric.value !== null && metric.coverage.covered !== metric.coverage.total) {
    throw new SignalRegistryError('known-value-requires-complete-coverage');
  }
  if (metric.value === null && metric.coverage.covered < metric.coverage.total && metric.unknownReason !== 'incomplete-coverage') {
    throw new SignalRegistryError('partial-coverage-requires-incomplete-reason');
  }
  return metric;
}

const CONTEXT_KEY = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,239}$/;
const canonical = (value: Record<string, unknown>) => JSON.stringify(Object.fromEntries(
  Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'en')),
));

/**
 * Stable identity for one logical signal scope. It deliberately excludes the
 * calculated value and calculation version, so recomputation replaces rather
 * than duplicates the same signal. `contextKey` distinguishes cohorts/sides.
 */
export function signalRecomputationKey(input: {
  signalId: string;
  metric: unknown;
  contextKey: string;
}): string {
  const definition = getSignalDefinition(input.signalId);
  const metric = normalizeSignalMetric(definition.id, input.metric);
  if (typeof input.contextKey !== 'string' || !CONTEXT_KEY.test(input.contextKey)) {
    throw new SignalRegistryError('invalid-context-key');
  }
  const sources = [...new Set(metric.sourceReferences.map(evidenceReferenceKey))].sort((a, b) => a.localeCompare(b, 'en'));
  return crypto.createHash('sha256').update(canonical({
    registrySchema: SIGNAL_REGISTRY_SCHEMA,
    signalId: definition.id,
    workspaceId: metric.scope.workspaceId,
    contextKey: input.contextKey,
    sources,
  })).digest('hex');
}
