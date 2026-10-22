import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import WebsiteMapSummary from '../src/components/WebsiteMapSummary';
import WebsiteMatchLog from '../src/components/WebsiteMatchLog';
import { toWebsiteTrackerData } from '../lib/publicData';
import { buildTryoutComparison } from '../lib/tryoutComparison';
import { routableWorkspaceTabs } from '../src/utils/workspaceRoute';

const data: any = {
  settings: { teamName: 'Synthetic Squad' },
  matches: [{ id: 'm1', date: '2026-10-13', type: 'Scrim', opponent: 'Other', map: 'Haven', ourScore: 13, theirScore: 9 }],
  playerStats: [{ id: 'p1', matchId: 'm1', player: 'Alpha', kills: 20, deaths: 10, assists: 4 }],
};
const theme = { cardBg: 'surface-card', border: 'border-white/10' };

describe('reduced website surface', () => {
  it('renders accepted match and map summaries without desktop evidence controls', () => {
    const html = renderToStaticMarkup(<><WebsiteMatchLog data={data} theme={theme} /><WebsiteMapSummary data={data} theme={theme} /></>);
    expect(html).toContain('Coach-accepted summaries'); expect(html).toContain('13–9'); expect(html).toContain('Alpha · 20/10/4'); expect(html).toContain('Map pool');
    expect(html).not.toMatch(/Replay Evidence|Import scoreboard|VOD Review|Round evidence|Local crash logs|Portable export/);
  });

  it('loads the summary API and limits website navigation to retained portal areas', () => {
    const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("desktopMode ? '/api/data' : '/api/website-summary'");
    expect(routableWorkspaceTabs({ desktopMode: false, role: 'coach' })).toEqual(['dashboard', 'calendar', 'matches', 'maps', 'roster', 'playerstats', 'aitactical', 'vodsubmit', 'economy', 'comparisons', 'aihub']);
    expect(app).toContain("desktopMode && role === 'coach'");
    expect(app).toContain('desktopMode && scrimOpen');
  });

  it('retains safe comparison acceptance and context without exposing raw provenance', () => {
    const first = '00000000-0000-4000-8000-000000000001';
    const second = '00000000-0000-4000-8000-000000000002';
    const raw: any = {
      settings: {}, rosterPlayers: [{ id: first, displayName: 'One' }, { id: second, displayName: 'Two' }], coreMemberships: [], tryoutBatches: [], practiceBlocks: [],
      matches: [{ id: 'm1', date: '2026-10-15T12:00:00Z', type: 'Scrim', opponent: 'Team', opponentCategory: 'academy', map: 'Haven', attW: 6, attL: 4, defW: 7, defL: 5, sourceMetadata: { method: 'manual', capturedAt: '2026-10-15T12:01:00Z', provider: 'private-provider' } }],
      playerStats: [first, second].map((playerId, index) => ({ id: `s${index}`, matchId: 'm1', playerId, player: index ? 'Two' : 'One', displayNameSnapshot: index ? 'Two' : 'One', appearanceType: index ? 'core' : 'tryout', agent: 'Sova', roleSnapshot: 'initiator', kills: 10 - index, deaths: 5, assists: 3, kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, fk: 2, fd: 1, sourceMetadata: { method: 'manual', capturedAt: '2026-10-15T12:01:00Z', provider: 'private-provider' } })),
      rounds: [], schedule: [], goals: [], soloq: []
    };
    const website: any = toWebsiteTrackerData(raw, 'coach');
    expect(website.matches[0]).toMatchObject({ opponentCategory: 'academy', comparisonEvidence: { accepted: true } });
    expect(website.playerStats[0]).toMatchObject({ roleSnapshot: 'initiator', comparisonEvidence: { openingAccepted: true } });
    expect(JSON.stringify(website)).not.toContain('private-provider');
    const result = buildTryoutComparison(website, { mode: 'player-player', leftId: first, rightId: second, minimumSamples: 1, filters: { roles: ['initiator'], opponentCategories: ['academy'] } });
    expect(result.metrics.find(metric => metric.id === 'kd')?.left).toBe(2);
    expect(result.metrics.find(metric => metric.id === 'fk')?.left).toBe(2);
  });
});
