import { metricSampleGate } from './metricTrust';

export interface MapScoreInput { value: number; weight: number; known: boolean; samples: number; label: string }
export interface MapScoreContribution { key: string; label: string; observedValue: number | null; effectiveValue: number | null; weight: number; weightedPoints: number; samples: number; status: 'observed' | 'unknown' | 'insufficient-sample'; unknownReason: string | null }
export interface MapScoreLedger { calculationVersion: 'best-map-ledger/v2'; score: number | null; totalWeight: number; observedWeight: number; coveragePercent: number; confidence: 'high' | 'medium' | 'low' | 'unavailable'; minimumSamples: number; experimental: true; contributions: MapScoreContribution[] }

export function buildMapScoreLedger(inputs: Record<string, MapScoreInput>, minimumSamples = 15): MapScoreLedger {
  const contributions = Object.entries(inputs).map(([key, input]) => {
    const gate = metricSampleGate(input.samples, minimumSamples); const observedValue = input.known ? Math.max(0, Math.min(1, input.value)) : null;
    const status = !input.known ? 'unknown' as const : gate.publishable ? 'observed' as const : 'insufficient-sample' as const;
    const effectiveValue = status === 'observed' ? observedValue : null;
    return { key, label: input.label, observedValue, effectiveValue, weight: input.weight, weightedPoints: effectiveValue === null ? 0 : effectiveValue * input.weight, samples: input.samples, status, unknownReason: status === 'unknown' ? 'missing-evidence' : status === 'insufficient-sample' ? `minimum-${gate.minimumSamples}-samples-required` : null };
  });
  const totalWeight = contributions.reduce((sum, row) => sum + row.weight, 0); const observedWeight = contributions.filter(row => row.status === 'observed').reduce((sum, row) => sum + row.weight, 0); const coveragePercent = totalWeight ? Math.round(observedWeight / totalWeight * 100) : 0;
  const score = observedWeight ? Math.round(contributions.reduce((sum, row) => sum + row.weightedPoints, 0) / observedWeight * 1000) / 10 : null;
  const contributingSamples = contributions.filter(row => row.status === 'observed').reduce((sum, row) => sum + row.samples, 0); const gate = metricSampleGate(contributingSamples, minimumSamples);
  const confidence = score === null ? 'unavailable' as const : coveragePercent >= 85 && gate.confidence === 'high' ? 'high' as const : coveragePercent >= 60 ? 'medium' as const : 'low' as const;
  return { calculationVersion: 'best-map-ledger/v2', score, totalWeight, observedWeight, coveragePercent, confidence, minimumSamples: Math.max(1, Math.floor(minimumSamples)), experimental: true, contributions };
}
