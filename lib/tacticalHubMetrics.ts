import type { Match, PlayerStats, Round } from '../src/types';
import { addPlayerEvidence, emptyPlayerEvidence, matchOutcome, untradedRate, type PlayerEvidenceAccumulator } from './analyticsEvidence';
import { knownTotal, publishRate, type MetricPublication } from './metricTrust';

/** One player's period totals. A count is null unless every row in the period carries it. */
export interface PeriodMetrics extends PlayerEvidenceAccumulator {
  rows: number; kills: number | null; deaths: number | null; clutchesWon: number | null; clutchesAttempted: number | null;
  /** Round-log counts: null when the period has no round evidence at all. */
  throws: number | null; firstDeaths: number | null;
}

export const emptyPeriodMetrics = (): PeriodMetrics => ({ rows: 0, kills: null, deaths: null, clutchesWon: null, clutchesAttempted: null, throws: null, firstDeaths: null, ...emptyPlayerEvidence() });

export function buildPeriodMetrics(rows: readonly PlayerStats[], rounds: readonly Round[], matchIds: ReadonlySet<string>, keys: Iterable<string>, rowKey: (row: PlayerStats) => string, nameKey: (name: string) => string): Record<string, PeriodMetrics> {
  const grouped = new Map<string, PlayerStats[]>([...keys].map(key => [key, []]));
  for (const row of rows) { if (!matchIds.has(row.matchId)) continue; grouped.get(rowKey(row))?.push(row); }
  const metrics: Record<string, PeriodMetrics> = {};
  for (const [key, playerRows] of grouped) {
    const item = emptyPeriodMetrics(); item.rows = playerRows.length;
    item.kills = knownTotal(playerRows, row => row.kills); item.deaths = knownTotal(playerRows, row => row.deaths);
    item.clutchesWon = knownTotal(playerRows, row => row.cl); item.clutchesAttempted = knownTotal(playerRows, row => row.clAtt);
    for (const row of playerRows) addPlayerEvidence(item, row);
    metrics[key] = item;
  }
  const periodRounds = rounds.filter(round => matchIds.has(round.matchId));
  if (periodRounds.length) for (const item of Object.values(metrics)) { item.throws = 0; item.firstDeaths = 0; }
  for (const round of periodRounds) {
    if ((round.isThrow === 'TRUE' || round.isThrow === 'true') && round.thrownBy) { const item = metrics[nameKey(round.thrownBy)]; if (item) item.throws! += 1; }
    if (round.firstDeathBy) { const item = metrics[nameKey(round.firstDeathBy)]; if (item) item.firstDeaths! += 1; }
  }
  return metrics;
}

export const clutchPublication = (metrics: PeriodMetrics, minimumSamples: number): MetricPublication => publishRate({
  numerator: metrics.clutchesWon, denominator: metrics.clutchesAttempted,
  observed: metrics.clutchesWon !== null && metrics.clutchesAttempted !== null ? metrics.rows : 0, expected: metrics.rows, minimumSamples,
});

const rounded = (publication: MetricPublication) => publication.value === null ? null : Math.round(publication.value);

/** Untraded-death rate behind the configured sample gate. */
export function gatedUntradedRate(metrics: PeriodMetrics, minimumSamples: number) {
  return metrics.tradeKnownDeaths >= minimumSamples ? untradedRate(metrics) : null;
}

export interface KpiRecommendation { focus: string; text: string; severity: 'high' | 'medium' | 'low' | 'unavailable' }

/** Coaching focus from published evidence only; an unknown or undersampled rate never reads as 0% or as "stable". */
export function kpiRecommendation(player: string, curr: PeriodMetrics, prev: PeriodMetrics, minimumSamples: number): KpiRecommendation {
  const currUntraded = gatedUntradedRate(curr, minimumSamples); const prevUntraded = gatedUntradedRate(prev, minimumSamples);
  const currClutch = rounded(clutchPublication(curr, minimumSamples)); const prevClutch = rounded(clutchPublication(prev, minimumSamples));
  const untradedDiff = currUntraded !== null && prevUntraded !== null ? currUntraded - prevUntraded : null;
  if (curr.throws !== null && curr.throws > 1 && currUntraded !== null && currUntraded > 35) return { focus: '⚠️ Tactical Discipline & Spacing', text: `${player} is currently showing spacing vulnerabilities with an un-traded death rate of ${currUntraded}% and ${curr.throws} critical round throws this period. Focus heavily on discipline drills, avoidance of solo entries without flashing utility, and locking down cross-fires rather than chasing dry kills.`, severity: 'high' };
  if (currClutch !== null && currClutch < 40) return { focus: '🔥 Clutch Efficiency & Calm Play', text: `${player} is struggling to convert active clutch rounds, winning only ${currClutch}% (${curr.clutchesWon}/${curr.clutchesAttempted}) of clutches this period${prevClutch === null ? '' : ` (${prevClutch}% last period)`}. Work on slow-retake simulated scenarios, timing defuse half-ticks, and isolated 1v1 fights under high pressure.`, severity: 'medium' };
  if (untradedDiff !== null && untradedDiff > 5) return { focus: '🛡️ Team Spacing & Trade Spacing', text: `${player}'s un-traded death rate rose by ${untradedDiff}% this period. This indicates they are getting isolated on flanks or during site pushes without team follow-up. Prioritize close spacing during executions and holding passive default angles.`, severity: 'medium' };
  if (curr.firstDeaths !== null && curr.firstDeaths > 4 && curr.kills !== null && curr.deaths !== null && curr.deaths > 0 && curr.kills / curr.deaths < 1.0) return { focus: '🎯 Entry Pathing & Angles Selection', text: `${player} is logging high first deaths (${curr.firstDeaths}) relative to active fragging power. Refine initial site-entry pathing, coordinate with Initiator scouting flashes, and practice pre-aiming common defensive standard holds.`, severity: 'medium' };
  if (currClutch === null || currUntraded === null) return { focus: 'Not enough evidence', text: `${player} does not yet have ${minimumSamples} complete samples for clutch and trade evidence this period, so no coaching focus is published.`, severity: 'unavailable' };
  return { focus: '🟢 Tactical Mastery & Mechanical Synergy', text: `${player} has displayed solid tactical compliance and stable metrics this period. Their clutch efficiency (${currClutch}%) and spacing remain strong. Maintain active calling and continue perfecting agent-specific utility sets in custom drills.`, severity: 'low' };
}

export type ProficiencyGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export interface AgentProficiency { grade: ProficiencyGrade | null; rating: number | null; count: number; winRate: number | null }

const gradeFor = (rating: number): ProficiencyGrade => rating >= 1.25 ? 'S' : rating >= 1.08 ? 'A' : rating >= 0.9 ? 'B' : rating >= 0.75 ? 'C' : 'D';
const rowRating = (row: PlayerStats): number | null => {
  const stored = typeof row.rating === 'string' ? Number.parseFloat(row.rating) : row.rating;
  if (typeof stored === 'number' && Number.isFinite(stored)) return stored;
  return typeof row.kills === 'number' && typeof row.deaths === 'number' && row.deaths > 0 ? row.kills / row.deaths : null;
};

/** Agent proficiency from rows that carry a rating or K/D; no observed rows means no grade, not a neutral B. */
export function agentProficiency(rows: readonly PlayerStats[], matches: ReadonlyMap<string, Match>, minimumSamples: number): AgentProficiency {
  const ratings = rows.map(rowRating);
  const rating = rows.length && ratings.every((value): value is number => value !== null) ? (ratings as number[]).reduce((sum, value) => sum + value, 0) / rows.length : null;
  const outcomes = rows.map(row => { const match = matches.get(row.matchId); return match ? matchOutcome(match) : null; }).filter(outcome => outcome === 'win' || outcome === 'loss');
  const winRate = rounded(publishRate({ numerator: outcomes.filter(outcome => outcome === 'win').length, denominator: outcomes.length, observed: outcomes.length, expected: outcomes.length, minimumSamples }));
  return { grade: rating === null ? null : gradeFor(rating), rating: rating === null ? null : Math.round(rating * 100) / 100, count: rows.length, winRate };
}
