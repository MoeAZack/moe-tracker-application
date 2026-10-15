import type { TrackerData } from '../types';

export type AnalyticsMapScope = 'all' | 'active';

export const DEFAULT_ANALYTICS_MAP_SCOPE: AnalyticsMapScope = 'all';

export interface AnalyticsMapScopeContext {
  scope: AnalyticsMapScope;
  sourceMatchCount: number;
  includedMatchCount: number;
  excludedMatchCount: number;
  configuredActiveMapCount: number;
  unknownMatchCount: number;
  contradictoryMaps: string[];
  emptyActivePool: boolean;
}

export interface AnalyticsMapProjection {
  data: TrackerData;
  context: AnalyticsMapScopeContext;
}

const mapKey = (value: unknown) => String(value ?? '').trim().toLowerCase();
const normalizedMapSet = (values: unknown[] | undefined) => new Set((values || []).map(mapKey).filter(Boolean));
const canonicalMapNames = (...groups: unknown[][]) => {
  const names = new Map<string, string>();
  groups.flat().forEach(value => {
    const display = String(value ?? '').trim();
    const key = mapKey(display);
    if (key && !names.has(key)) names.set(key, display);
  });
  return names;
};
const canonicalMapName = (value: unknown, names: Map<string, string>, blankFallback = '') => names.get(mapKey(value)) || String(value ?? '').trim() || blankFallback;

/**
 * The single map-scope boundary for current-performance analytics.
 * `all` deliberately includes every row in the supplied phase/history sample.
 * In `active`, the explicit active list wins a settings conflict and unknown
 * maps are excluded. Map display names are canonicalized case-insensitively so
 * downstream views that enumerate `settings.maps` consume the same universe.
 */
export function projectAnalyticsMapScope(
  source: TrackerData,
  scope: AnalyticsMapScope = DEFAULT_ANALYTICS_MAP_SCOPE,
): AnalyticsMapProjection {
  const configuredActiveMaps = normalizedMapSet(source.settings?.maps);
  const configuredInactiveMaps = normalizedMapSet(source.settings?.inactiveMaps);
  const contradictoryMaps = [...configuredActiveMaps].filter(map => configuredInactiveMaps.has(map)).sort();
  const effectiveActiveMaps = configuredActiveMaps;
  const knownMaps = new Set([...configuredActiveMaps, ...configuredInactiveMaps]);
  const sourceMatches = source.matches || [];
  const unknownMatchCount = sourceMatches.filter(match => !knownMaps.has(mapKey(match.map))).length;
  const allMapNames = canonicalMapNames(
    source.settings?.maps || [],
    source.settings?.inactiveMaps || [],
    sourceMatches.map(match => match.map),
  );
  if (sourceMatches.some(match => !mapKey(match.map))) allMapNames.set('unknown map', 'Unknown map');
  const activeMapNames = canonicalMapNames(source.settings?.maps || []);

  if (scope === 'all') {
    return {
      data: {
        ...source,
        settings: { ...source.settings, maps: [...allMapNames.values()] },
        matches: sourceMatches.map(match => ({ ...match, map: canonicalMapName(match.map, allMapNames, 'Unknown map') })),
        strats: (source.strats || []).map(row => ({ ...row, map: canonicalMapName(row.map, allMapNames) })),
        stratRuns: (source.stratRuns || []).map(row => ({ ...row, map: canonicalMapName(row.map, allMapNames) })),
        lineups: (source.lineups || []).map(row => ({ ...row, map: canonicalMapName(row.map, allMapNames) })),
      },
      context: {
        scope,
        sourceMatchCount: sourceMatches.length,
        includedMatchCount: sourceMatches.length,
        excludedMatchCount: 0,
        configuredActiveMapCount: effectiveActiveMaps.size,
        unknownMatchCount,
        contradictoryMaps,
        emptyActivePool: effectiveActiveMaps.size === 0,
      },
    };
  }

  const matches = sourceMatches
    .filter(match => effectiveActiveMaps.has(mapKey(match.map)))
    .map(match => ({ ...match, map: canonicalMapName(match.map, activeMapNames) }));
  const matchIds = new Set(matches.map(match => match.id));
  const data: TrackerData = {
    ...source,
    settings: { ...source.settings, maps: [...activeMapNames.values()] },
    matches,
    playerStats: (source.playerStats || []).filter(row => matchIds.has(row.matchId)),
    rounds: (source.rounds || []).filter(row => matchIds.has(row.matchId)),
    vetos: (source.vetos || []).filter(row => matchIds.has(row.matchId)),
    strats: (source.strats || []).filter(row => effectiveActiveMaps.has(mapKey(row.map))).map(row => ({ ...row, map: canonicalMapName(row.map, activeMapNames) })),
    stratRuns: (source.stratRuns || []).filter(row => effectiveActiveMaps.has(mapKey(row.map)) && (!row.matchId || matchIds.has(row.matchId))).map(row => ({ ...row, map: canonicalMapName(row.map, activeMapNames) })),
    vodReviews: (source.vodReviews || []).filter(row => !row.matchId || matchIds.has(row.matchId)),
    lineups: (source.lineups || []).filter(row => effectiveActiveMaps.has(mapKey(row.map))).map(row => ({ ...row, map: canonicalMapName(row.map, activeMapNames) })),
  };

  return {
    data,
    context: {
      scope,
      sourceMatchCount: sourceMatches.length,
      includedMatchCount: matches.length,
      excludedMatchCount: sourceMatches.length - matches.length,
      configuredActiveMapCount: effectiveActiveMaps.size,
      unknownMatchCount,
      contradictoryMaps,
      emptyActivePool: effectiveActiveMaps.size === 0,
    },
  };
}

/** Backward-compatible strict projection for explicit active-pool callers. */
export function filterActiveMapPool(data: TrackerData): TrackerData {
  return projectAnalyticsMapScope(data, 'active').data;
}
