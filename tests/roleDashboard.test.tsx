import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Dashboard from '../src/components/Dashboard';
import { createSeed } from '../lib/seed';

const theme = { cardBg: 'surface-card', border: 'border-white/10', text: 'text-cyan-300' };
const data = {
  ...createSeed(),
  authenticatedViewer: { playerId: 'player-1' },
  settings: { ...createSeed().settings, teamName: 'Moe Team' },
  rosterPlayers: [{ id: 'player-1', displayName: 'Ahmed', retiredAt: null }],
  matches: [{ id: 'match-1', date: '2026-10-13', type: 'Practice', opponent: 'Rivals', map: 'Haven', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9 }],
  playerStats: [{ id: 'stat-1', matchId: 'match-1', playerId: 'player-1', player: 'Ahmed', displayNameSnapshot: 'Ahmed', agent: 'Omen', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: 20, deaths: 10, assists: 5, hs: 40, adr: 160, fk: 4, fd: 2 }],
} as any;

describe('role-aware dashboard', () => {
  it('opens player sessions on a personal-first performance brief', () => {
    const renamed = { ...data, rosterPlayers: [{ ...data.rosterPlayers[0], displayName: 'Ahmed Renamed' }] };
    const html = renderToStaticMarkup(<Dashboard data={renamed} theme={theme} role="player" username="Different Login Label" onOpenMatch={() => {}} />);
    expect(html).toContain('Different Login Label · today');
    expect(html).toContain('Ahmed Renamed');
    expect(html).toContain('My performance');
    expect(html).toContain('20 / 10 / 5');
    expect(html).toContain('40.0%');
    expect(html).not.toContain('Coach comparison');
  });

  it('keeps coach sessions focused and moves detailed controls out of the dashboard', () => {
    const html = renderToStaticMarkup(<Dashboard data={data} theme={theme} role="coach" username="Coach" onOpenMatch={() => {}} />);
    expect(html).toContain('Today at a glance');
    expect(html).toContain('Latest match');
    expect(html).toContain('Next session');
    expect(html).not.toContain('Coach comparison');
    expect(html).not.toContain('Data &amp; analysis readiness');
    expect(html).not.toContain('My performance');
  });

  it('does not infer an unpaired player identity from a matching display name', () => {
    const unpaired = { ...data, authenticatedViewer: { playerId: null }, rosterPlayers: [{ id: 'other-player', displayName: 'Ahmed' }] };
    const html = renderToStaticMarkup(<Dashboard data={unpaired} theme={theme} role="player" username="Ahmed" onOpenMatch={() => {}} />);
    expect(html).toContain('This login is not paired to a roster identity');
    expect(html).not.toContain('20 / 10 / 5');
  });
});
