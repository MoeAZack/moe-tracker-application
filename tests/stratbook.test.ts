import { describe, expect, it } from 'vitest';
import { buildStratRecords, stratSide } from '../lib/stratbook';

describe('stratbook', () => {
  it('reads every side spelling the old writers saved as one vocabulary', () => {
    expect(['Att', 'attack', 'Attack', 'ATK'].map(stratSide)).toEqual(['Att', 'Att', 'Att', 'Att']);
    expect(['Def', 'Defense', 'defence'].map(stratSide)).toEqual(['Def', 'Def', 'Def']);
    expect(stratSide('Retake')).toBe('Retake');
    expect(stratSide('')).toBe('');
  });

  it('keeps logged runs and tagged rounds apart so a Live Logger round is not counted twice', () => {
    const strats = [{ id: 's1', map: 'Haven', side: 'Att', name: 'A split' }, { id: 's2', map: 'Bind', side: 'Att', name: 'A split' }];
    const runs = [
      { stratId: 's1', date: '2026-10-01', result: 'W' },
      { stratId: 's1', date: '2026-10-03', result: 'L', reason: 'late trade' },
      { stratId: 's1', date: '2026-10-02', result: 'L', reason: 'missed smoke' },
      { stratId: 's1', date: '2026-10-04', result: '' },
    ];
    const matches = [{ id: 'm1', map: 'haven' }, { id: 'm2', map: 'Bind' }];
    const rounds = [
      { matchId: 'm1', result: 'W', strategies: 'a split, Default' },
      { matchId: 'm1', result: 'L', strategies: 'A split' },
      { matchId: 'm2', result: 'W', strategies: 'A split' },
      { matchId: 'm1', result: '', strategies: 'A split' },
    ];
    const records = buildStratRecords(strats, runs, rounds, matches);
    expect(records.s1).toEqual({ runWins: 1, runLosses: 2, lastFailReason: 'late trade', taggedWins: 1, taggedRounds: 2 });
    // A strategy with the same name on another map only counts rounds from its own map.
    expect(records.s2).toEqual({ runWins: 0, runLosses: 0, lastFailReason: '', taggedWins: 1, taggedRounds: 1 });
  });
});
