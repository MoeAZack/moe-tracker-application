export const LOCAL_SCOREBOARD_CACHE_VERSION = 'scoreboard-result/v2';
export const LOCAL_SCOREBOARD_CACHE_LIMIT = 40;

const normalize = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('en');

/** Cache keys separate immutable image pixels from the small identity/settings
 * projection. Ordinary app updates reuse OCR; only an explicit extractor
 * version bump or a changed roster/selection invalidates the affected entry. */
export function localScoreboardCacheKey(input: {
  imageSha256: string;
  rosterPlayers: Array<{ id?: string; displayName: string }>;
  selection?: unknown;
  extractorVersion?: string;
}) {
  const roster = input.rosterPlayers.map(player => `${player.id || ''}:${normalize(player.displayName)}`).sort();
  return JSON.stringify([input.extractorVersion || LOCAL_SCOREBOARD_CACHE_VERSION, input.imageSha256, roster, input.selection || null]);
}

export function pruneOcrResultCache<T extends { usedAt: string }>(entries: Record<string, T>, limit = LOCAL_SCOREBOARD_CACHE_LIMIT) {
  return Object.fromEntries(Object.entries(entries).sort(([, left], [, right]) => Date.parse(right.usedAt) - Date.parse(left.usedAt)).slice(0, Math.max(1, limit)));
}

