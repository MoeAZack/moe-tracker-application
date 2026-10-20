import type { PlayerStats } from '../src/types';
import { metricSampleGate } from './metricTrust';

export type PlayerMetricKey = 'kills' | 'deaths' | 'assists' | 'acs' | 'adr' | 'hs' | 'fk' | 'fd' | 'trades' | 'plants' | 'defuses' | 'orbs' | 'ults' | 'kast' | 'multikills';
export interface MetricCoverageRow { key: PlayerMetricKey; label: string; coveredRows: number; totalRows: number; coveragePercent: number; status: 'complete' | 'partial' | 'unavailable'; confidence: 'high' | 'medium' | 'low' | 'unavailable'; sources: string[]; denominator: number | null; minimumSamples: number; publishable: boolean; unknownReason: string | null }

const definitions: Array<{ key: PlayerMetricKey; label: string; covered: (row: PlayerStats) => boolean; denominator?: (row: PlayerStats) => number }> = [
  { key: 'kills', label: 'Kills', covered: row => typeof row.kills === 'number' }, { key: 'deaths', label: 'Deaths', covered: row => typeof row.deaths === 'number' }, { key: 'assists', label: 'Assists', covered: row => typeof row.assists === 'number' },
  { key: 'acs', label: 'ACS', covered: row => typeof row.acs === 'number' }, { key: 'adr', label: 'ADR', covered: row => typeof row.adr === 'number' }, { key: 'hs', label: 'Headshots', covered: row => typeof row.hs === 'number' || (typeof row.headshots === 'number' && typeof row.headshotEligibleKills === 'number') },
  { key: 'fk', label: 'First kills', covered: row => typeof row.fk === 'number' }, { key: 'fd', label: 'First deaths', covered: row => typeof row.fd === 'number' }, { key: 'trades', label: 'Trades', covered: row => typeof row.trades === 'number' || typeof row.screenshotMetrics?.trades === 'number' },
  { key: 'plants', label: 'Plants', covered: row => typeof row.plants === 'number' }, { key: 'defuses', label: 'Defuses', covered: row => typeof row.defuses === 'number' }, { key: 'orbs', label: 'Orbs', covered: row => typeof row.orbPoints === 'number' }, { key: 'ults', label: 'Ultimate uses', covered: row => typeof row.ultimateUses === 'number' },
  { key: 'kast', label: 'KAST', covered: row => typeof row.kastSuccessful === 'number' && typeof row.kastCovered === 'number' && row.kastCovered > 0, denominator: row => Number(row.kastCovered || 0) },
  { key: 'multikills', label: 'Multi-kills', covered: row => !!row.screenshotMetrics && row.screenshotMetrics.coveredRounds > 0, denominator: row => Number(row.screenshotMetrics?.coveredRounds || 0) },
];

const source = (row: PlayerStats) => row.sourceMetadata?.provider || row.sourceMetadata?.method || (row.screenshotMetrics ? 'screenshot' : 'legacy');

export function buildPlayerMetricCoverage(rows: readonly PlayerStats[], minimumSamples = 15): MetricCoverageRow[] {
  return definitions.map(definition => {
    const covered = rows.filter(definition.covered); const coveragePercent = rows.length ? Math.round(covered.length / rows.length * 100) : 0; const denominator = definition.denominator ? covered.reduce((sum, row) => sum + definition.denominator!(row), 0) : null;
    const status = covered.length === 0 ? 'unavailable' as const : covered.length === rows.length ? 'complete' as const : 'partial' as const;
    const gate = metricSampleGate(denominator ?? covered.length, minimumSamples); const publishable = status === 'complete' && gate.publishable;
    return { key: definition.key, label: definition.label, coveredRows: covered.length, totalRows: rows.length, coveragePercent, status, confidence: !covered.length ? 'unavailable' : publishable ? gate.confidence : 'low', sources: [...new Set(covered.map(source))].sort(), denominator, minimumSamples: gate.minimumSamples, publishable, unknownReason: !covered.length ? (rows.length ? 'metric-not-provided-by-accepted-sources' : 'no-player-evidence') : status !== 'complete' ? 'incomplete-coverage' : !gate.publishable ? gate.reason : null };
  });
}
