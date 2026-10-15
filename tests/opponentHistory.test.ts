import { describe, expect, it } from 'vitest';
import { buildOpponentHistory } from '../lib/opponentHistory';

describe('opponent history', () => {
  it('combines case variants and tracks recurring-team results and maps', () => {
    const history = buildOpponentHistory([
      { id: '1', date: '2026-10-14', opponent: 'mt asteria', map: 'Lotus', ourScore: 13, theirScore: 9 },
      { id: '2', date: '2026-10-15', opponent: 'MT Asteria', map: 'Ascent', ourScore: 8, theirScore: 13 },
      { id: '3', date: '2026-10-15', opponent: 'PYO', map: 'Haven', ourScore: 13, theirScore: 7 },
    ] as any);
    expect(history[0]).toMatchObject({ key: 'mt asteria', name: 'MT Asteria', games: 2, wins: 1, losses: 1, maps: ['Ascent', 'Lotus'] });
    expect(history[1]).toMatchObject({ name: 'PYO', games: 1 });
  });
});
