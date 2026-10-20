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

export function replaceWorkspaceRoute(route: WorkspaceRoute) {
  const hash = workspaceRouteHash(route);
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
}
