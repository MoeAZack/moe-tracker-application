import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import WebsiteMapSummary from '../src/components/WebsiteMapSummary';
import WebsiteMatchLog from '../src/components/WebsiteMatchLog';

const data: any = {
  settings: { teamName: 'TEAM' },
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
    expect(app).toContain("['dashboard', 'calendar', 'matches', 'economy', 'maps', 'roster']");
    expect(app).toContain("desktopMode && role === 'coach'");
    expect(app).toContain('desktopMode && scrimOpen');
  });
});
