import { buildScreenshotReviewDraft } from './entryEngine';

export const LOCAL_OCR_RUNTIME = Object.freeze({
  tesseractVersion: '7.0.0',
  languagePackage: '@tesseract.js-data/eng@1.0.0',
  workerPath: '/ocr-assets/worker.min.js',
  corePath: '/ocr-assets/core',
  langPath: '/ocr-assets/lang',
  cropProfileRequired: true,
});

export type LocalOcrMetric = 'kills' | 'deaths' | 'assists' | 'fk' | 'plants' | 'defuses';
export type LocalOcrRegionKind = 'text' | 'integer';

export interface LocalOcrRegion {
  id: string;
  kind: LocalOcrRegionKind;
  layout?: 'line' | 'block';
  rectangle: { left: number; top: number; width: number; height: number };
}

export interface LocalOcrRecognition {
  regionId: string;
  text: string;
  confidence: number | null;
}

export interface LocalOcrProfile {
  readonly id: string;
  readonly version: number;
  readonly status: 'unvalidated' | 'accepted';
  readonly dimensions: Readonly<{ width: number; height: number }>;
  readonly regions: readonly LocalOcrRegion[];
}

export interface LocalOcrAdapter {
  recognize(image: CanvasImageSource, profile: LocalOcrProfile): Promise<LocalOcrRecognition[]>;
  terminate(): Promise<void>;
}

const METRICS: readonly LocalOcrMetric[] = ['kills', 'deaths', 'assists', 'fk', 'plants', 'defuses'];
export const LOCAL_OCR_PROFILE_LIMITS = Object.freeze({
  maxDimension: 8192,
  maxPixels: 40_000_000,
});
const VALORANT_END_SCREEN_REFERENCE = Object.freeze({ width: 1839, height: 821 });
const VALORANT_PLAYER_TABLE_REFERENCE = Object.freeze({ width: 1016, height: 405 });
const VALORANT_FULL_HD_REFERENCE = Object.freeze({ width: 1920, height: 1080 });

export interface ScoreboardSelection { names: { left: number; top: number; width: number; height: number }; kda: { left: number; top: number; width: number; height: number } }

/** Calibrated text columns on the 1920x1080 TIMELINE round detail screen. */
export function createValorantRoundSummaryProfile(width: number, height: number): LocalOcrProfile {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width / height < 1.72 || width / height > 1.82) throw Object.assign(new Error('Round extraction requires a full 16:9 VALORANT capture.'), { status: 422 });
  const sx = width / 1920; const sy = height / 1080;
  const box = (left: number, top: number, regionWidth: number, regionHeight: number) => ({ left: Math.round(left * sx), top: Math.round(top * sy), width: Math.max(1, Math.round(regionWidth * sx)), height: Math.max(1, Math.round(regionHeight * sy)) });
  const regions: LocalOcrRegion[] = [
    { id: 'round.result', kind: 'text', layout: 'line', rectangle: box(1208, 414, 520, 40) },
    { id: 'averages.ourLoadout', kind: 'integer', layout: 'block', rectangle: box(408, 860, 42, 21) },
    { id: 'averages.enemyLoadout', kind: 'integer', layout: 'block', rectangle: box(448, 860, 44, 21) },
    { id: 'averages.ourBank', kind: 'integer', layout: 'block', rectangle: box(408, 880, 42, 21) },
    { id: 'averages.enemyBank', kind: 'integer', layout: 'block', rectangle: box(448, 880, 44, 21) },
    { id: 'players.names', kind: 'text', layout: 'block', rectangle: box(1260, 468, 210, 427) },
    { id: 'players.kills', kind: 'text', layout: 'block', rectangle: box(1482, 468, 34, 427) },
    { id: 'players.assists', kind: 'text', layout: 'block', rectangle: box(1525, 468, 34, 427) },
  ];
  for (let row = 0; row < 10; row += 1) {
    const top = 470 + row * 42.4;
    regions.push({ id: `player.${row}.loadout`, kind: 'integer', layout: 'line', rectangle: box(1572, top, 54, 20) });
    regions.push({ id: `player.${row}.bank`, kind: 'integer', layout: 'line', rectangle: box(1572, top + 19, 54, 20) });
    regions.push({ id: `player.${row}.weapon`, kind: 'text', layout: 'line', rectangle: box(1632, top, 96, 20) });
    regions.push({ id: `player.${row}.armor`, kind: 'text', layout: 'line', rectangle: box(1632, top + 19, 96, 20) });
  }
  for (let row = 0; row < 11; row += 1) {
    const top = 470 + row * 42.4;
    regions.push({ id: `event.${row}.timestamp`, kind: 'text', layout: 'line', rectangle: box(405, top, 46, 38) });
    // Digits end at x<=637; the 'm' unit (640-647) and the victim portrait (655+) are excluded.
    regions.push({ id: `event.${row}.distance`, kind: 'integer', layout: 'line', rectangle: box(596, top, 42, 38) });
    // "Planted" / "Defused" label on objective rows (kill rows show distance here).
    regions.push({ id: `event.${row}.label`, kind: 'text', layout: 'line', rectangle: box(588, top, 74, 38) });
  }
  return createImmutableLocalOcrProfile({ id: 'valorant-round-summary-v1', version: 6, status: 'accepted', dimensions: { width, height }, regions });
}

export function createValorantPerformanceProfile(width: number, height: number): LocalOcrProfile {
  if (width / height < 1.72 || width / height > 1.82) throw Object.assign(new Error('Performance extraction requires a full 16:9 VALORANT capture.'), { status: 422 });
  const sx = width / 1920; const sy = height / 1080;
  const box = (left: number, top: number, regionWidth: number, regionHeight: number) => ({ left: Math.round(left * sx), top: Math.round(top * sy), width: Math.round(regionWidth * sx), height: Math.round(regionHeight * sy) });
  return createImmutableLocalOcrProfile({ id: 'valorant-performance-v1', version: 1, status: 'accepted', dimensions: { width, height }, regions: [
    { id: 'performance.score', kind: 'integer', layout: 'line', rectangle: box(690, 485, 245, 165) },
    { id: 'performance.accolades', kind: 'text', layout: 'block', rectangle: box(1355, 685, 400, 155) },
  ] });
}

export function createValorantHeadToHeadProfile(width: number, height: number): LocalOcrProfile {
  if (width / height < 1.72 || width / height > 1.82) throw Object.assign(new Error('Head-to-head extraction requires a full 16:9 VALORANT capture.'), { status: 422 });
  const sx = width / 1920; const sy = height / 1080;
  const box = (left: number, top: number, regionWidth: number, regionHeight: number) => ({ left: Math.round(left * sx), top: Math.round(top * sy), width: Math.round(regionWidth * sx), height: Math.round(regionHeight * sy) });
  const regions: LocalOcrRegion[] = [];
  for (let row = 0; row < 5; row += 1) {
    const top = 323 + row * 51.4;
    regions.push({ id: `h2h.${row}.kills`, kind: 'integer', layout: 'line', rectangle: box(598, top, 42, 48) });
    regions.push({ id: `h2h.${row}.deaths`, kind: 'integer', layout: 'line', rectangle: box(710, top, 44, 48) });
    regions.push({ id: `h2h.${row}.assists`, kind: 'integer', layout: 'line', rectangle: box(822, top, 44, 48) });
    regions.push({ id: `h2h.${row}.opponent`, kind: 'text', layout: 'line', rectangle: box(1125, top, 400, 48) });
  }
  return createImmutableLocalOcrProfile({ id: 'valorant-head-to-head-v1', version: 2, status: 'accepted', dimensions: { width, height }, regions });
}
/** User-selected columns, normalized to the image; header and portraits are excluded. */
export function createSelectedScoreboardProfile(width: number, height: number, selection: ScoreboardSelection): LocalOcrProfile {
  const regions: LocalOcrRegion[] = [];
  for (const box of [selection.names, selection.kda]) {
    if (![box.left, box.top, box.width, box.height].every(Number.isFinite) || box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0 || box.left + box.width > 1.001 || box.top + box.height > 1.001) throw new Error('Keep both selection boxes inside the image.');
  }
  for (let row = 0; row < 10; row++) {
    for (const [index, metric] of ['name', 'kills', 'deaths', 'assists'].entries()) {
      const box = metric === 'name' ? selection.names : selection.kda;
      const divisions = metric === 'name' ? 1 : 3;
      const column = metric === 'name' ? 0 : index - 1;
      const left = Math.round((box.left + column * box.width / divisions) * width);
      const rowTop = (box.top + row * box.height / 10) * height; const rowHeight = box.height * height / 10;
      const top = Math.round(rowTop + rowHeight * .08); const bottom = Math.round(rowTop + rowHeight * .92);
      regions.push({ id: `player.${row}.${metric}`, kind: metric === 'name' ? 'text' : 'integer', rectangle: { left, top, width: Math.max(1, Math.min(width - left, Math.round(box.width * width / divisions))), height: Math.max(1, Math.min(height - top, bottom - top)) } });
    }
  }
  return createImmutableLocalOcrProfile({ id: 'valorant-player-table-v1', version: 1, status: 'accepted', dimensions: { width, height }, regions });
}

/** Accepted geometry for the standard VALORANT post-match scoreboard shown in the app. */
/**
 * Post-match scoreboard layouts.
 * - custom (scrims): KDA | First Bloods | Plants | Defuses
 * - competitive (matchmaking, has a Performance tab):
 *   Performance Score | KDA | Trades | First Bloods | Plants | Defuses
 * Reading a competitive board with the custom geometry puts Trades into FK
 * and samples the gaps between the remaining columns.
 */
export type ValorantScoreboardLayout = 'custom' | 'competitive';

export interface ScoreDigitBoxes { left: { left: number; width: number }; right: { left: number; width: number } }

/** Detect a small vertical UI shift from repeated scoreboard row separators. */
export function measureScoreboardRowOffset(pixels: { width: number; height: number; data: Uint8ClampedArray }) {
  if (pixels.width / pixels.height < 1.72 || pixels.width / pixels.height > 1.82) return 0;
  const sx = pixels.width / 1920; const sy = pixels.height / 1080;
  const luminance = (x: number, y: number) => { const index = (y * pixels.width + x) * 4; return (77 * pixels.data[index] + 150 * pixels.data[index + 1] + 29 * pixels.data[index + 2]) >> 8; };
  const ranked: Array<{ offset: number; score: number }> = [];
  for (let offset = -24; offset <= 24; offset += 1) {
    let score = 0;
    for (let row = 0; row <= 10; row += 1) {
      const y = Math.round((321 + row * 48 + offset) * sy); if (y < 2 || y + 2 >= pixels.height) continue;
      for (let referenceX = 430; referenceX <= 1740; referenceX += 24) {
        const x = Math.round(referenceX * sx); score += Math.abs(luminance(x, y - 2) - luminance(x, y + 2));
      }
    }
    ranked.push({ offset, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[1] && ranked[0].score > ranked[1].score * 1.015 ? ranked[0].offset : 0;
}

/**
 * Locate the two coloured score numbers in "11 DEFEAT 13" / "13 VICTORY 9".
 * Their x position depends on digit count and on the word between them, so a
 * fixed box clipped one-digit and wide scores. The digits are teal/red while
 * the word is white, so saturated columns separate them cleanly.
 * Returns reference (1920x1080) coordinates, or null when not exactly two.
 */
export function measureScoreDigitBoxes(pixels: { width: number; height: number; data: Uint8ClampedArray }): ScoreDigitBoxes | null {
  const sx = pixels.width / 1920; const sy = pixels.height / 1080;
  const x0 = Math.round(20 * sx); const x1 = Math.round(340 * sx);
  const y0 = Math.round(150 * sy); const y1 = Math.round(215 * sy);
  const clusters: Array<[number, number]> = [];
  let start = -1; let previous = -1;
  for (let x = x0; x < x1; x += 1) {
    let saturated = 0;
    for (let y = y0; y < y1; y += 1) {
      const index = (y * pixels.width + x) * 4;
      const high = Math.max(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
      const low = Math.min(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
      if (high - low > 90) saturated += 1;
    }
    if (saturated < 3) continue;
    if (start < 0) { start = previous = x; continue; }
    if (x - previous > Math.round(18 * sx)) { clusters.push([start, previous]); start = x; }
    previous = x;
  }
  if (start >= 0) clusters.push([start, previous]);
  if (clusters.length !== 2) return null;
  const box = ([from, to]: [number, number]) => ({ left: Math.max(0, Math.round(from / sx) - 8), width: Math.round((to - from) / sx) + 18 });
  return { left: box(clusters[0]), right: box(clusters[1]) };
}

export function createValorantEndScreenProfile(width: number, height: number, layout: ValorantScoreboardLayout = 'custom', scoreBoxes?: ScoreDigitBoxes | null, rowOffset = 0): LocalOcrProfile {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw Object.assign(new Error('The scoreboard image dimensions are invalid.'), { status: 422 });
  }
  const aspect = width / height;
  // Native 16:9 captures from the standalone helper include the entire client
  // window. Keep this calibrated separately from the older cropped end screen.
  if (aspect >= 1.72 && aspect <= 1.82) {
    const sx = width / VALORANT_FULL_HD_REFERENCE.width; const sy = height / VALORANT_FULL_HD_REFERENCE.height;
    const rectangle = (left: number, top: number, regionWidth: number, regionHeight: number) => ({ left: Math.round(left * sx), top: Math.round(top * sy), width: Math.max(1, Math.round(regionWidth * sx)), height: Math.max(1, Math.round(regionHeight * sy)) });
    const regions: LocalOcrRegion[] = [
      { id: 'map', kind: 'text', rectangle: rectangle(1624, 178, 155, 38) },
      // The left score is always left-aligned at x~40, so the calibrated box
      // fits one and two digits; only the right score moves with the word.
      { id: 'score.left', kind: 'integer', rectangle: rectangle(34, 151, 50, 65) },
      { id: 'score.right', kind: 'integer', rectangle: scoreBoxes ? rectangle(scoreBoxes.right.left, 151, scoreBoxes.right.width, 65) : rectangle(261, 151, 48, 65) },
    ];
    const competitive = layout === 'competitive';
    // Column centres measured on real 1920x1080 captures:
    // custom KDA 975 / FB 1183 / plants 1390 / defuses 1597;
    // competitive perf 827 / KDA 1006 / trades 1169 / FB 1332 / plants 1495 / defuses 1658.
    const metricGeometry: Record<LocalOcrMetric, [number, number]> = competitive ? {
      kills: [948, 38], deaths: [986, 38], assists: [1024, 40],
      fk: [1297, 70], plants: [1460, 70], defuses: [1623, 70],
    } : {
      kills: [927, 34], deaths: [963, 34], assists: [999, 36],
      fk: [1148, 70], plants: [1358, 66], defuses: [1564, 66],
    };
    for (let row = 0; row < 10; row += 1) {
      const top = 321 + rowOffset + row * 48;
      regions.push({ id: `player.${row}.name`, kind: 'text', rectangle: competitive ? rectangle(466, top, 258, 45) : rectangle(445, top, 425, 45) });
      for (const metric of METRICS) {
        const [left, regionWidth] = metricGeometry[metric];
        regions.push({ id: `player.${row}.${metric}`, kind: 'integer', rectangle: rectangle(left, top, regionWidth, 45) });
      }
      if (competitive) {
        regions.push({ id: `player.${row}.trades`, kind: 'integer', rectangle: rectangle(1134, top, 70, 45) });
        regions.push({ id: `player.${row}.performanceScore`, kind: 'integer', rectangle: rectangle(780, top, 94, 45) });
      }
    }
    return createImmutableLocalOcrProfile(competitive
      ? { id: 'valorant-post-match-scoreboard-competitive-v1', version: 1, status: 'accepted', dimensions: { width, height }, regions }
      : { id: 'valorant-post-match-scoreboard-v1', version: 2, status: 'accepted', dimensions: { width, height }, regions });
  }
  if (aspect >= 2.35 && aspect <= 2.75) {
    const sx = width / VALORANT_PLAYER_TABLE_REFERENCE.width; const sy = height / VALORANT_PLAYER_TABLE_REFERENCE.height;
    const rectangle = (left: number, top: number, regionWidth: number, regionHeight: number) => ({ left: Math.round(left * sx), top: Math.round(top * sy), width: Math.max(1, Math.round(regionWidth * sx)), height: Math.max(1, Math.round(regionHeight * sy)) });
    const regions: LocalOcrRegion[] = [];
    for (let row = 0; row < 10; row += 1) {
      const top = 33 + row * 37;
      regions.push({ id: `player.${row}.name`, kind: 'text', rectangle: rectangle(43, top, 330, 33) });
      regions.push({ id: `player.${row}.kills`, kind: 'integer', rectangle: rectangle(420, top, 31, 33) });
      regions.push({ id: `player.${row}.deaths`, kind: 'integer', rectangle: rectangle(451, top, 31, 33) });
      regions.push({ id: `player.${row}.assists`, kind: 'integer', rectangle: rectangle(482, top, 34, 33) });
    }
    return createImmutableLocalOcrProfile({ id: 'valorant-player-table-v1', version: 1, status: 'accepted', dimensions: { width, height }, regions });
  }
  if (aspect < 2.05 || aspect > 2.35) {
    throw Object.assign(new Error('Use the full VALORANT scoreboard or crop to the ten player rows and K/D/A table.'), { status: 422 });
  }
  const sx = width / VALORANT_END_SCREEN_REFERENCE.width;
  const sy = height / VALORANT_END_SCREEN_REFERENCE.height;
  const rectangle = (left: number, top: number, regionWidth: number, regionHeight: number) => ({
    left: Math.round(left * sx), top: Math.round(top * sy),
    width: Math.max(1, Math.round(regionWidth * sx)), height: Math.max(1, Math.round(regionHeight * sy)),
  });
  const regions: LocalOcrRegion[] = [
    { id: 'map', kind: 'text', rectangle: rectangle(1650, 73, 145, 24) },
    { id: 'score.left', kind: 'integer', rectangle: rectangle(18, 25, 55, 64) },
    { id: 'score.right', kind: 'integer', rectangle: rectangle(207, 25, 75, 64) },
  ];
  const metricGeometry: Record<LocalOcrMetric, [number, number]> = {
    kills: [956, 42], deaths: [997, 42], assists: [1038, 42],
    fk: [1168, 72], plants: [1374, 72], defuses: [1580, 72],
  };
  for (let row = 0; row < 10; row += 1) {
    const top = 232 + row * 48;
    regions.push({ id: `player.${row}.name`, kind: 'text', rectangle: rectangle(461, top, 395, 42) });
    for (const metric of METRICS) {
      const [left, regionWidth] = metricGeometry[metric];
      regions.push({ id: `player.${row}.${metric}`, kind: 'integer', rectangle: rectangle(left, top, regionWidth, 42) });
    }
  }
  return createImmutableLocalOcrProfile({
    id: 'valorant-post-match-scoreboard-v1', version: 1, status: 'accepted',
    dimensions: { width, height }, regions,
  });
}
const MAX_BY_METRIC: Record<LocalOcrMetric, number> = {
  kills: 100,
  deaths: 100,
  assists: 100,
  fk: 50,
  plants: 50,
  defuses: 50,
};

export function createImmutableLocalOcrProfile(profile: LocalOcrProfile): LocalOcrProfile {
  const dimensions = Object.freeze({ ...profile.dimensions });
  const regions = Object.freeze(profile.regions.map(region => Object.freeze({
    ...region,
    rectangle: Object.freeze({ ...region.rectangle }),
  })));
  return Object.freeze({ ...profile, dimensions, regions });
}

const EXPECTED_REGION_KINDS = new Map<string, LocalOcrRegionKind>([
  ['map', 'text'],
  ['score.left', 'integer'],
  ['score.right', 'integer'],
  ...Array.from({ length: 10 }, (_, row) => [
    [`player.${row}.name`, 'text'] as [string, LocalOcrRegionKind],
    ...METRICS.map(metric => [`player.${row}.${metric}`, 'integer'] as [string, LocalOcrRegionKind]),
  ]).flat(),
]);
const COMPETITIVE_REGION_KINDS = new Map<string, LocalOcrRegionKind>([
  ...EXPECTED_REGION_KINDS,
  ...Array.from({ length: 10 }, (_, row) => [
    [`player.${row}.trades`, 'integer'] as [string, LocalOcrRegionKind],
    [`player.${row}.performanceScore`, 'integer'] as [string, LocalOcrRegionKind],
  ]).flat(),
]);
const CROPPED_REGION_KINDS = new Map<string, LocalOcrRegionKind>(Array.from({ length: 10 }, (_, row) => [
  [`player.${row}.name`, 'text'] as [string, LocalOcrRegionKind],
  ...(['kills', 'deaths', 'assists'] as const).map(metric => [`player.${row}.${metric}`, 'integer'] as [string, LocalOcrRegionKind]),
]).flat());
const ROUND_REGION_KINDS = new Map<string, LocalOcrRegionKind>([
  ['round.result', 'text'], ['averages.ourLoadout', 'integer'], ['averages.enemyLoadout', 'integer'], ['averages.ourBank', 'integer'], ['averages.enemyBank', 'integer'], ['players.names', 'text'], ['players.kills', 'text'], ['players.assists', 'text'],
  ...Array.from({ length: 10 }, (_, row) => [
    [`player.${row}.loadout`, 'integer'] as [string, LocalOcrRegionKind],
    [`player.${row}.bank`, 'integer'] as [string, LocalOcrRegionKind],
    [`player.${row}.weapon`, 'text'] as [string, LocalOcrRegionKind],
    [`player.${row}.armor`, 'text'] as [string, LocalOcrRegionKind],
  ]).flat(),
  ...Array.from({ length: 11 }, (_, row) => [
    [`event.${row}.timestamp`, 'text'] as [string, LocalOcrRegionKind],
    [`event.${row}.distance`, 'integer'] as [string, LocalOcrRegionKind],
    [`event.${row}.label`, 'text'] as [string, LocalOcrRegionKind],
  ]).flat(),
]);
const PERFORMANCE_REGION_KINDS = new Map<string, LocalOcrRegionKind>([['performance.score', 'integer'], ['performance.accolades', 'text']]);
const HEAD_TO_HEAD_REGION_KINDS = new Map<string, LocalOcrRegionKind>(Array.from({ length: 5 }, (_, row) => [
  [`h2h.${row}.kills`, 'integer'] as [string, LocalOcrRegionKind],
  [`h2h.${row}.deaths`, 'integer'] as [string, LocalOcrRegionKind],
  [`h2h.${row}.assists`, 'integer'] as [string, LocalOcrRegionKind],
  [`h2h.${row}.opponent`, 'text'] as [string, LocalOcrRegionKind],
]).flat());

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

function acceptedProfile(
  profile: LocalOcrProfile | undefined,
  dimensions: { width: number; height: number },
): LocalOcrProfile {
  const fail = (message: string): never => {
    throw Object.assign(new Error(message), { status: 422 });
  };
  if (!profile || profile.status !== 'accepted') {
    return fail('Local OCR is unavailable until a calibrated crop profile is independently accepted.');
  }
  const validateDimensions = (value: Readonly<{ width: number; height: number }>, label: string) => {
    const { width, height } = value;
    if (!isFiniteInteger(width) || !isFiniteInteger(height)
      || width <= 0 || height <= 0
      || width > LOCAL_OCR_PROFILE_LIMITS.maxDimension
      || height > LOCAL_OCR_PROFILE_LIMITS.maxDimension
      || width * height > LOCAL_OCR_PROFILE_LIMITS.maxPixels) {
      return fail(`${label} dimensions exceed the local OCR safety limits.`);
    }
  };
  validateDimensions(dimensions, 'The supplied image');
  validateDimensions(profile.dimensions, 'The local OCR crop profile');
  if (profile.dimensions.width !== dimensions.width || profile.dimensions.height !== dimensions.height) {
    return fail('The accepted local OCR crop profile does not match the supplied image dimensions.');
  }
  const expectedRegions = profile.id === 'valorant-player-table-v1' ? CROPPED_REGION_KINDS
    : profile.id === 'valorant-round-summary-v1' ? ROUND_REGION_KINDS
      : profile.id === 'valorant-performance-v1' ? PERFORMANCE_REGION_KINDS
        : profile.id === 'valorant-head-to-head-v1' ? HEAD_TO_HEAD_REGION_KINDS
          : profile.id === 'valorant-post-match-scoreboard-competitive-v1' ? COMPETITIVE_REGION_KINDS : EXPECTED_REGION_KINDS;
  if (!Array.isArray(profile.regions) || profile.regions.length !== expectedRegions.size) {
    return fail(`The local OCR crop profile must contain exactly ${expectedRegions.size} regions.`);
  }
  const seen = new Set<string>();
  for (const region of profile.regions) {
    const { left, top, width, height } = region.rectangle;
    if (seen.has(region.id)) return fail(`The local OCR crop profile repeats region ${region.id}.`);
    const expectedKind = expectedRegions.get(region.id);
    if (!expectedKind) return fail(`The local OCR crop profile has unexpected region ${region.id}.`);
    if (region.kind !== expectedKind) {
      return fail(`The local OCR crop profile has the wrong kind for region ${region.id}.`);
    }
    seen.add(region.id);
    if (!isFiniteInteger(left) || !isFiniteInteger(top)
      || !isFiniteInteger(width) || !isFiniteInteger(height)
      || left < 0 || top < 0 || width <= 0 || height <= 0
      || left + width > dimensions.width || top + height > dimensions.height) {
      return fail(`The local OCR crop profile has an invalid region ${region.id}.`);
    }
  }
  const missing = [...expectedRegions.keys()].find(id => !seen.has(id));
  if (missing) return fail(`The local OCR crop profile is missing required region ${missing}.`);
  return createImmutableLocalOcrProfile(profile);
}

function recognizedById(recognitions: readonly LocalOcrRecognition[]) {
  const byId = new Map<string, LocalOcrRecognition>();
  for (const recognition of recognitions) {
    if (!byId.has(recognition.regionId)) byId.set(recognition.regionId, recognition);
  }
  return byId;
}

function strictInteger(raw: string | undefined, max: number): number | null {
  const trimmed = raw?.trim() || '';
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function cleanScoreboardMap(raw: string | undefined): string | null {
  const cleaned = (raw || '').trim().replace(/^map\s*[-:]\s*/i, '').trim();
  return cleaned || null;
}

export function parseStrictKda(raw: string | undefined): { kills: number; deaths: number; assists: number } | null {
  const matched = (raw?.trim() || '').match(/^(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})$/);
  if (!matched) return null;
  const [kills, deaths, assists] = matched.slice(1).map(Number);
  if (kills > MAX_BY_METRIC.kills || deaths > MAX_BY_METRIC.deaths || assists > MAX_BY_METRIC.assists) return null;
  return { kills, deaths, assists };
}

type BrowserRecognitionRegion = LocalOcrRegion & { recognitionKind?: 'kda' | 'timestamp' };
export function browserRecognitionRegions(profile: LocalOcrProfile): BrowserRecognitionRegion[] {
  const fullScoreboard = profile.id === 'valorant-post-match-scoreboard-v1' || profile.id === 'valorant-post-match-scoreboard-competitive-v1';
  if (profile.id !== 'valorant-player-table-v1' && !fullScoreboard) return profile.regions.map(region => ({ ...region, ...(region.id.endsWith('.timestamp') ? { recognitionKind: 'timestamp' as const } : {}), rectangle: { ...region.rectangle } }));
  const byId = new Map(profile.regions.map(region => [region.id, region]));
  const output: BrowserRecognitionRegion[] = fullScoreboard
    ? profile.regions.filter(region => !/^player\.\d+\.(kills|deaths|assists)$/.test(region.id)).map(region => ({ ...region, rectangle: { ...region.rectangle } }))
    : [];
  for (let row = 0; row < 10; row += 1) {
    const name = byId.get(`player.${row}.name`); const kills = byId.get(`player.${row}.kills`);
    const deaths = byId.get(`player.${row}.deaths`); const assists = byId.get(`player.${row}.assists`);
    if (!name || !kills || !deaths || !assists) continue;
    if (profile.id === 'valorant-player-table-v1') output.push({ ...name, rectangle: { ...name.rectangle } });
    const left = Math.min(kills.rectangle.left, deaths.rectangle.left, assists.rectangle.left);
    const top = Math.min(kills.rectangle.top, deaths.rectangle.top, assists.rectangle.top);
    const right = Math.max(kills.rectangle.left + kills.rectangle.width, deaths.rectangle.left + deaths.rectangle.width, assists.rectangle.left + assists.rectangle.width);
    const bottom = Math.max(kills.rectangle.top + kills.rectangle.height, deaths.rectangle.top + deaths.rectangle.height, assists.rectangle.top + assists.rectangle.height);
    output.push({ id: `player.${row}.kda`, kind: 'text', recognitionKind: 'kda', rectangle: { left, top, width: right - left, height: bottom - top } });
  }
  return output;
}

export function parseLocalScoreboardRecognitions(
  recognitions: readonly LocalOcrRecognition[],
  options: { capturedAt: string; rosterPlayers: Array<{ id?: string; displayName: string }> },
) {
  const byId = recognizedById(recognitions);
  const players = Array.from({ length: 10 }, (_, row) => {
    const joinedRaw = byId.get(`player.${row}.kda`)?.text || '';
    const rawMetrics = { ...Object.fromEntries(METRICS.map(metric => [metric, byId.get(`player.${row}.${metric}`)?.text || ''])), kda: joinedRaw };
    const rawConfidence = { ...Object.fromEntries(METRICS.map(metric => [metric, byId.get(`player.${row}.${metric}`)?.confidence ?? null])), kda: byId.get(`player.${row}.kda`)?.confidence ?? null, name: byId.get(`player.${row}.name`)?.confidence ?? null };
    const parsedMetrics = Object.fromEntries(METRICS.map(metric => [metric, strictInteger(rawMetrics[metric], MAX_BY_METRIC[metric])])) as Record<LocalOcrMetric, number | null>;
    const joinedKda = parseStrictKda(joinedRaw);
    if (joinedKda) Object.assign(parsedMetrics, joinedKda);
    return {
      name: byId.get(`player.${row}.name`)?.text?.trim() || '',
      agent: null,
      ...parsedMetrics,
      acs: null,
      adr: null,
      hs: null,
      fd: null,
      // Competitive boards only; null (unknown) on custom/scrim boards.
      trades: strictInteger(byId.get(`player.${row}.trades`)?.text, 60),
      performanceScore: strictInteger(byId.get(`player.${row}.performanceScore`)?.text, 999),
      rawMetrics,
      rawConfidence,
    };
  });
  return buildScreenshotReviewDraft({
    map: cleanScoreboardMap(byId.get('map')?.text),
    ourScore: strictInteger(byId.get('score.left')?.text, 100),
    theirScore: strictInteger(byId.get('score.right')?.text, 100),
    confident: false,
    players,
  }, {
    model: `${LOCAL_OCR_RUNTIME.tesseractVersion}/eng-1.0.0/parser-v1`,
    provider: 'tesseract-local',
    capturedAt: options.capturedAt,
    rosterPlayers: options.rosterPlayers,
  });
}

export async function extractLocalScoreboardDraft(
  adapter: LocalOcrAdapter,
  image: CanvasImageSource,
  dimensions: { width: number; height: number },
  options: { capturedAt: string; rosterPlayers: Array<{ id?: string; displayName: string }> },
  profile?: LocalOcrProfile,
) {
  const immutableProfile = acceptedProfile(profile, dimensions);
  const recognitions = await adapter.recognize(image, immutableProfile);
  return parseLocalScoreboardRecognitions(recognitions, options);
}

export function preprocessRegionPixels(
  image: { width: number; height: number; data: Uint8ClampedArray },
  rectangle: LocalOcrRegion['rectangle'],
) {
  const { left, top, width, height } = rectangle;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > image.width || top + height > image.height) {
    throw new Error('OCR crop lies outside the source image.');
  }
  const luminance = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = ((top + y) * image.width + left + x) * 4;
      const value = (77 * image.data[sourceIndex] + 150 * image.data[sourceIndex + 1] + 29 * image.data[sourceIndex + 2]) >> 8;
      luminance[y * width + x] = value;
      histogram[value] += 1;
    }
  }
  let total = 0;
  let weighted = 0;
  for (let value = 0; value < 256; value += 1) {
    total += histogram[value];
    weighted += value * histogram[value];
  }
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weighted - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  let whitePixels = 0;
  for (const value of luminance) if (value > threshold) whitePixels += 1;
  // Tesseract is more stable with dark glyphs on a light field. VALORANT uses
  // light text on dark rows, so make the majority/background pixels white.
  const invert = whitePixels < luminance.length / 2;
  const output = new Uint8ClampedArray(width * height * 4);
  luminance.forEach((value, index) => {
    const thresholded = value > threshold ? 255 : 0;
    const binary = invert ? 255 - thresholded : thresholded;
    output[index * 4] = binary;
    output[index * 4 + 1] = binary;
    output[index * 4 + 2] = binary;
    output[index * 4 + 3] = 255;
  });
  return { width, height, data: output, threshold, inverted: invert };
}

export interface KdaNumberRectangle { left: number; top: number; width: number; height: number }

export function chooseRecognitionConsensus(candidates: ReadonlyArray<{ text: string; confidence: number | null }>, pattern: RegExp) {
  const valid = candidates.map(item => ({ text: item.text.trim(), confidence: Number.isFinite(item.confidence) ? Number(item.confidence) : 0 }))
    .filter(item => pattern.test(item.text));
  if (!valid.length) return { text: '', confidence: null as number | null, agreed: false };
  const groups = new Map<string, number[]>();
  for (const item of valid) groups.set(item.text, [...(groups.get(item.text) || []), item.confidence]);
  const ranked = [...groups.entries()].map(([text, confidences]) => ({ text, votes: confidences.length, confidence: Math.max(...confidences) }))
    .sort((a, b) => b.votes - a.votes || b.confidence - a.confidence);
  if (ranked[0].votes >= 2) return { text: ranked[0].text, confidence: ranked[0].confidence, agreed: true };
  if (ranked.length === 1 || ranked[0].confidence - ranked[1].confidence >= 15) return { text: ranked[0].text, confidence: ranked[0].confidence, agreed: false };
  return { text: '', confidence: Math.max(...valid.map(item => item.confidence)), agreed: false };
}

/** Preserve antialiased glyph edges while normalizing a numeric crop to dark text on white. */
export function preprocessNumericGrayscale(
  image: { width: number; height: number; data: Uint8ClampedArray },
  rectangle: LocalOcrRegion['rectangle'],
) {
  const { left, top, width, height } = rectangle;
  if (left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > image.width || top + height > image.height) throw new Error('OCR crop lies outside the source image.');
  const values = new Uint8Array(width * height); const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = ((top + y) * image.width + left + x) * 4;
    const value = (77 * image.data[source] + 150 * image.data[source + 1] + 29 * image.data[source + 2]) >> 8;
    values[y * width + x] = value; histogram[value] += 1;
  }
  const percentile = (fraction: number) => {
    const target = Math.ceil(values.length * fraction); let count = 0;
    for (let value = 0; value < 256; value += 1) { count += histogram[value]; if (count >= target) return value; }
    return 255;
  };
  const low = percentile(.05); const high = percentile(.95); const median = percentile(.5); const range = Math.max(1, high - low);
  const darkBackground = median < 128; const output = new Uint8ClampedArray(width * height * 4);
  values.forEach((value, index) => {
    const stretched = Math.max(0, Math.min(255, Math.round((value - low) * 255 / range)));
    const normalized = darkBackground ? 255 - stretched : stretched;
    output[index * 4] = output[index * 4 + 1] = output[index * 4 + 2] = normalized; output[index * 4 + 3] = 255;
  });
  return { width, height, data: output, inverted: darkBackground, low, high };
}

/** Isolate the teal/red average values from the dark VALORANT timeline. */
export function preprocessTeamColorNumber(
  image: { width: number; height: number; data: Uint8ClampedArray },
  rectangle: LocalOcrRegion['rectangle'],
  team: 'ours' | 'theirs',
) {
  const { left, top, width, height } = rectangle;
  const output = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const source = ((top + y) * image.width + left + x) * 4;
    const r = image.data[source], g = image.data[source + 1], b = image.data[source + 2];
    const primary = team === 'ours' ? g : r;
    const value = primary > 70 ? Math.max(0, 255 - (primary - 55) * 2) : 255;
    const target = (y * width + x) * 4;
    output[target] = output[target + 1] = output[target + 2] = value; output[target + 3] = 255;
  }
  return { width, height, data: output };
}

/** Split a thresholded, black-on-white K/D/A row without assuming fixed columns. */
export function segmentKdaNumberRectangles(image: { width: number; height: number; data: Uint8ClampedArray }): KdaNumberRectangle[] | null {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 5 || image.height < 5 || image.data.length !== image.width * image.height * 4) return null;
  const inkByColumn = Array.from({ length: image.width }, (_, x) => {
    let ink = 0;
    for (let y = 0; y < image.height; y += 1) if (image.data[(y * image.width + x) * 4] < 128) ink += 1;
    return ink;
  });
  const runs: Array<{ left: number; right: number }> = [];
  for (let x = 0; x < image.width; x += 1) {
    if (!inkByColumn[x]) continue;
    const left = x;
    while (x + 1 < image.width && inkByColumn[x + 1]) x += 1;
    runs.push({ left, right: x });
  }
  if (runs.length < 5) return null;
  const gaps = runs.slice(0, -1).map((run, index) => ({ index, width: runs[index + 1].left - run.right - 1 }));
  const boundaries = gaps.filter(gap => gap.width >= Math.max(2, Math.floor(image.height * .06)))
    .sort((a, b) => b.width - a.width || a.index - b.index).slice(0, 4).map(gap => gap.index).sort((a, b) => a - b);
  if (boundaries.length !== 4) return null;
  const groups: Array<{ left: number; right: number }> = [];
  let start = 0;
  for (const boundary of boundaries) { groups.push({ left: runs[start].left, right: runs[boundary].right }); start = boundary + 1; }
  groups.push({ left: runs[start].left, right: runs[runs.length - 1].right });
  if (groups.length !== 5) return null;

  const inkBounds = (group: { left: number; right: number }) => {
    let top = image.height; let bottom = -1; let count = 0;
    for (let y = 0; y < image.height; y += 1) for (let x = group.left; x <= group.right; x += 1) {
      if (image.data[(y * image.width + x) * 4] < 128) { top = Math.min(top, y); bottom = Math.max(bottom, y); count += 1; }
    }
    return { ...group, top, bottom, count };
  };
  const bounded = groups.map(inkBounds);
  if (bounded.some(group => group.count === 0 || group.bottom < group.top)) return null;
  const isSlash = (group: ReturnType<typeof inkBounds>) => {
    const height = group.bottom - group.top + 1; const width = group.right - group.left + 1;
    const numericHeight = Math.max(...[bounded[0], bounded[2], bounded[4]].map(value => value.bottom - value.top + 1));
    if (height < Math.max(3, numericHeight * .6) || width > height * .8) return false;
    const third = Math.max(1, Math.floor(height / 3));
    const centroid = (from: number, to: number) => {
      let sum = 0; let count = 0;
      for (let y = from; y <= to; y += 1) for (let x = group.left; x <= group.right; x += 1) if (image.data[(y * image.width + x) * 4] < 128) { sum += x; count += 1; }
      return count ? sum / count : null;
    };
    const top = centroid(group.top, group.top + third - 1); const bottom = centroid(group.bottom - third + 1, group.bottom);
    return top !== null && bottom !== null && Math.abs(top - bottom) >= Math.max(1, width * .2);
  };
  if (!isSlash(bounded[1]) || !isSlash(bounded[3])) return null;
  const pad = Math.max(1, Math.round(image.height * .08));
  return [bounded[0], bounded[2], bounded[4]].map(group => ({
    left: Math.max(0, group.left - pad), top: Math.max(0, group.top - pad),
    width: Math.min(image.width, group.right + pad + 1) - Math.max(0, group.left - pad),
    height: Math.min(image.height, group.bottom + pad + 1) - Math.max(0, group.top - pad),
  }));
}

export async function createBrowserLocalTesseractAdapter(): Promise<LocalOcrAdapter> {
  if (typeof document === 'undefined') throw new Error('The local OCR adapter requires a browser canvas runtime.');
  const imported = await import('tesseract.js');
  const tesseract = (imported as any).default || imported;
  const worker = await tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, {
    workerPath: LOCAL_OCR_RUNTIME.workerPath,
    corePath: LOCAL_OCR_RUNTIME.corePath,
    langPath: LOCAL_OCR_RUNTIME.langPath,
    workerBlobURL: false,
  });
  return {
    async recognize(image, profile) {
      const immutableProfile = acceptedProfile(profile, profile.dimensions);
      const results: LocalOcrRecognition[] = [];
      const source = document.createElement('canvas');
      source.width = immutableProfile.dimensions.width;
      source.height = immutableProfile.dimensions.height;
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) throw new Error('Canvas preprocessing is unavailable.');
      sourceContext.drawImage(image, 0, 0, source.width, source.height);
      const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);
      for (const region of browserRecognitionRegions(immutableProfile)) {
        // The final score keeps the plain threshold: the team-colour mask
        // reads a dimmed one-digit score as empty or as the wrong digit.
        const processed = region.id.startsWith('averages.')
          ? preprocessTeamColorNumber(sourcePixels, region.rectangle, region.id.includes('.our') ? 'ours' : 'theirs')
          : preprocessRegionPixels(sourcePixels, region.rectangle);
        const rawCrop = document.createElement('canvas'); rawCrop.width = processed.width; rawCrop.height = processed.height;
        const rawContext = rawCrop.getContext('2d');
        if (!rawContext) throw new Error('Canvas preprocessing is unavailable.');
        rawContext.putImageData(new ImageData(processed.data, processed.width, processed.height), 0, 0);
        let recognitionImage = rawCrop;
        const smallRoundCell = immutableProfile.id === 'valorant-round-summary-v1' && region.id.startsWith('player.');
        const smallHeadToHeadCell = immutableProfile.id === 'valorant-head-to-head-v1';
        if (region.layout === 'block' || region.id.startsWith('event.') || smallRoundCell || smallHeadToHeadCell) {
          const scale = region.id.startsWith('averages.') || region.id.startsWith('event.') || smallRoundCell || smallHeadToHeadCell ? 5 : 3; const padding = 16;
          const enlarged = document.createElement('canvas'); enlarged.width = processed.width * scale + padding * 2; enlarged.height = processed.height * scale + padding * 2;
          const enlargedContext = enlarged.getContext('2d'); if (!enlargedContext) throw new Error('Canvas preprocessing is unavailable.');
          enlargedContext.fillStyle = '#fff'; enlargedContext.fillRect(0, 0, enlarged.width, enlarged.height); enlargedContext.imageSmoothingEnabled = false; enlargedContext.drawImage(rawCrop, padding, padding, processed.width * scale, processed.height * scale); recognitionImage = enlarged;
        }
        if (region.recognitionKind === 'kda') {
          const segmented = segmentKdaNumberRectangles(processed);
          if (segmented) {
            const values: string[] = []; const confidences: number[] = [];
            for (const rectangle of segmented) {
              const scale = Math.max(4, Math.ceil(96 / rectangle.height)); const padding = 12;
              const grayscale = preprocessNumericGrayscale(sourcePixels, {
                left: region.rectangle.left + rectangle.left, top: region.rectangle.top + rectangle.top,
                width: rectangle.width, height: rectangle.height,
              });
              const grayscaleCrop = document.createElement('canvas'); grayscaleCrop.width = grayscale.width; grayscaleCrop.height = grayscale.height;
              const grayscaleContext = grayscaleCrop.getContext('2d'); if (!grayscaleContext) throw new Error('Canvas preprocessing is unavailable.');
              grayscaleContext.putImageData(new ImageData(grayscale.data, grayscale.width, grayscale.height), 0, 0);
              const number = document.createElement('canvas'); number.width = rectangle.width * scale + padding * 2; number.height = rectangle.height * scale + padding * 2;
              const numberContext = number.getContext('2d'); if (!numberContext) throw new Error('Canvas preprocessing is unavailable.');
              numberContext.fillStyle = '#fff'; numberContext.fillRect(0, 0, number.width, number.height); numberContext.imageSmoothingEnabled = true; numberContext.imageSmoothingQuality = 'high';
              numberContext.drawImage(grayscaleCrop, padding, padding, rectangle.width * scale, rectangle.height * scale);
              await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_WORD, tessedit_char_whitelist: '0123456789' });
              const result = await worker.recognize(number); const text = (result.data.text || '').trim(); const confidence = result.data.confidence;
              // Replay totals provide the safety check for automatic identity
              // pairing. Retain a syntactically valid digit even when
              // Tesseract is uncertain about these very small scoreboard cells.
              if (!/^\d{1,3}$/.test(text) || !Number.isFinite(confidence)) { values.length = 0; break; }
              values.push(text); confidences.push(confidence);
            }
            if (values.length === 3) {
              results.push({ regionId: region.id, text: values.join('/'), confidence: confidences.length ? Math.min(...confidences) : null });
            }
            else results.push({ regionId: region.id, text: '', confidence: confidences.length ? Math.min(...confidences) : null });
            continue;
          }
          const scale = Math.max(4, Math.ceil(96 / processed.height)); const padding = 12;
          const padded = document.createElement('canvas'); padded.width = processed.width * scale + padding * 2; padded.height = processed.height * scale + padding * 2;
          const paddedContext = padded.getContext('2d');
          if (!paddedContext) throw new Error('Canvas preprocessing is unavailable.');
          paddedContext.fillStyle = '#fff'; paddedContext.fillRect(0, 0, padded.width, padded.height); paddedContext.imageSmoothingEnabled = false;
          paddedContext.drawImage(rawCrop, padding, padding, processed.width * scale, processed.height * scale); recognitionImage = padded;
        }
        await worker.setParameters({
          tessedit_pageseg_mode: region.layout === 'block' ? tesseract.PSM.SINGLE_BLOCK : tesseract.PSM.SINGLE_LINE,
          preserve_interword_spaces: region.layout === 'block' ? '1' : '0',
          ...(region.recognitionKind === 'timestamp' ? { tessedit_char_whitelist: '0123456789:.' }
            : region.recognitionKind === 'kda' ? { tessedit_char_whitelist: '' }
            : region.kind === 'integer' ? { tessedit_char_whitelist: '0123456789' } : { tessedit_char_whitelist: '' }),
        });
        const result = await worker.recognize(recognitionImage);
        let confidence = Number.isFinite(result.data.confidence) ? result.data.confidence : null;
        let text = region.recognitionKind === 'kda' && confidence === null ? '' : result.data.text || '';
        // Generic document OCR is weakest on VALORANT's tiny numeric glyphs.
        // Retry only uncertain cells with antialias-preserving grayscale and
        // require agreement or a decisive confidence gap; ambiguity becomes
        // unknown rather than a plausible-looking wrong number.
        if (region.kind === 'integer' && region.recognitionKind !== 'kda' && (!/^\s*\d{1,5}\s*$/.test(text) || (confidence ?? 0) < 75)) {
          const grayscale = preprocessNumericGrayscale(sourcePixels, region.rectangle);
          const crop = document.createElement('canvas'); crop.width = grayscale.width; crop.height = grayscale.height;
          const context = crop.getContext('2d'); if (!context) throw new Error('Canvas preprocessing is unavailable.');
          context.putImageData(new ImageData(grayscale.data, grayscale.width, grayscale.height), 0, 0);
          const scale = Math.max(4, Math.ceil(96 / grayscale.height)); const padding = 12;
          const enlarged = document.createElement('canvas'); enlarged.width = grayscale.width * scale + padding * 2; enlarged.height = grayscale.height * scale + padding * 2;
          const enlargedContext = enlarged.getContext('2d'); if (!enlargedContext) throw new Error('Canvas preprocessing is unavailable.');
          enlargedContext.fillStyle = '#fff'; enlargedContext.fillRect(0, 0, enlarged.width, enlarged.height); enlargedContext.imageSmoothingEnabled = true; enlargedContext.imageSmoothingQuality = 'high'; enlargedContext.drawImage(crop, padding, padding, grayscale.width * scale, grayscale.height * scale);
          await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SINGLE_WORD, tessedit_char_whitelist: '0123456789' });
          const retry = await worker.recognize(enlarged);
          const selected = chooseRecognitionConsensus([
            { text, confidence },
            { text: retry.data.text || '', confidence: Number.isFinite(retry.data.confidence) ? retry.data.confidence : null },
          ], /^\d{1,5}$/);
          text = selected.text; confidence = selected.confidence;
        }
        results.push({ regionId: region.id, text, confidence });
      }
      return results;
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
