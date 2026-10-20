export const MAP_CALIBRATION_SCHEMA = 'moetracker.map-calibration/v1' as const;

export interface MapCalibration {
  schema: typeof MAP_CALIBRATION_SCHEMA;
  map: string;
  status: 'verified' | 'draft' | 'revoked';
  bounds: { minX: number; minY: number; width: number; height: number };
  orientation: { rotate: 0 | 90 | 180 | 270; flipX: boolean; flipY: boolean };
  asset: { path: string; sha256: string };
  provenance: { source: string; verifiedBy: string; verifiedAt: string };
}

export interface CalibrationResolution {
  calibration: MapCalibration | null;
  reason: string | null;
}

const finite = (value: unknown) => Number.isFinite(Number(value));
const key = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('en');

/**
 * A calibration is trusted only when its geometry, immutable asset identity,
 * verifier and timestamp are all present. Draft/revoked rows never activate.
 */
export function validateMapCalibration(value: unknown): string[] {
  const row = value as Partial<MapCalibration> | null;
  const errors: string[] = [];
  if (!row || row.schema !== MAP_CALIBRATION_SCHEMA) errors.push('schema');
  if (!String(row?.map || '').trim()) errors.push('map');
  if (row?.status !== 'verified') errors.push('status');
  if (!finite(row?.bounds?.minX) || !finite(row?.bounds?.minY) || !finite(row?.bounds?.width) || !finite(row?.bounds?.height) || Number(row?.bounds?.width) <= 0 || Number(row?.bounds?.height) <= 0) errors.push('bounds');
  if (![0, 90, 180, 270].includes(Number(row?.orientation?.rotate))) errors.push('orientation');
  if (typeof row?.orientation?.flipX !== 'boolean' || typeof row?.orientation?.flipY !== 'boolean') errors.push('orientation');
  if (!String(row?.asset?.path || '').trim() || !/^[a-f0-9]{64}$/i.test(String(row?.asset?.sha256 || ''))) errors.push('asset');
  if (!String(row?.provenance?.source || '').trim() || !String(row?.provenance?.verifiedBy || '').trim() || !Number.isFinite(Date.parse(String(row?.provenance?.verifiedAt || '')))) errors.push('provenance');
  return [...new Set(errors)];
}

export function resolveVerifiedMapCalibration(map: unknown, rows: readonly unknown[] = []): CalibrationResolution {
  const mapKey = key(map);
  if (!mapKey) return { calibration: null, reason: 'Replay map identity is missing.' };
  const candidates = rows.filter(row => key((row as any)?.map) === mapKey);
  if (!candidates.length) return { calibration: null, reason: `No calibration is registered for ${String(map).trim()}.` };
  const valid = candidates.filter(row => validateMapCalibration(row).length === 0) as MapCalibration[];
  if (!valid.length) return { calibration: null, reason: `The ${String(map).trim()} calibration is not independently verified.` };
  valid.sort((left, right) => Date.parse(right.provenance.verifiedAt) - Date.parse(left.provenance.verifiedAt));
  return { calibration: structuredClone(valid[0]), reason: null };
}

export function transformMapCoordinate(x: number, y: number, calibration: MapCalibration) {
  let nx = (x - calibration.bounds.minX) / calibration.bounds.width;
  let ny = (y - calibration.bounds.minY) / calibration.bounds.height;
  if (calibration.orientation.flipX) nx = 1 - nx;
  if (calibration.orientation.flipY) ny = 1 - ny;
  const rotated = calibration.orientation.rotate === 90 ? { x: 1 - ny, y: nx }
    : calibration.orientation.rotate === 180 ? { x: 1 - nx, y: 1 - ny }
      : calibration.orientation.rotate === 270 ? { x: ny, y: 1 - nx }
        : { x: nx, y: ny };
  return { x: Math.max(0, Math.min(1, rotated.x)), y: Math.max(0, Math.min(1, rotated.y)) };
}
