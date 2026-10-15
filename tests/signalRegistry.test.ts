import { describe, expect, it } from 'vitest';
import {
  derivedMetricFromCount,
  derivedMetricFromPercentage,
  type DerivedMetricAdapterOptions,
  type DerivedMetricV1,
} from '../lib/derivedMetric';
import { EVIDENCE_REFERENCE_SCHEMA, type EvidenceReferenceV1 } from '../lib/evidenceReference';
import {
  SIGNAL_IDS,
  SIGNAL_REGISTRY_SCHEMA,
  getSignalDefinition,
  listSignalDefinitions,
  normalizeSignalMetric,
  signalRecomputationKey,
} from '../lib/signalRegistry';

const WS = 'ws_signalRegistry000001';

function reference(matchId: string, state: EvidenceReferenceV1['state'] = 'accepted'): EvidenceReferenceV1 {
  return {
    schema: EVIDENCE_REFERENCE_SCHEMA,
    scope: { workspaceId: WS, ownerDeviceId: null },
    state, sourceTypes: ['manual'], matchId, round: null,
    captureSessionId: null, screenshot: null, replay: null, vod: null,
    producer: { parser: null, ocr: null, capture: null },
    capturedAt: '2026-10-15T06:00:00.000Z', acceptedAt: state === 'accepted' ? '2026-10-15T06:30:00.000Z' : null,
    observedIdentities: [], confidence: 'high', fieldProvenance: null,
  };
}

const sources = [reference('match-signal-one')];
const options = (coverage: { covered: number; total: number }, unknownReason?: DerivedMetricAdapterOptions['unknownReason']): DerivedMetricAdapterOptions => ({
  workspaceId: WS,
  calculationVersion: 'signal-fixture/v1',
  sourceReferences: sources,
  coverage,
  confidence: { level: 'high', score: 0.9 },
  unknownReason,
});

function fixture(signalId: string, state: 'complete' | 'partial' | 'contradictory' | 'empty'): DerivedMetricV1 {
  const definition = getSignalDefinition(signalId);
  if (definition.metric.kind === 'percentage') {
    if (state === 'complete') return derivedMetricFromPercentage({ won: 0, total: 2 }, options({ covered: 2, total: 2 }));
    if (state === 'partial') {
      const metric = derivedMetricFromCount({ total: null, samples: 0 }, options({ covered: 0, total: 2 }, 'incomplete-coverage'));
      return { ...metric, kind: 'percentage' };
    }
    if (state === 'contradictory') {
      const metric = derivedMetricFromCount({ total: null, samples: 2 }, options({ covered: 2, total: 2 }, 'contradictory-evidence'));
      return { ...metric, kind: 'percentage' };
    }
    return derivedMetricFromPercentage({ won: 0, total: 0 }, options({ covered: 0, total: 0 }));
  }
  if (state === 'complete') return derivedMetricFromCount({ total: 0, samples: 2 }, options({ covered: 2, total: 2 }));
  if (state === 'partial') return derivedMetricFromCount({ total: null, samples: 0 }, options({ covered: 0, total: 2 }, 'incomplete-coverage'));
  if (state === 'contradictory') return derivedMetricFromCount({ total: null, samples: 2 }, options({ covered: 2, total: 2 }, 'contradictory-evidence'));
  return derivedMetricFromCount({ total: null, samples: 0 }, options({ covered: 0, total: 0 }));
}

describe('S0.3 coaching signal registry', () => {
  it('enumerates exactly ten frozen definitions in canonical order', () => {
    const definitions = listSignalDefinitions();
    expect(definitions.map(definition => definition.id)).toEqual(SIGNAL_IDS);
    expect(new Set(definitions.map(definition => definition.id)).size).toBe(10);
    expect(definitions.every(definition => definition.schema === SIGNAL_REGISTRY_SCHEMA)).toBe(true);
    expect(definitions.every(definition => Object.isFrozen(definition)
      && Object.isFrozen(definition.metric)
      && Object.isFrozen(definition.evidence)
      && Object.isFrozen(definition.evidence.requiredFacts))).toBe(true);
  });

  it('rejects unknown IDs, aliases, whitespace and case changes', () => {
    for (const id of ['pistol-conversion', 'ECONOMY.PISTOL-CONVERSION', ' economy.pistol-conversion', 'economy.pistol-conversion ']) {
      expect(() => getSignalDefinition(id)).toThrow(/unknown-signal-id/);
    }
  });

  it.each(SIGNAL_IDS)('%s preserves complete observed zero and unknown partial/contradictory/empty evidence', signalId => {
    const complete = normalizeSignalMetric(signalId, fixture(signalId, 'complete'));
    const partial = fixture(signalId, 'partial');
    const contradictory = fixture(signalId, 'contradictory');
    const empty = fixture(signalId, 'empty');

    expect(complete).toMatchObject({ value: 0, unknownReason: null, coverage: { covered: 2, total: 2 } });
    expect(normalizeSignalMetric(signalId, partial)).toMatchObject({ value: null, unknownReason: 'incomplete-coverage' });
    expect(normalizeSignalMetric(signalId, contradictory)).toMatchObject({ value: null, unknownReason: 'contradictory-evidence' });
    expect(normalizeSignalMetric(signalId, empty)).toMatchObject({ value: null, unknownReason: 'no-samples' });
  });

  it('never accepts a known zero from partial evidence', () => {
    const partialZero = derivedMetricFromPercentage({ won: 0, total: 1 }, options({ covered: 1, total: 2 }));
    expect(() => normalizeSignalMetric('opening.conversion', partialZero)).toThrow(/known-value-requires-complete-coverage/);
  });

  it('rejects an S0.2 envelope with the wrong registered metric kind', () => {
    const count = derivedMetricFromCount({ total: 1, samples: 1 }, options({ covered: 1, total: 1 }));
    expect(() => normalizeSignalMetric('opening.conversion', count)).toThrow(/incompatible-metric-kind/);
  });

  it('keeps multikill bands as dimensions of one signal and incomplete evidence informational', () => {
    const multikill = getSignalDefinition('combat.multikill');
    expect(multikill.description).toContain('kill-count bands remain dimensions');
    expect(getSignalDefinition('evidence.incomplete').metric.direction).toBe('informational');
  });

  it('defines anti-eco loss eligibility before counting losses', () => {
    const definition = getSignalDefinition('economy.anti-eco-loss');
    expect(definition.metric).toMatchObject({
      numerator: 'eligible anti-eco rounds lost',
      denominator: 'eligible rounds where our team is proven full buy, the opponent is proven eco or low buy, and the result is known',
    });
    expect(definition.evidence.requiredFacts).toEqual([
      'our team full-buy classification',
      'opponent eco or low-buy classification',
      'round result',
    ]);
  });

  it('defines advantage-collapse eligibility before counting lost advantage rounds', () => {
    const definition = getSignalDefinition('round.advantage-collapse');
    expect(definition.metric).toMatchObject({
      numerator: 'eligible rounds lost after our team held the configured multi-player advantage',
      denominator: 'eligible rounds where complete ordered life-state evidence proves our team held the configured multi-player advantage and the result is known',
    });
    expect(definition.evidence.requiredFacts).toEqual([
      'complete ordered elimination events',
      'team membership',
      'configured multi-player advantage held by our team',
      'round result',
    ]);
  });

  it('requires accepted sources for performance signals but allows an evidence-quality draft', () => {
    const performance = { ...fixture('combat.multikill', 'complete'), sourceReferences: [reference('match-draft', 'draft')], provenance: 'includes-unaccepted' };
    expect(() => normalizeSignalMetric('combat.multikill', performance)).toThrow(/accepted-sources-required/);
    expect(normalizeSignalMetric('evidence.incomplete', performance)).toMatchObject({ value: 0, provenance: 'includes-unaccepted' });
  });

  it('creates stable de-duplicating recomputation identities without hashing the changing value', () => {
    const original = fixture('opening.conversion', 'complete');
    const reordered = {
      ...original,
      value: 50, numerator: 1, denominator: 2,
      calculationVersion: 'signal-fixture/v2',
      sourceReferences: [reference('match-signal-one'), reference('match-signal-one')],
    };
    const input = { signalId: 'opening.conversion', contextKey: 'block:block-1/map:ascent', metric: original };
    expect(signalRecomputationKey(input)).toBe(signalRecomputationKey({ ...input, metric: reordered }));
    expect(signalRecomputationKey(input)).not.toBe(signalRecomputationKey({ ...input, contextKey: 'block:block-2/map:ascent' }));
    expect(() => signalRecomputationKey({ ...input, contextKey: ' block:block-1' })).toThrow(/invalid-context-key/);
  });
});
