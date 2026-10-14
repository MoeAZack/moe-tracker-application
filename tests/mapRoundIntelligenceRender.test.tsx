import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapRoundIntelligencePanel from '../src/components/MapRoundIntelligencePanel';

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
    expect(html).toContain('H1 W–W–L');
    expect(html).toContain('1/1 · 100%');
    expect(html).toContain('0/1 · 0%');
    expect(html).toContain('Unknown');
    expect(html).toContain('3 rounds');
  });
});
