import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapBestStats from '../src/components/MapBestStats';
import { bestMapInsight, buildBestMaps, buildMapStatsTable } from '../lib/mapBestScores';

describe('map discipline roster identities', () => {
  it('does not resurrect legacy setting names after the canonical roster is cleared', () => {
    const data: any = {
      settings: {
        theme: 'midnight', maps: ['Haven'], players: ['Player1', 'Player2'], inactivePlayers: ['Former'],
        stats: {}, weights: {},
      },
      rosterPlayers: [], matches: [], playerStats: [], rounds: [], strats: [], stratRuns: [],
    };

    const html = renderToStaticMarkup(<MapBestStats data={data} theme={{ border: 'border', cardBg: 'card' }} onUpsert={async () => null} onRemove={async () => null} />);

    expect(html).not.toContain('Player1');
    expect(html).not.toContain('Player2');
    expect(html).not.toContain('Former');
  });

  it('publishes no best-map score, interval or insight while the experimental toggle is off', () => {
    const matches = Array.from({ length: 16 }, (_, index) => ({ id: `m${index}`, date: `2026-09-${String(index + 1).padStart(2, '0')}`, map: 'Haven', ourScore: index % 3 ? 13 : 9, theirScore: index % 3 ? 9 : 13, attW: 7, attL: 5, defW: 6, defL: 4 }));
    const data = (experimental: boolean): any => ({ settings: { theme: 'midnight', maps: ['Haven'], stats: { lowSample: 15, experimentalCompositeScores: experimental }, weights: {} }, rosterPlayers: [], matches, playerStats: [], rounds: [], strats: [], stratRuns: [] });
    const off = buildBestMaps(data(false), buildMapStatsTable(data(false), ['Haven']));
    expect(off[0]).toMatchObject({ score: null, ci: null, playerPerformance: null });
    expect(off[0].ledger.contributions.every(item => item.status === 'unknown')).toBe(true);
    expect(bestMapInsight(off, data(false).settings)).toBeNull();
    const on = buildBestMaps(data(true), buildMapStatsTable(data(true), ['Haven']));
    expect(on[0].score).not.toBeNull();
    expect(bestMapInsight(on, data(true).settings)?.map).toBe('Haven');
  });

  it('keeps side and K/D unknown when one match in the window lacks them', () => {
    const data: any = { settings: { theme: 'midnight', maps: ['Haven'], stats: { rollingWindow: 0 }, weights: {} }, rosterPlayers: [], rounds: [],
      matches: [{ id: 'a', date: '2026-09-01', map: 'Haven', ourScore: 13, theirScore: 9, attW: 7, attL: 5, defW: 6, defL: 4 }, { id: 'b', date: '2026-09-02', map: 'Haven', ourScore: 9, theirScore: 13 }],
      playerStats: [{ id: 'r1', matchId: 'a', player: 'One', kills: 20, deaths: 10 }, { id: 'r2', matchId: 'b', player: 'One', kills: 15 }] };
    const [row] = buildBestMaps(data, buildMapStatsTable(data, ['Haven']));
    expect(row).toMatchObject({ attWr: null, defWr: null, kd: null, wr: 50 });
  });
});

