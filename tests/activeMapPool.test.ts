import { describe, expect, it } from 'vitest';
import { filterActiveMapPool } from '../src/utils/activeMapPool';

describe('active map pool analytics filter', () => {
  it('removes inactive-map evidence and dependent rows without mutating history', () => {
    const source: any = {
      settings: { maps: ['Ascent'] },
      matches: [{ id: 'a', map: 'Ascent' }, { id: 'l', map: 'Lotus' }],
      playerStats: [{ id: 'pa', matchId: 'a' }, { id: 'pl', matchId: 'l' }],
      rounds: [{ id: 'ra', matchId: 'a' }, { id: 'rl', matchId: 'l' }],
      vetos: [{ id: 'va', matchId: 'a' }, { id: 'vl', matchId: 'l' }],
      strats: [{ id: 'as', map: 'Ascent' }, { id: 'ls', map: 'Lotus' }],
      stratRuns: [{ id: 'sa', map: 'Ascent', matchId: 'a' }, { id: 'sl', map: 'Lotus', matchId: 'l' }, { id: 'library', map: 'Ascent', matchId: '' }],
      vodReviews: [{ id: 'wa', matchId: 'a' }, { id: 'wl', matchId: 'l' }],
      lineups: [{ id: 'ala', map: 'Ascent' }, { id: 'all', map: 'Lotus' }],
    };
    const filtered = filterActiveMapPool(source);
    expect(filtered.matches.map((row: any) => row.id)).toEqual(['a']);
    expect(filtered.playerStats.map((row: any) => row.id)).toEqual(['pa']);
    expect(filtered.rounds.map((row: any) => row.id)).toEqual(['ra']);
    expect(filtered.strats.map((row: any) => row.id)).toEqual(['as']);
    expect(filtered.stratRuns.map((row: any) => row.id)).toEqual(['sa', 'library']);
    expect(filtered.lineups.map((row: any) => row.id)).toEqual(['ala']);
    expect(filtered.vodReviews.map((row: any) => row.id)).toEqual(['wa']);
    expect(source.matches).toHaveLength(2);
  });
});
