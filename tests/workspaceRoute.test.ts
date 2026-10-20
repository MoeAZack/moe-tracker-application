import { describe, expect, it } from 'vitest';
import { parseWorkspaceRoute, workspaceRouteHash } from '../src/utils/workspaceRoute';

describe('workspace deep links', () => {
  it('round-trips a review route with match and round context', () => {
    const hash = workspaceRouteHash({ tab: 'vod', matchId: 'match 1', roundNo: 12 });
    expect(hash).toBe('#/vod-review?match=match+1&round=12');
    expect(parseWorkspaceRoute(hash)).toEqual({ tab: 'vod', matchId: 'match 1', roundNo: 12 });
  });

  it('falls back safely for unknown routes and invalid rounds', () => {
    expect(parseWorkspaceRoute('#/missing?round=zero')).toEqual({ tab: 'dashboard', matchId: null, roundNo: null });
  });
});
