import { describe, expect, it } from 'vitest';
import { destinationEntryTab, evidenceReviewTab, focusReviewContext, navWorkspaceTabs, parseWorkspaceRoute, resolveWorkspaceTab, routableWorkspaceTabs, syncWorkspaceRoute, WORKSPACE_DESTINATIONS, WORKSPACE_TAB_IDS, workspaceDestination, workspaceDestinations, workspaceHistoryMode, workspaceRouteHash } from '../src/utils/workspaceRoute';

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

/** A browser-like history: pushState adds an entry, replaceState rewrites the current one, back() moves to the previous. */
function fakeHistory(initialHash: string) {
  const entries = [initialHash]; let index = 0;
  const location = { hash: initialHash };
  return {
    location,
    entries,
    history: {
      pushState: (_state: unknown, _title: string, url?: string | URL | null) => { entries.splice(index + 1); entries.push(String(url)); index += 1; location.hash = String(url); },
      replaceState: (_state: unknown, _title: string, url?: string | URL | null) => { entries[index] = String(url); location.hash = String(url); },
    },
    back: () => { if (index > 0) index -= 1; location.hash = entries[index]; return parseWorkspaceRoute(location.hash); },
  };
}

describe('workspace history', () => {
  it('Back returns to the previous workspace after opening a match', () => {
    const browser = fakeHistory('#/home');
    const home = parseWorkspaceRoute(browser.location.hash);
    expect(syncWorkspaceRoute(home, null, browser.history, browser.location)).toBeNull();
    const review = { tab: 'vod' as const, matchId: 'match-1', roundNo: null };
    expect(syncWorkspaceRoute(review, home, browser.history, browser.location)).toBe('push');
    const round = { ...review, roundNo: 7 };
    expect(syncWorkspaceRoute(round, review, browser.history, browser.location)).toBe('replace');
    expect(browser.entries).toEqual(['#/home', '#/vod-review?match=match-1&round=7']);
    expect(browser.back()).toEqual(home);
  });

  it('pushes a new entry when only the match changes, and replaces when only the round changes', () => {
    const a = { tab: 'replays' as const, matchId: 'a', roundNo: 3 };
    expect(workspaceHistoryMode(a, { ...a, matchId: 'b' })).toBe('push');
    expect(workspaceHistoryMode(a, { ...a, roundNo: 4 })).toBe('replace');
    expect(workspaceHistoryMode(null, a)).toBe('replace');
  });
});

describe('workspace tab resolution', () => {
  it('opens #/tryouts even when the Tryout comparisons nav entry is hidden', () => {
    const requested = parseWorkspaceRoute('#/tryouts').tab;
    for (const desktopMode of [true, false]) {
      expect(resolveWorkspaceTab(requested, routableWorkspaceTabs({ desktopMode, role: 'coach' }))).toBe('comparisons');
      expect(resolveWorkspaceTab(requested, routableWorkspaceTabs({ desktopMode, role: null }))).toBe('comparisons');
    }
  });

  it('lists Tryout comparisons in the nav only when shown or open', () => {
    const base = { desktopMode: true, role: 'coach', activeTab: 'dashboard' as const };
    expect(navWorkspaceTabs({ ...base, showTryoutComparisons: false })).not.toContain('comparisons');
    expect(navWorkspaceTabs({ ...base, showTryoutComparisons: true })).toContain('comparisons');
    expect(navWorkspaceTabs({ ...base, showTryoutComparisons: false, activeTab: 'comparisons' })).toContain('comparisons');
  });

  it('still sends a player off coach-only workspaces and the web off desktop-only ones', () => {
    expect(resolveWorkspaceTab('roster', routableWorkspaceTabs({ desktopMode: true, role: 'player' }))).toBe('dashboard');
    expect(resolveWorkspaceTab('aitactical', routableWorkspaceTabs({ desktopMode: true, role: 'player' }))).toBe('dashboard');
    expect(resolveWorkspaceTab('playerstats', routableWorkspaceTabs({ desktopMode: true, role: 'player' }))).toBe('playerstats');
    expect(resolveWorkspaceTab('livelogger', routableWorkspaceTabs({ desktopMode: false, role: 'coach' }))).toBe('dashboard');
    expect(resolveWorkspaceTab('aitactical', routableWorkspaceTabs({ desktopMode: false, role: 'coach' }))).toBe('aitactical');
  });
});

describe('review context focus', () => {
  it('keeps the selected round when another surface focuses the same match', () => {
    expect(focusReviewContext({ matchId: 'm1', roundNo: 9 }, 'm1')).toEqual({ matchId: 'm1', roundNo: 9 });
  });

  it('takes the target round, and clears a round that belonged to another match', () => {
    expect(focusReviewContext({ matchId: 'm1', roundNo: 9 }, 'm2', 4)).toEqual({ matchId: 'm2', roundNo: 4 });
    expect(focusReviewContext({ matchId: 'm1', roundNo: 9 }, 'm2')).toEqual({ matchId: 'm2', roundNo: null });
    expect(focusReviewContext({ matchId: 'm1', roundNo: 9 }, null, 3)).toEqual({ matchId: null, roundNo: null });
  });
});

describe('evidence link destination', () => {
  it('opens VOD Review only where the role and surface can use it', () => {
    expect(evidenceReviewTab(routableWorkspaceTabs({ desktopMode: true, role: 'coach' }))).toBe('vod');
    expect(evidenceReviewTab(routableWorkspaceTabs({ desktopMode: true, role: 'player' }))).toBe('matches');
    expect(evidenceReviewTab(routableWorkspaceTabs({ desktopMode: false, role: 'coach' }))).toBe('matches');
    expect(evidenceReviewTab(routableWorkspaceTabs({ desktopMode: false, role: 'player' }))).toBe('matches');
  });

  it('always lands on a tab the session can open', () => {
    for (const desktopMode of [true, false]) for (const role of ['coach', 'player', null]) {
      const routable = routableWorkspaceTabs({ desktopMode, role });
      expect(routable).toContain(evidenceReviewTab(routable));
    }
  });
});

describe('website match log focus', () => {
  it('lists the linked match first and marks it', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { default: WebsiteMatchLog } = await import('../src/components/WebsiteMatchLog');
    const data: any = { matches: [{ id: 'new', date: '2026-10-21', opponent: 'Newer' }, { id: 'old', date: '2026-10-01', opponent: 'Linked' }], playerStats: [] };
    const html = renderToStaticMarkup(createElement(WebsiteMatchLog, { data, theme: { cardBg: '', border: '' }, focusMatchId: 'old' }));
    expect(html.indexOf('Linked')).toBeLessThan(html.indexOf('Newer'));
    expect(html).toMatch(/aria-current="true"[^>]*>\s*<div><h2[^>]*>Linked/);
  });
});

describe('workspace destinations', () => {
  it('groups every screen under exactly one of seven destinations, in nav order', () => {
    expect(WORKSPACE_DESTINATIONS).toHaveLength(7);
    const all = workspaceDestinations(WORKSPACE_TAB_IDS);
    expect(all.map(entry => entry.destination)).toEqual([...WORKSPACE_DESTINATIONS]);
    expect(all.flatMap(entry => entry.tabs).sort()).toEqual([...WORKSPACE_TAB_IDS].sort());
    expect(all.find(entry => entry.destination === 'Matches')!.tabs).toEqual(['matches', 'replays', 'livelogger', 'vod', 'vodsubmit']);
  });

  it('leaves out destinations with no visible screen for the website and for players', () => {
    const web = workspaceDestinations(navWorkspaceTabs({ desktopMode: false, role: 'coach', showTryoutComparisons: false, activeTab: 'dashboard' }));
    expect(web.map(entry => entry.destination)).toEqual(['Home', 'Matches', 'Team', 'Players', 'Coaching']);
    expect(web.find(entry => entry.destination === 'Matches')!.tabs).toEqual(['matches', 'vodsubmit']);
    const player = workspaceDestinations(navWorkspaceTabs({ desktopMode: true, role: 'player', showTryoutComparisons: false, activeTab: 'dashboard' }));
    expect(player.map(entry => entry.destination)).not.toContain('Settings');
  });

  it('reopens the section last used in a destination, else its first section', () => {
    expect(destinationEntryTab(['matches', 'replays', 'vod'], 'vod')).toBe('vod');
    expect(destinationEntryTab(['matches', 'replays'], 'vod')).toBe('matches');
    expect(destinationEntryTab(['economy', 'maps'])).toBe('economy');
    expect(destinationEntryTab([], 'maps')).toBeNull();
    expect(workspaceDestination('aitactical')).toBe('Coaching');
  });
});
