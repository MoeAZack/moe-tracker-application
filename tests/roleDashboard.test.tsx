import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Dashboard from '../src/components/Dashboard';
import { createSeed } from '../lib/seed';

const theme = { cardBg: 'surface-card', border: 'border-white/10', text: 'text-cyan-300' };
const data = {
  ...createSeed(),
  settings: { ...createSeed().settings, teamName: 'Moe Team' },
  rosterPlayers: [{ id: 'player-1', displayName: 'Ahmed', retiredAt: null }],
  matches: [{ id: 'match-1', date: '2026-10-13', type: 'Practice', opponent: 'Rivals', map: 'Haven', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9 }],
  playerStats: [{ id: 'stat-1', matchId: 'match-1', playerId: 'player-1', player: 'Ahmed', displayNameSnapshot: 'Ahmed', agent: 'Omen', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: 20, deaths: 10, assists: 5, hs: 40, adr: 160, fk: 4, fd: 2 }],
} as any;

describe('role-aware dashboard', () => {
  it('opens player sessions on a personal-first performance brief', () => {
    const html = renderToStaticMarkup(<Dashboard data={data} theme={theme} role="player" username="Ahmed" onOpenMatch={() => {}} />);
    expect(html).toContain('Ahmed · personal brief');
    expect(html).toContain('My performance');
    expect(html).toContain('20 / 10 / 5');
    expect(html).toContain('40.0%');
    expect(html).not.toContain('Coach comparison');
  });

  it('keeps coach sessions team-first with comparison controls', () => {
    const html = renderToStaticMarkup(<Dashboard data={data} theme={theme} role="coach" username="Coach" onOpenMatch={() => {}} />);
    expect(html).toContain('Coach brief');
    expect(html).toContain('Coach comparison');
    expect(html).not.toContain('My performance');
  });

  it('does not infer an unpaired player identity from a matching display name', () => {
    const unpaired = { ...data, rosterPlayers: [] };
    const html = renderToStaticMarkup(<Dashboard data={unpaired} theme={theme} role="player" username="Ahmed" onOpenMatch={() => {}} />);
    expect(html).toContain('no personal evidence is inferred from its display name');
    expect(html).not.toContain('20 / 10 / 5');
  });
});
