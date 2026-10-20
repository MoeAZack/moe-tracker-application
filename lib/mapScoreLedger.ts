export interface MapScoreInput { value: number; weight: number; known: boolean; samples: number; label: string }
export interface MapScoreContribution { key: string; label: string; observedValue: number | null; effectiveValue: number; weight: number; weightedPoints: number; samples: number; status: 'observed' | 'neutral-fallback'; unknownReason: string | null }
export interface MapScoreLedger { calculationVersion: 'best-map-ledger/v1'; score: number; totalWeight: number; observedWeight: number; coveragePercent: number; confidence: 'high' | 'medium' | 'low'; contributions: MapScoreContribution[] }

export function buildMapScoreLedger(inputs: Record<string, MapScoreInput>): MapScoreLedger {
  const contributions = Object.entries(inputs).map(([key, input]) => {
    const effectiveValue = input.known ? Math.max(0, Math.min(1, input.value)) : .5;
    return { key, label: input.label, observedValue: input.known ? input.value : null, effectiveValue, weight: input.weight, weightedPoints: effectiveValue * input.weight, samples: input.samples, status: input.known ? 'observed' as const : 'neutral-fallback' as const, unknownReason: input.known ? null : 'missing-evidence-neutral-baseline' };
  });
  const totalWeight = contributions.reduce((sum, row) => sum + row.weight, 0); const observedWeight = contributions.filter(row => row.status === 'observed').reduce((sum, row) => sum + row.weight, 0); const coveragePercent = totalWeight ? Math.round(observedWeight / totalWeight * 100) : 0;
  return { calculationVersion: 'best-map-ledger/v1', score: totalWeight ? Math.round(contributions.reduce((sum, row) => sum + row.weightedPoints, 0) / totalWeight * 1000) / 10 : 50, totalWeight, observedWeight, coveragePercent, confidence: coveragePercent >= 85 && contributions.some(row => row.samples >= 10) ? 'high' : coveragePercent >= 60 ? 'medium' : 'low', contributions };
}
