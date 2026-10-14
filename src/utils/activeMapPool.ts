import type { TrackerData } from '../types';

const mapKey = (value: unknown) => String(value || '').trim().toLocaleLowerCase();

/** Hide inactive-map evidence from read-only analytics while preserving source history. */
export function filterActiveMapPool(data: TrackerData): TrackerData {
  const activeMaps = new Set((data.settings?.maps || []).map(mapKey).filter(Boolean));
  const matches = (data.matches || []).filter(match => activeMaps.has(mapKey(match.map)));
  const matchIds = new Set(matches.map(match => match.id));
  return {
    ...data,
    matches,
    playerStats: (data.playerStats || []).filter(row => matchIds.has(row.matchId)),
    rounds: (data.rounds || []).filter(row => matchIds.has(row.matchId)),
    vetos: (data.vetos || []).filter(row => matchIds.has(row.matchId)),
    strats: (data.strats || []).filter(row => activeMaps.has(mapKey(row.map))),
    stratRuns: (data.stratRuns || []).filter(row => activeMaps.has(mapKey(row.map)) && (!row.matchId || matchIds.has(row.matchId))),
    vodReviews: (data.vodReviews || []).filter(row => !row.matchId || matchIds.has(row.matchId)),
    lineups: (data.lineups || []).filter(row => activeMaps.has(mapKey(row.map))),
  };
}
