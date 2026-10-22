import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TeamCompositions from '../src/components/TeamCompositions';

const agents = ['Sova', 'Jett', 'Omen', 'Killjoy', 'Kayo'];
const data = (matches: any[], playerStats: any[]): any => ({ settings: { theme: 'midnight', maps: ['Haven', 'Bind'], agents, stats: {} }, matches, playerStats, rounds: [], rosterPlayers: [] });
const render = (value: any) => renderToStaticMarkup(<TeamCompositions data={value} theme={{ text: 'text', border: 'border', cardBg: 'card' } as any} />);

describe('compositions empty state', () => {
  it('shows one empty state, not an empty card per map, when nothing is logged', () => {
    const html = render(data([], []));
    expect(html.match(/No compositions logged yet/g)).toHaveLength(1);
    expect(html).not.toContain('ready for its first logged composition');
    expect(html).not.toContain('>Haven<');
    expect(html).toContain('No agents logged yet');
    expect(html).not.toContain('0W');
  });

  it('lists only maps with a logged composition and names the rest in one line', () => {
    const match = { id: 'm1', date: '2026-10-01', map: 'Haven', ourScore: 13, theirScore: 9 };
    const html = render(data([match], agents.map((agent, index) => ({ id: `s${index}`, matchId: 'm1', player: `P${index}`, agent }))));
    expect(html).toContain('>Haven<');
    expect(html).not.toContain('No compositions logged yet');
    expect(html).toContain('No composition logged yet on Bind.');
    expect(html).not.toContain('No agents logged yet');
  });
});
