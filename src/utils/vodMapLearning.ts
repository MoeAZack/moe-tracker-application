// Map names the coach corrected on imported VOD games. A correction teaches
// the tokens of that agent-select read that look like the corrected map's
// name (a misread such as "havfn" for Haven); the next VOD whose read holds
// such a token resolves to that map. As with learned scoreboard rules, any
// sighting of the token on a game confirmed as another map counts against the
// rule, and the rule stays off unless its corrections outnumber those.
export type MapReadSample = { token: string; map: string; kind: 'correction' | 'kept'; source: string; at: string };
export type MapHint = { token: string; map: string };

const STORAGE_KEY = 'moetracker.vodMapReads.v1';
const MAX_SAMPLES = 2000;
const normalized = (value: string) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0]; previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length];
}

/** Tokens of a read close enough to the map's name to be a misread of it. */
export function learnableTokens(mapRead: readonly string[], map: string) {
  const target = normalized(map); if (target.length < 3) return [];
  const allowed = Math.max(1, Math.floor(target.length / 4));
  return [...new Set(mapRead.filter(token => /^[a-z0-9]{3,20}$/.test(token) && Math.abs(token.length - target.length) <= allowed && editDistance(token, target) <= allowed))];
}

export function mapHints(samples: readonly MapReadSample[]): MapHint[] {
  const byToken = new Map<string, Map<string, { corrections: number; total: number }>>();
  for (const sample of samples) {
    const maps = byToken.get(sample.token) || new Map(); byToken.set(sample.token, maps);
    const entry = maps.get(sample.map) || { corrections: 0, total: 0 }; maps.set(sample.map, entry);
    entry.total += 1; if (sample.kind === 'correction') entry.corrections += 1;
  }
  const hints: MapHint[] = [];
  for (const [token, maps] of byToken) {
    const all = [...maps.values()].reduce((sum, entry) => sum + entry.total, 0);
    for (const [map, entry] of maps) if (entry.corrections >= 1 && entry.corrections > all - entry.total) hints.push({ token, map });
  }
  return hints.slice(0, 200);
}

const now = () => new Date().toISOString();

/**
 * The coach set a game's map. Its read teaches tokens that resemble the new
 * map, and any learned token that pointed this game elsewhere gets a sighting
 * against it. Sightings this game recorded before are replaced.
 */
export function recordMapCorrection(samples: readonly MapReadSample[], game: { source: string; mapRead?: readonly string[]; firedTokens?: readonly string[]; map: string }) {
  const kept = samples.filter(sample => !(sample.source === game.source && sample.kind === 'kept'));
  const learned = learnableTokens(game.mapRead || [], game.map);
  const added: MapReadSample[] = [
    ...learned.map(token => ({ token, map: game.map, kind: 'correction' as const, source: game.source, at: now() })),
    ...(game.firedTokens || []).filter(token => !learned.includes(token)).map(token => ({ token, map: game.map, kind: 'kept' as const, source: game.source, at: now() })),
  ];
  return { samples: [...kept, ...added].slice(-MAX_SAMPLES), learned };
}

/** Games that kept their map: every token already tied to another map is sighted on this one. */
export function recordConfirmedMaps(samples: readonly MapReadSample[], games: ReadonlyArray<{ source: string; mapRead?: readonly string[]; map: string | null }>) {
  const known = new Map<string, Set<string>>();
  for (const sample of samples) { const maps = known.get(sample.token) || new Set(); maps.add(sample.map); known.set(sample.token, maps); }
  const added: MapReadSample[] = [];
  for (const game of games) {
    if (!game.map) continue;
    for (const token of new Set(game.mapRead || [])) if ([...(known.get(token) || [])].some(map => map !== game.map)) added.push({ token, map: game.map, kind: 'kept', source: game.source, at: now() });
  }
  return [...samples, ...added].slice(-MAX_SAMPLES);
}

export function loadMapReadSamples(): MapReadSample[] {
  try { const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]'); return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.token === 'string' && typeof item.map === 'string') : []; }
  catch { return []; }
}

export function saveMapReadSamples(samples: readonly MapReadSample[]) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES))); } catch { /* Learning is a convenience; the import never fails on storage. */ }
}
