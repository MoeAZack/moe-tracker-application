import type { TrackerData } from '../src/types';

export const MINIMUM_RATING_MATCHES = 10;
export const MINIMUM_RATING_COHORT = 10;

export interface RatingContextSplit { context: string; matches: number; rating: number | null; killsPerDeath: number | null; kast: number | null }
export interface CalibratedPlayerRating {
  playerId: string; player: string; rating: number | null; rawScore: number | null; reliability: number; matches: number;
  confidence: 'unavailable' | 'low' | 'medium' | 'high'; interval: { low: number | null; high: number | null };
  trend: { previous: number | null; recent: number | null; delta: number | null };
  contexts: { maps: RatingContextSplit[]; agents: RatingContextSplit[]; roles: RatingContextSplit[] };
  components: { combat: number | null; survival: number | null; teamplay: number | null; openings: number | null };
  calibration: { status: 'experimental-team-context' | 'insufficient-evidence'; cohortSize: number; baseline: 'median-mad'; shrinkageTarget: number; minimumReliableMatches: number; minimumCohortSize: number };
  publicationStatus: 'experimental-only' | 'insufficient-evidence'; unknownReasons: string[];
  validationStatus: 'experimental-unvalidated'; method: string; calculationVersion: 'calibrated-player-rating/v4';
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const median = (values: number[]) => { const ordered = [...values].sort((a, b) => a - b); if (!ordered.length) return 0; const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2; };
const spread = (values: number[], center: number) => median(values.map(value => Math.abs(value - center))) * 1.4826 || Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2))) || 1;
const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const totalIfComplete = (rows: readonly any[], field: string) => rows.length && rows.every(row => known(row[field])) ? rows.reduce((sum, row) => sum + Number(row[field]), 0) : null;

function rawComponents(rows: readonly any[]) {
  const kills = totalIfComplete(rows, 'kills'); const deaths = totalIfComplete(rows, 'deaths'); const assists = totalIfComplete(rows, 'assists');
  const fk = totalIfComplete(rows, 'fk'); const fd = totalIfComplete(rows, 'fd');
  const kastCovered = rows.length && rows.every(row => known(row.kastCovered) && known(row.kastSuccessful) && row.kastCovered > 0) ? rows.reduce((sum, row) => sum + row.kastCovered, 0) : null;
  const kastSuccessful = kastCovered === null ? null : rows.reduce((sum, row) => sum + row.kastSuccessful, 0);
  return {
    combat: kills !== null && deaths !== null && deaths > 0 ? kills / deaths : null,
    survival: kastCovered && kastSuccessful !== null ? kastSuccessful / kastCovered : null,
    teamplay: kills !== null && deaths !== null && assists !== null && kills + deaths > 0 ? assists / (kills + deaths) : null,
    openings: fk !== null && fd !== null && fk + fd > 0 ? (fk - fd) / (fk + fd) : null,
  };
}

export function buildCalibratedPlayerRatings(data: Pick<TrackerData, 'playerStats' | 'matches' | 'rosterPlayers'>): CalibratedPlayerRating[] {
  const matchRows = new Map((data.matches || []).filter(match => match.duplicateReview?.status !== 'quarantined').map(match => [match.id, match])); const activeMatches = new Set(matchRows.keys());
  const archived = new Set((data.rosterPlayers || []).filter(player => player.retiredAt).map(player => player.id));
  const groups = new Map<string, typeof data.playerStats>();
  for (const row of data.playerStats || []) {
    if (!activeMatches.has(row.matchId) || (row.playerId && archived.has(row.playerId))) continue;
    const key = row.playerId || `name:${String(row.player || '').toLocaleLowerCase()}`; groups.set(key, [...(groups.get(key) || []), row]);
  }
  const base = [...groups.entries()].map(([id, rows]) => ({ id, rows, player: rows[0].displayNameSnapshot || rows[0].player || id, matches: new Set(rows.map(row => row.matchId)).size, raw: rawComponents(rows) }));
  const keys = ['combat', 'survival', 'teamplay', 'openings'] as const;
  const cohort = Object.fromEntries(keys.map(key => { const values = base.map(row => row.raw[key]).filter((value): value is number => value !== null); const center = median(values); return [key, { values, center, spread: spread(values, center) }]; })) as Record<typeof keys[number], { values: number[]; center: number; spread: number }>;
  const scoreComponent = (key: typeof keys[number], value: number | null) => value === null || cohort[key].values.length < MINIMUM_RATING_COHORT ? null : clamp(50 + Math.max(-3, Math.min(3, (value - cohort[key].center) / cohort[key].spread)) * 12);
  const splitRows = (rows: any[], kind: 'maps' | 'agents' | 'roles'): RatingContextSplit[] => {
    const grouped = new Map<string, any[]>();
    for (const row of rows) { const context = kind === 'maps' ? (matchRows.get(row.matchId)?.map || 'Unknown') : kind === 'agents' ? (row.agent || 'Unknown') : (row.roleSnapshot || 'Unknown'); grouped.set(context, [...(grouped.get(context) || []), row]); }
    return [...grouped.entries()].map(([context, values]) => {
      const matches = new Set(values.map(row => row.matchId)).size; const kills = totalIfComplete(values, 'kills'); const deaths = totalIfComplete(values, 'deaths');
      const covered = totalIfComplete(values, 'kastCovered'); const successful = totalIfComplete(values, 'kastSuccessful'); const kd = kills !== null && deaths !== null && deaths > 0 ? kills / deaths : null;
      return { context, matches, killsPerDeath: kd === null ? null : Math.round(kd * 100) / 100, kast: covered && successful !== null ? Math.round(successful / covered * 1000) / 10 : null, rating: matches >= MINIMUM_RATING_MATCHES && kd !== null && cohort.combat.values.length >= MINIMUM_RATING_COHORT ? Math.round(clamp(50 + (kd - cohort.combat.center) / cohort.combat.spread * 10) * 10) / 10 : null };
    }).sort((left, right) => right.matches - left.matches || (right.rating ?? -1) - (left.rating ?? -1));
  };
  return base.map(row => {
    const components = Object.fromEntries(keys.map(key => { const score = scoreComponent(key, row.raw[key]); return [key, score === null ? null : Math.round(score * 10) / 10]; })) as CalibratedPlayerRating['components'];
    const unknownReasons: string[] = [];
    if (base.length < MINIMUM_RATING_COHORT) unknownReasons.push(`minimum-${MINIMUM_RATING_COHORT}-player-cohort-required`);
    if (row.matches < MINIMUM_RATING_MATCHES) unknownReasons.push(`minimum-${MINIMUM_RATING_MATCHES}-matches-required`);
    for (const key of keys) if (row.raw[key] === null) unknownReasons.push(`${key}-evidence-incomplete`);
    const complete = unknownReasons.length === 0 && keys.every(key => components[key] !== null);
    const rawScore = complete ? components.combat! * .4 + components.survival! * .25 + components.teamplay! * .2 + components.openings! * .15 : null;
    const reliability = Math.round(row.matches / (row.matches + 5) * 100); const rating = rawScore === null ? null : Math.round((50 + (rawScore - 50) * row.matches / (row.matches + 5)) * 10) / 10;
    return {
      playerId: row.id, player: row.player, rating, rawScore: rawScore === null ? null : Math.round(rawScore * 10) / 10, reliability, matches: row.matches,
      confidence: rating === null ? 'unavailable' as const : row.matches >= 20 ? 'high' as const : 'medium' as const,
      interval: { low: null, high: null }, trend: { previous: null, recent: null, delta: null },
      contexts: { maps: splitRows(row.rows, 'maps'), agents: splitRows(row.rows, 'agents'), roles: splitRows(row.rows, 'roles') }, components,
      calibration: { status: complete ? 'experimental-team-context' as const : 'insufficient-evidence' as const, cohortSize: base.length, baseline: 'median-mad' as const, shrinkageTarget: 50, minimumReliableMatches: MINIMUM_RATING_MATCHES, minimumCohortSize: MINIMUM_RATING_COHORT },
      publicationStatus: complete ? 'experimental-only' as const : 'insufficient-evidence' as const, unknownReasons,
      validationStatus: 'experimental-unvalidated' as const,
      method: 'Experimental team-context description; not an authoritative or outcome-predictive player rating', calculationVersion: 'calibrated-player-rating/v4' as const,
    };
  }).sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1));
}
