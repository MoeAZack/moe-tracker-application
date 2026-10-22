import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlaybookStrategies from '../src/components/PlaybookStrategies';
import MapBestStats from '../src/components/MapBestStats';

const data = (): any => ({
  settings: { theme: 'midnight', maps: ['Haven'], stats: { lowSample: 15 }, weights: {} },
  rosterPlayers: [], playerStats: [],
  matches: [{ id: 'm1', date: '2026-10-01', map: 'Haven', ourScore: 13, theirScore: 9 }],
  rounds: [{ matchId: 'm1', roundNo: 1, result: 'W', strategies: 'Fast A' }],
  strats: [{ id: 's1', map: 'Haven', side: 'Attack', name: 'Fast A', notes: 'Smoke heaven', active: 'TRUE' }],
  stratRuns: [{ id: 'r1', stratId: 's1', date: '2026-10-01', map: 'Haven', side: 'Att', result: 'L', reason: 'late trade' }],
});

describe('one strategy editor', () => {
  it('shows a strategy AI tools saved with the old side spelling, with runs and tagged rounds labelled apart', () => {
    const html = renderToStaticMarkup(<PlaybookStrategies data={data()} theme={{ primaryBg: 'bg' }} onUpsert={async () => null} onRemove={async () => null} />);
    expect(html).toContain('Fast A');
    expect(html).toContain('Haven · Attack');
    expect(html).toMatch(/Logged runs: <span[^>]*>0–1<\/span>/);
    expect(html).toMatch(/Tagged rounds: <span[^>]*>1–0<\/span>/);
    expect(html).toContain('(small sample)');
    expect(html).toContain('Last failure: late trade');
    expect(html).toContain('aria-label="Edit Fast A"');
  });

  it('no longer offers a second strategy editor inside Map Analysis', () => {
    const html = renderToStaticMarkup(<MapBestStats data={data()} theme={{ border: 'border', cardBg: 'card' }} />);
    expect(html).not.toContain('Playbook Strategy');
    expect(html).not.toContain('NEW STRAT');
  });
});
