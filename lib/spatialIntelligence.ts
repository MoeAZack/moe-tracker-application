import { resolveVerifiedMapCalibration, transformMapCoordinate, type MapCalibration } from './mapCalibration';

export interface SpatialPoint { x: number; y: number; timestampMs: number; roundNumber: number; playerId: string; teamId: string | null; map: string; kind: 'position' | 'death' | 'kill' | 'utility'; label: string }
export interface SpatialReport {
  schema: 'moetracker.spatial-intelligence/v4'; available: boolean; reason: string | null; map: string | null;
  points: SpatialPoint[]; paths: Array<{ playerId: string; teamId: string | null; roundNumber: number; points: SpatialPoint[] }>;
  killMarkers: SpatialPoint[]; utilityTimeline: SpatialPoint[]; territory: Array<{ cell: string; visits: number }>;
  spacing: { samples: number; average: number | null; basis: string }; tradeDistance: { samples: number; average: number | null; basis: string };
  transform: { method: 'verified-map' | 'declared-map' | 'replay-envelope'; bounds: { minX: number; minY: number; width: number; height: number } | null; assetPath: string | null; provenance: MapCalibration['provenance'] | null; officialComparison: boolean };
  calculationVersion: string;
}

export interface RouteClusterReport {
  schema: 'moetracker.route-clusters/v1'; available: boolean; reason: string | null; verifiedMatches: number;
  clusters: Array<{ id: string; map: string; teamId: string | null; routes: number; rounds: number[]; players: string[]; centroid: { x: number; y: number }; representative: Array<{ x: number; y: number }> }>;
  calculationVersion: string;
}

export interface UtilitySpaceReport {
  schema: 'moetracker.utility-space-impact/v1'; available: boolean; reason: string | null; verifiedMatches: number;
  rows: Array<{ map: string; utility: string; uses: number; samples: number; averageNewCells: number; averageTeammatesNearby: number; basis: string }>;
  calculationVersion: string;
}

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
function rawCoordinates(observation: any): { x: number; y: number; normalized: boolean; bounds: any } | null {
  const a = observation?.attributes || {}; const p = a.position || a.worldPosition || observation.position || {};
  const coordinateSpace = String(a.coordinateSpace || p.coordinateSpace || '').toLowerCase();
  const hasNormalized = a.normalizedX !== undefined || p.normalizedX !== undefined;
  const x = finite(a.normalizedX ?? p.normalizedX ?? p.x ?? a.x); const y = finite(a.normalizedY ?? p.normalizedY ?? p.y ?? a.y);
  if (x === null || y === null) return null;
  if (hasNormalized || coordinateSpace === 'map-normalized') return x >= 0 && y >= 0 && x <= 1 && y <= 1 ? { x, y, normalized: true, bounds: null } : null;
  return { x, y, normalized: false, bounds: a.mapBounds || null };
}
const distance = (a: Pick<SpatialPoint, 'x' | 'y'>, b: Pick<SpatialPoint, 'x' | 'y'>) => Math.hypot(a.x - b.x, a.y - b.y);
const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000 : null;
const cell = (point: Pick<SpatialPoint, 'x' | 'y'>, size = 10) => `${Math.min(size - 1, Math.floor(point.x * size))}:${Math.min(size - 1, Math.floor(point.y * size))}`;

export function buildSpatialReport(replayRecord: any, calibrations: readonly unknown[] = []): SpatialReport {
  const observations = replayRecord?.status === 'accepted' ? replayRecord?.draft?.evidence?.observations || [] : [];
  const map = String(replayRecord?.draft?.match?.map || replayRecord?.match?.map || replayRecord?.map || '').trim() || null;
  const calibration = resolveVerifiedMapCalibration(map, calibrations).calibration;
  const raw: Array<{ observation: any; xy: NonNullable<ReturnType<typeof rawCoordinates>>; kind: SpatialPoint['kind']; playerId: string; teamId: string | null; label: string }> = [];
  const add = (observation: any, kind: SpatialPoint['kind'], playerId: unknown, teamId: unknown, label: string) => { const xy = rawCoordinates(observation); if (xy) raw.push({ observation, xy, kind, playerId: String(playerId || 'unknown'), teamId: teamId ? String(teamId) : null, label }); };
  for (const observation of observations) { const signal = String(observation.signal || observation.kind || ''); const kind: SpatialPoint['kind'] = signal === 'position-zone' ? 'position' : signal.includes('utility') || signal === 'ultimate-use' || signal === 'orb-capture' || signal === 'plant' || signal === 'defuse' ? 'utility' : signal.includes('elimination') || signal.includes('kill') ? (observation.victimId ? 'death' : 'kill') : 'position'; add(observation, kind, observation.playerId || observation.victimId || observation.killerId, observation.teamId || observation.attributes?.teamId, String(observation.attributes?.ability || observation.attributes?.zone || signal || 'position')); }
  for (const round of replayRecord?.draft?.evidence?.rounds || []) for (const event of round.events || []) { const base = { roundNumber: round.roundNumber, occurredAtMs: event.timestampMs, attributes: { position: event.killerPosition, coordinateSpace: 'world' } }; add(base, 'kill', event.killerPlayerId, event.killerTeamId, 'kill'); add({ ...base, attributes: { position: event.victimPosition, coordinateSpace: 'world' } }, 'death', event.victimPlayerId, event.victimTeamId, 'death'); }
  if (!raw.length) return { schema: 'moetracker.spatial-intelligence/v4', available: false, reason: 'Accepted replay evidence does not contain explicit map coordinates.', map, points: [], paths: [], killMarkers: [], utilityTimeline: [], territory: [], spacing: { samples: 0, average: null, basis: 'same-team nearest neighbor' }, tradeDistance: { samples: 0, average: null, basis: 'same-team position within five seconds of death' }, transform: { method: 'replay-envelope', bounds: null, assetPath: null, provenance: null, officialComparison: false }, calculationVersion: 'spatial-intelligence/v4' };
  const world = raw.filter(item => !item.xy.normalized); const declared = world.map(item => item.xy.bounds).find(bounds => finite(bounds?.width) && finite(bounds?.height));
  const xs = world.map(item => item.xy.x), ys = world.map(item => item.xy.y); const pad = 250;
  const bounds = calibration?.bounds || (declared ? { minX: Number(declared.minX || 0), minY: Number(declared.minY || 0), width: Number(declared.width), height: Number(declared.height) } : world.length ? { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, width: Math.max(1, Math.max(...xs) - Math.min(...xs) + pad * 2), height: Math.max(1, Math.max(...ys) - Math.min(...ys) + pad * 2) } : null);
  const points: SpatialPoint[] = raw.map(item => {
    const xy = item.xy.normalized ? { x: item.xy.x, y: item.xy.y } : calibration ? transformMapCoordinate(item.xy.x, item.xy.y, calibration) : { x: (item.xy.x - bounds!.minX) / bounds!.width, y: (item.xy.y - bounds!.minY) / bounds!.height };
    return { x: Math.max(0, Math.min(1, xy.x)), y: Math.max(0, Math.min(1, xy.y)), timestampMs: Number(item.observation.occurredAtMs ?? item.observation.timestampMs ?? item.observation.attributes?.timestampMs ?? 0), roundNumber: Number(item.observation.roundNumber || 0), playerId: item.playerId, teamId: item.teamId, map: map || String(item.observation.attributes?.map || 'Unknown'), kind: item.kind, label: item.label };
  });
  points.sort((a, b) => a.roundNumber - b.roundNumber || a.timestampMs - b.timestampMs);
  const grouped = new Map<string, SpatialPoint[]>(); for (const point of points.filter(item => item.kind === 'position')) { const key = `${point.roundNumber}:${point.playerId}`; grouped.set(key, [...(grouped.get(key) || []), point]); }
  const territoryMap = new Map<string, number>(); for (const point of points) territoryMap.set(cell(point), (territoryMap.get(cell(point)) || 0) + 1);
  const spacingSamples: number[] = []; const byTime = new Map<string, SpatialPoint[]>(); for (const point of points.filter(item => item.kind === 'position')) { const key = `${point.roundNumber}:${Math.round(point.timestampMs / 1000)}`; byTime.set(key, [...(byTime.get(key) || []), point]); }
  for (const sample of byTime.values()) for (const point of sample) { const others = sample.filter(item => item.playerId !== point.playerId && point.teamId && item.teamId === point.teamId); if (others.length) spacingSamples.push(Math.min(...others.map(item => distance(point, item)))); }
  const deaths = points.filter(item => item.kind === 'death'); const tradeDistances: number[] = [];
  for (const death of deaths) { const nearby = points.filter(item => item.kind === 'position' && item.roundNumber === death.roundNumber && item.playerId !== death.playerId && death.teamId && item.teamId === death.teamId && Math.abs(item.timestampMs - death.timestampMs) <= 5000); if (nearby.length) tradeDistances.push(Math.min(...nearby.map(item => distance(death, item)))); }
  const method = calibration ? 'verified-map' : declared || !world.length ? 'declared-map' : 'replay-envelope';
  return { schema: 'moetracker.spatial-intelligence/v4', available: true, reason: null, map, points, paths: [...grouped.entries()].map(([key, path]) => ({ playerId: key.split(':').slice(1).join(':'), teamId: path[0]?.teamId || null, roundNumber: Number(key.split(':')[0]), points: path })), killMarkers: points.filter(item => item.kind === 'kill' || item.kind === 'death'), utilityTimeline: points.filter(item => item.kind === 'utility'), territory: [...territoryMap.entries()].map(([cellName, visits]) => ({ cell: cellName, visits })).sort((a, b) => b.visits - a.visits), spacing: { samples: spacingSamples.length, average: average(spacingSamples), basis: 'same-team nearest neighbor in normalized map space' }, tradeDistance: { samples: tradeDistances.length, average: average(tradeDistances), basis: 'same-team position within five seconds of death in normalized map space' }, transform: { method, bounds, assetPath: calibration?.asset.path || null, provenance: calibration?.provenance || null, officialComparison: method === 'verified-map' }, calculationVersion: 'spatial-intelligence/v4' };
}

export function buildCrossMatchHeatmaps(records: any[], calibrations: readonly unknown[] = []) {
  const reports = records.map(record => buildSpatialReport(record, calibrations));
  const aggregate = (items: SpatialPoint[], kind: 'death' | 'utility') => { const cells = new Map<string, number>(); for (const point of items.filter(item => item.kind === kind)) cells.set(cell(point), (cells.get(cell(point)) || 0) + 1); return [...cells.entries()].map(([cellName, count]) => ({ cell: cellName, count })).sort((a, b) => b.count - a.count); };
  const aligned: SpatialPoint[] = []; const maps: Array<{ map: string; deaths: Array<{ cell: string; count: number }>; utility: Array<{ cell: string; count: number }>; samples: number; matches: number; transform: string; officialComparison: boolean }> = [];
  let comparableMatches = 0;
  for (const mapName of [...new Set(reports.filter(report => report.available).map(report => report.map || 'Unknown'))].sort()) {
    const mapReports = reports.filter(report => report.available && (report.map || 'Unknown') === mapName); const verified = mapReports.filter(report => report.transform.method === 'verified-map'); const declared = mapReports.filter(report => report.transform.method === 'declared-map'); let selected: SpatialPoint[]; let transform: string; let matches: number;
    if (verified.length) { selected = verified.flatMap(report => report.points); transform = 'verified-map'; matches = verified.length; }
    else if (declared.length) { selected = declared.flatMap(report => report.points); transform = 'source-declared-map'; matches = declared.length; }
    else { const recovered = mapReports.flatMap(report => report.points.map(point => ({ point, x: point.x * report.transform.bounds!.width + report.transform.bounds!.minX, y: point.y * report.transform.bounds!.height + report.transform.bounds!.minY }))); const minX = Math.min(...recovered.map(item => item.x)), maxX = Math.max(...recovered.map(item => item.x)), minY = Math.min(...recovered.map(item => item.y)), maxY = Math.max(...recovered.map(item => item.y)); const width = Math.max(1, maxX - minX), height = Math.max(1, maxY - minY); selected = recovered.map(item => ({ ...item.point, x: (item.x - minX) / width, y: (item.y - minY) / height })); transform = 'cohort-envelope'; matches = mapReports.length; }
    comparableMatches += matches; aligned.push(...selected); maps.push({ map: mapName, deaths: aggregate(selected, 'death'), utility: aggregate(selected, 'utility'), samples: selected.length, matches, transform, officialComparison: transform === 'verified-map' });
  }
  const verifiedCalibratedMatches = reports.filter(report => report.available && report.transform.method === 'verified-map').length;
  return { schema: 'moetracker.cross-match-heatmaps/v4' as const, deaths: aggregate(aligned, 'death'), utility: aggregate(aligned, 'utility'), maps, matchesWithCoordinates: reports.filter(report => report.available).length, comparableMatches, calibratedMatches: verifiedCalibratedMatches, verifiedCalibratedMatches, declaredCoordinateMatches: reports.filter(report => report.available && report.transform.method === 'declared-map').length, cohortAlignedMatches: reports.filter(report => report.available && report.transform.method === 'replay-envelope').length, officialComparisonAvailable: verifiedCalibratedMatches > 0, calculationVersion: 'spatial-intelligence/v4' };
}

export function buildRouteClusters(records: any[], calibrations: readonly unknown[] = [], minimumRoutes = 3): RouteClusterReport {
  const reports = records.map(record => buildSpatialReport(record, calibrations)).filter(report => report.available && report.transform.method === 'verified-map');
  const routes = reports.flatMap(report => report.paths.filter(path => path.points.length >= 2).map(path => ({ map: report.map || 'Unknown', ...path })));
  if (routes.length < minimumRoutes) return { schema: 'moetracker.route-clusters/v1', available: false, reason: `Route clustering needs at least ${minimumRoutes} paths in verified map space; ${routes.length} are available.`, verifiedMatches: reports.length, clusters: [], calculationVersion: 'route-clusters/v1' };
  const grouped = new Map<string, typeof routes>();
  for (const route of routes) { const start = route.points[0], end = route.points[route.points.length - 1]; const cx = average(route.points.map(point => point.x)) || 0, cy = average(route.points.map(point => point.y)) || 0; const id = `${route.map}:${route.teamId || 'unknown'}:${cell(start, 5)}>${cell({ x: cx, y: cy }, 5)}>${cell(end, 5)}`; grouped.set(id, [...(grouped.get(id) || []), route]); }
  const clusters = [...grouped.entries()].map(([id, items]) => { const all = items.flatMap(item => item.points); const representative = items.sort((a, b) => b.points.length - a.points.length)[0].points.filter((_, index, points) => index === 0 || index === points.length - 1 || index % Math.max(1, Math.floor(points.length / 8)) === 0).map(point => ({ x: point.x, y: point.y })); return { id, map: items[0].map, teamId: items[0].teamId, routes: items.length, rounds: [...new Set(items.map(item => item.roundNumber))].sort((a, b) => a - b), players: [...new Set(items.map(item => item.playerId))].sort(), centroid: { x: average(all.map(point => point.x)) || 0, y: average(all.map(point => point.y)) || 0 }, representative }; }).sort((a, b) => b.routes - a.routes || a.id.localeCompare(b.id, 'en'));
  return { schema: 'moetracker.route-clusters/v1', available: true, reason: null, verifiedMatches: reports.length, clusters, calculationVersion: 'route-clusters/v1' };
}

export function buildUtilitySpaceImpact(records: any[], calibrations: readonly unknown[] = []): UtilitySpaceReport {
  const reports = records.map(record => buildSpatialReport(record, calibrations)).filter(report => report.available && report.transform.method === 'verified-map');
  const samples: Array<{ map: string; utility: string; newCells: number; nearby: number }> = [];
  for (const report of reports) for (const utility of report.utilityTimeline) {
    const positions = report.points.filter(point => point.kind === 'position' && point.roundNumber === utility.roundNumber && utility.teamId && point.teamId === utility.teamId && point.playerId !== utility.playerId);
    const before = positions.filter(point => point.timestampMs >= utility.timestampMs - 5000 && point.timestampMs < utility.timestampMs); const after = positions.filter(point => point.timestampMs >= utility.timestampMs && point.timestampMs <= utility.timestampMs + 8000);
    if (!after.length) continue; const beforeCells = new Set(before.map(point => cell(point))); const afterCells = new Set(after.map(point => cell(point))); const newCells = [...afterCells].filter(item => !beforeCells.has(item)).length; const nearby = new Set(after.filter(point => distance(point, utility) <= .2).map(point => point.playerId)).size;
    samples.push({ map: report.map || 'Unknown', utility: utility.label || 'utility', newCells, nearby });
  }
  if (!samples.length) return { schema: 'moetracker.utility-space-impact/v1', available: false, reason: 'Verified map-space utility events do not yet have teammate position samples in the following eight seconds.', verifiedMatches: reports.length, rows: [], calculationVersion: 'utility-space-impact/v1' };
  const grouped = new Map<string, typeof samples>(); for (const sample of samples) { const id = `${sample.map}:${sample.utility}`; grouped.set(id, [...(grouped.get(id) || []), sample]); }
  const rows = [...grouped.values()].map(items => ({ map: items[0].map, utility: items[0].utility, uses: items.length, samples: items.length, averageNewCells: average(items.map(item => item.newCells)) || 0, averageTeammatesNearby: average(items.map(item => item.nearby)) || 0, basis: 'descriptive teammate map occupancy during eight seconds after use; no causal claim' })).sort((a, b) => b.uses - a.uses || `${a.map}:${a.utility}`.localeCompare(`${b.map}:${b.utility}`, 'en'));
  return { schema: 'moetracker.utility-space-impact/v1', available: true, reason: null, verifiedMatches: reports.length, rows, calculationVersion: 'utility-space-impact/v1' };
}
