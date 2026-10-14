import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapRoundIntelligencePanel from '../src/components/MapRoundIntelligencePanel';
import MapBestStats from '../src/components/MapBestStats';

describe('map round intelligence panel', () => {
  it('renders exact samples and Unknown rather than synthetic zero rates', () => {
    const data = {
      matches: [{ id: 'm1', map: 'Ascent', opponent: 'Team B', date: '2026-10-14' }],
      rounds: [
        { id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W', buy: 'Eco', enemyBuy: 'Eco' },
        { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Attack', result: 'W', buy: 'Low', enemyBuy: 'Eco' },
        { id: 'r3', matchId: 'm1', roundNo: 3, side: 'Attack', result: 'L', buy: 'Half', enemyBuy: 'Full' },
      ],
    };
    const html = renderToStaticMarkup(<MapRoundIntelligencePanel data={data as any} />);
    expect(html).toContain('Economy punishments');
    expect(html).toContain('1/1 won · 100%');
    expect(html).toContain('Unknown');
    expect(html).toContain('3 rounds');
  });

  it('consolidates opening and conversion metrics into Map Pool Breakdown above economy punishments', () => {
    const data: any = {
      settings: { maps: ['Ascent'], stats: {}, weights: {}, theme: 'slate' }, rosterPlayers: [],
      matches: [{ id: 'm1', map: 'Ascent', opponent: 'Team B', date: '2026-10-14', attW: 7, attL: 5, defW: 6, defL: 4, ourScore: 13, theirScore: 9 }],
      playerStats: [], strats: [], stratRuns: [], vetos: [],
      rounds: [
        { id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W', buy: 'Eco', enemyBuy: 'Eco' },
        { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Attack', result: 'W', buy: 'Low', enemyBuy: 'Eco' },
        { id: 'r3', matchId: 'm1', roundNo: 3, side: 'Attack', result: 'L', buy: 'Half', enemyBuy: 'Full' },
      ],
    };
    const html = renderToStaticMarkup(<MapBestStats data={data} theme={{ text: 'text-red' }} onUpsert={async () => null} onRemove={async () => null} />);
    expect(html).toContain('Pistol ATT');
    expect(html).toContain('Pistol DEF');
    expect(html).toContain('Anti-eco ATT');
    expect(html).toContain('Anti-eco DEF');
    expect(html).toContain('Bonus ATT');
    expect(html).toContain('Bonus DEF');
    expect(html).toContain('first three rounds of each side');
    expect(html).not.toContain('Latest opening three');
    expect(html.indexOf('Map Pool Breakdown')).toBeLessThan(html.indexOf('Economy punishments'));
  });
});
