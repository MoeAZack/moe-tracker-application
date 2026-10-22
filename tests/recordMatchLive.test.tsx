import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MatchLogRounds from '../src/components/MatchLogRounds';
import { navWorkspaceTabs, routableWorkspaceTabs, workspaceDestinations, workspaceSectionTab } from '../src/utils/workspaceRoute';

const data: any = { settings: { theme: 'midnight', maps: ['Haven'], stats: {}, weights: {} }, rosterPlayers: [], matches: [], playerStats: [], rounds: [], vetos: [], strats: [], stratRuns: [] };
const noop = async () => null;
const render = (onRecordLive?: () => void) => renderToStaticMarkup(<MatchLogRounds data={data} theme={{ primaryBg: 'bg', text: 'text' }} onSaveMatch={noop} onRemove={noop} onSaveRounds={noop} onSaveVeto={noop} onRecordLive={onRecordLive} />);

describe('live logging is a way to record a match', () => {
  it('offers live, round-by-round recording next to Record match only where it can open', () => {
    expect(render(() => undefined)).toContain('Record live, round by round');
    expect(render()).not.toContain('Record live, round by round');
    expect(render()).toContain('Record match');
  });

  it('has no nav entry of its own but still opens by link, under Match Review', () => {
    const input = { desktopMode: true, role: 'coach', showTryoutComparisons: false, activeTab: 'livelogger' as const };
    expect(routableWorkspaceTabs(input)).toContain('livelogger');
    expect(navWorkspaceTabs(input)).not.toContain('livelogger');
    expect(workspaceDestinations(navWorkspaceTabs(input)).find(entry => entry.destination === 'Matches')!.tabs).toEqual(['matches', 'replays', 'vod', 'vodsubmit']);
    expect(workspaceSectionTab('livelogger')).toBe('matches');
    expect(workspaceSectionTab('replays')).toBe('replays');
  });
});
