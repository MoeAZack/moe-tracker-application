export interface SpatialPoint { x: number; y: number; timestampMs: number; roundNumber: number; playerId: string; kind: 'position' | 'death' | 'kill' | 'utility'; label: string }
export interface SpatialReport { available: boolean; reason: string | null; points: SpatialPoint[]; paths: Array<{ playerId: string; roundNumber: number; points: SpatialPoint[] }>; killMarkers: SpatialPoint[]; utilityTimeline: SpatialPoint[]; territory: Array<{ cell: string; visits: number }>; spacing: { samples: number; average: number | null }; tradeDistance: { samples: number; average: number | null } }

const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
function coordinates(observation: any): { x: number; y: number } | null {
  const a = observation?.attributes || {}; const p = a.position || a.worldPosition || observation.position || {};
  let x = finite(a.normalizedX ?? p.normalizedX ?? p.x ?? a.x); let y = finite(a.normalizedY ?? p.normalizedY ?? p.y ?? a.y);
  if (x === null || y === null) return null;
  if (x < 0 || y < 0) return null;
  if (x > 1 || y > 1) { const bounds = a.mapBounds; if (!bounds || !finite(bounds.width) || !finite(bounds.height)) return null; x /= Number(bounds.width); y /= Number(bounds.height); }
  return x <= 1 && y <= 1 ? { x, y } : null;
}
const distance = (a: SpatialPoint, b: SpatialPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export function buildSpatialReport(replayRecord: any): SpatialReport {
  const observations = replayRecord?.status === 'accepted' ? replayRecord?.draft?.evidence?.observations || [] : [];
  const points: SpatialPoint[] = [];
  for (const observation of observations) {
    const xy = coordinates(observation); if (!xy) continue;
    const signal = String(observation.signal || observation.kind || ''); const kind: SpatialPoint['kind'] = signal.includes('utility') || signal === 'ultimate-use' ? 'utility' : signal.includes('elimination') || signal.includes('kill') ? (observation.victimId ? 'death' : 'kill') : 'position';
    points.push({ ...xy, timestampMs: Number(observation.timestampMs || observation.attributes?.timestampMs || 0), roundNumber: Number(observation.roundNumber || 0), playerId: String(observation.playerId || observation.victimId || observation.killerId || 'unknown'), kind, label: String(observation.attributes?.ability || observation.attributes?.zone || signal || 'position') });
  }
  if (!points.length) return { available: false, reason: 'Accepted replay evidence does not contain explicit normalized coordinates.', points: [], paths: [], killMarkers: [], utilityTimeline: [], territory: [], spacing: { samples: 0, average: null }, tradeDistance: { samples: 0, average: null } };
  points.sort((a, b) => a.roundNumber - b.roundNumber || a.timestampMs - b.timestampMs);
  const grouped = new Map<string, SpatialPoint[]>(); for (const point of points.filter(item => item.kind === 'position')) { const key = `${point.roundNumber}:${point.playerId}`; grouped.set(key, [...(grouped.get(key) || []), point]); }
  const territoryMap = new Map<string, number>(); for (const point of points) { const cell = `${Math.min(9, Math.floor(point.x * 10))}:${Math.min(9, Math.floor(point.y * 10))}`; territoryMap.set(cell, (territoryMap.get(cell) || 0) + 1); }
  const spacingSamples: number[] = []; const byTime = new Map<string, SpatialPoint[]>(); for (const point of points.filter(item => item.kind === 'position')) { const key = `${point.roundNumber}:${Math.round(point.timestampMs / 1000)}`; byTime.set(key, [...(byTime.get(key) || []), point]); }
  for (const sample of byTime.values()) for (const point of sample) { const others = sample.filter(item => item.playerId !== point.playerId); if (others.length) spacingSamples.push(Math.min(...others.map(item => distance(point, item)))); }
  const deaths = points.filter(item => item.kind === 'death'); const tradeDistances: number[] = [];
  for (const death of deaths) { const nearby = points.filter(item => item.kind === 'position' && item.roundNumber === death.roundNumber && item.playerId !== death.playerId && Math.abs(item.timestampMs - death.timestampMs) <= 5000); if (nearby.length) tradeDistances.push(Math.min(...nearby.map(item => distance(death, item)))); }
  const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 1000) / 1000 : null;
  return { available: true, reason: null, points, paths: [...grouped.entries()].map(([key, path]) => ({ playerId: key.split(':').slice(1).join(':'), roundNumber: Number(key.split(':')[0]), points: path })), killMarkers: points.filter(item => item.kind === 'kill' || item.kind === 'death'), utilityTimeline: points.filter(item => item.kind === 'utility'), territory: [...territoryMap.entries()].map(([cell, visits]) => ({ cell, visits })).sort((a, b) => b.visits - a.visits), spacing: { samples: spacingSamples.length, average: average(spacingSamples) }, tradeDistance: { samples: tradeDistances.length, average: average(tradeDistances) } };
}

export function buildCrossMatchHeatmaps(records: any[]) {
  const points = records.flatMap(record => buildSpatialReport(record).points);
  const aggregate = (kind: 'death' | 'utility') => { const cells = new Map<string, number>(); for (const point of points.filter(item => item.kind === kind)) { const cell = `${Math.min(9, Math.floor(point.x * 10))}:${Math.min(9, Math.floor(point.y * 10))}`; cells.set(cell, (cells.get(cell) || 0) + 1); } return [...cells.entries()].map(([cell, count]) => ({ cell, count })).sort((a, b) => b.count - a.count); };
  return { deaths: aggregate('death'), utility: aggregate('utility'), matchesWithCoordinates: records.filter(record => buildSpatialReport(record).available).length };
}
