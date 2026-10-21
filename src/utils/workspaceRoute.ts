export const WORKSPACE_TAB_IDS = ['dashboard', 'calendar', 'matches', 'replays', 'maps', 'comps', 'roster', 'playerstats', 'settings', 'livelogger', 'aitactical', 'vod', 'vodsubmit', 'lineups', 'economy', 'comparisons'] as const;
export type WorkspaceTabId = typeof WORKSPACE_TAB_IDS[number];

const pathByTab: Record<WorkspaceTabId, string> = {
  dashboard: 'home', calendar: 'schedule', matches: 'match-review', replays: 'replay-evidence', maps: 'map-analysis',
  comps: 'compositions', roster: 'roster', playerstats: 'player-stats', settings: 'settings', livelogger: 'live-logger',
  aitactical: 'coach-workspace', vod: 'vod-review', vodsubmit: 'vod-submission', lineups: 'lineups', economy: 'economy', comparisons: 'tryouts',
};
const tabByPath = new Map(Object.entries(pathByTab).map(([tab, path]) => [path, tab as WorkspaceTabId]));

export interface WorkspaceRoute { tab: WorkspaceTabId; matchId: string | null; roundNo: number | null }

export function parseWorkspaceRoute(hash: string): WorkspaceRoute {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const round = Number(params.get('round'));
  return {
    tab: tabByPath.get(path) || 'dashboard',
    matchId: params.get('match')?.trim() || null,
    roundNo: Number.isSafeInteger(round) && round > 0 ? round : null,
  };
}

export function workspaceRouteHash(route: WorkspaceRoute): string {
  const params = new URLSearchParams();
  if (route.matchId) params.set('match', route.matchId);
  if (route.roundNo) params.set('round', String(route.roundNo));
  const query = params.toString();
  return `#/${pathByTab[route.tab]}${query ? `?${query}` : ''}`;
}

export type WorkspaceHistoryMode = 'push' | 'replace';
type HistoryLike = Pick<History, 'pushState' | 'replaceState'>;

/**
 * A new tab or match is a new history entry, so Back returns to it. Stepping
 * rounds inside the same match, and the first sync of a page load, replace.
 */
export function workspaceHistoryMode(previous: WorkspaceRoute | null, next: WorkspaceRoute): WorkspaceHistoryMode {
  return previous && (previous.tab !== next.tab || previous.matchId !== next.matchId) ? 'push' : 'replace';
}

/** Write the route into the URL; returns how it was written, or null when the URL already matches. */
export function syncWorkspaceRoute(route: WorkspaceRoute, previous: WorkspaceRoute | null, history: HistoryLike = window.history, location: Pick<Location, 'hash'> = window.location): WorkspaceHistoryMode | null {
  const hash = workspaceRouteHash(route);
  if (location.hash === hash) return null;
  const mode = workspaceHistoryMode(previous, route);
  if (mode === 'push') history.pushState(null, '', hash); else history.replaceState(null, '', hash);
  return mode;
}

export interface ReviewContext { matchId: string | null; roundNo: number | null }

/**
 * Focus a match from another surface. A target round wins; without one, the
 * selected round survives only while the match stays the same.
 */
export function focusReviewContext(current: ReviewContext, matchId: string | null, roundNo?: number | null): ReviewContext {
  if (roundNo !== undefined) return { matchId, roundNo: matchId ? roundNo : null };
  return { matchId, roundNo: matchId && matchId === current.matchId ? current.roundNo : null };
}

const WEB_SURFACE_TABS: ReadonlySet<WorkspaceTabId> = new Set(['dashboard', 'calendar', 'matches', 'vodsubmit', 'economy', 'aitactical', 'maps', 'roster', 'playerstats', 'comparisons']);
const COACH_ONLY_TABS: ReadonlySet<WorkspaceTabId> = new Set(['settings', 'livelogger', 'vod', 'aitactical', 'roster']);

/**
 * Tabs a link may open: the surface (desktop or web) and the role decide.
 * Showing Tryout comparisons in the nav is a display preference, so
 * `#/tryouts` still opens it when the nav entry is hidden.
 */
export function routableWorkspaceTabs(input: { desktopMode: boolean; role: string | null }): WorkspaceTabId[] {
  return WORKSPACE_TAB_IDS.filter(tab => (input.desktopMode || WEB_SURFACE_TABS.has(tab)) && !(input.role === 'player' && COACH_ONLY_TABS.has(tab)));
}

/** Tabs listed in the nav: routable ones, with Tryout comparisons only when shown or currently open. */
export function navWorkspaceTabs(input: { desktopMode: boolean; role: string | null; showTryoutComparisons: boolean; activeTab: WorkspaceTabId }): WorkspaceTabId[] {
  return routableWorkspaceTabs(input).filter(tab => tab !== 'comparisons' || input.showTryoutComparisons || input.activeTab === 'comparisons');
}

/** The tab to show for a requested route; an unusable tab falls back to Home. */
export function resolveWorkspaceTab(requested: WorkspaceTabId, routable: readonly WorkspaceTabId[]): WorkspaceTabId {
  return routable.includes(requested) ? requested : 'dashboard';
}
