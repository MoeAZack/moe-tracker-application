// Where a match's or a player row's numbers came from, in one vocabulary the
// whole app shows as a small chip. Read only from what the entry records about
// itself; an entry that records nothing is 'unknown' and gets no chip.

export type StatSourceKind = 'replay' | 'screenshot' | 'vod' | 'live' | 'manual' | 'import' | 'unknown';

export const STAT_SOURCE_LABELS: Record<StatSourceKind, { label: string; detail: string }> = {
  replay: { label: 'Replay', detail: 'Read from an accepted replay file.' },
  screenshot: { label: 'Screenshot', detail: 'Read from a scoreboard screenshot a coach reviewed.' },
  vod: { label: 'VOD', detail: 'Read from a submitted VOD.' },
  live: { label: 'Live', detail: 'Recorded round by round while the match was played.' },
  manual: { label: 'Manual', detail: 'Typed in by hand.' },
  import: { label: 'Imported', detail: 'Imported from an outside provider.' },
  unknown: { label: 'Source unknown', detail: 'This entry does not record where its numbers came from.' },
};

const SCREENSHOT_SOURCES = new Set(['screenshot', 'scrim-import', 'screenshot-manual-fallback']);

export function entrySource(entry: { source?: unknown; sourceMetadata?: { method?: unknown; provider?: unknown } | null } | null | undefined): StatSourceKind {
  const method = String(entry?.sourceMetadata?.method ?? '');
  const provider = String(entry?.sourceMetadata?.provider ?? '');
  const source = String(entry?.source ?? '');
  if (provider === 'vrfkit' || method === 'replay-envelope' || source === 'replay') return 'replay';
  if (method === 'screenshot' || SCREENSHOT_SOURCES.has(source)) return 'screenshot';
  if (method === 'vod-submission' || source === 'vod-submission') return 'vod';
  if (method === 'live-logger' || source === 'live-logger') return 'live';
  if (method === 'provider-import') return 'import';
  if (method === 'manual' || source === 'manual') return 'manual';
  return 'unknown';
}

/** A match backed by an accepted replay counts as replay even when the match row itself was typed first. */
export function matchSource(match: any, playerStats: any[] = []): StatSourceKind {
  if (playerStats.some(row => row?.matchId === match?.id && entrySource(row) === 'replay')) return 'replay';
  return entrySource(match);
}

/** "From 3 replay, 2 screenshot and 1 manual matches": the mix behind a table that sums many matches. */
export function sourceMixText(matches: any[], playerStats: any[] = []): string {
  if (!matches.length) return '';
  const counts = new Map<StatSourceKind, number>();
  for (const match of matches) { const kind = matchSource(match, playerStats); counts.set(kind, (counts.get(kind) || 0) + 1); }
  const order: StatSourceKind[] = ['replay', 'screenshot', 'vod', 'live', 'manual', 'import', 'unknown'];
  const parts = order.filter(kind => counts.get(kind)).map(kind => `${counts.get(kind)} ${kind === 'unknown' ? 'unrecorded-source' : kind === 'vod' ? 'VOD' : STAT_SOURCE_LABELS[kind].label.toLowerCase()}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `From ${list} match${matches.length === 1 ? '' : 'es'}.`;
}
