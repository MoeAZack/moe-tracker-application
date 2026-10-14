export type PercentageTone = 'unknown' | 'critical' | 'poor' | 'neutral' | 'good' | 'perfect';

export function percentageTone(value: number | null | undefined, inverse = false): PercentageTone {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unknown';
  const clamped = Math.max(0, Math.min(100, inverse ? 100 - value : value));
  if (clamped >= 100) return 'perfect';
  if (clamped >= 75) return 'good';
  if (clamped >= 50) return 'neutral';
  if (clamped >= 25) return 'poor';
  return 'critical';
}

export function percentageTextClass(value: number | null | undefined, inverse = false) {
  return {
    unknown: 'text-slate-500', critical: 'text-rose-400', poor: 'text-orange-400',
    neutral: 'text-yellow-300', good: 'text-lime-400', perfect: 'text-emerald-400',
  }[percentageTone(value, inverse)];
}

export function percentageBarClass(value: number | null | undefined, inverse = false) {
  return {
    unknown: 'bg-slate-600', critical: 'bg-rose-500', poor: 'bg-orange-500',
    neutral: 'bg-yellow-400', good: 'bg-lime-500', perfect: 'bg-emerald-500',
  }[percentageTone(value, inverse)];
}

export function percentageSurfaceClass(value: number | null | undefined, inverse = false) {
  return {
    unknown: 'text-slate-500 bg-transparent border-transparent',
    critical: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
    poor: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
    neutral: 'text-yellow-200 bg-yellow-500/10 border-yellow-500/20',
    good: 'text-lime-300 bg-lime-500/10 border-lime-500/20',
    perfect: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  }[percentageTone(value, inverse)];
}
