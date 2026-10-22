import { describe, expect, it } from 'vitest';
import { pistolResultClass, pistolResultLabel } from '../src/components/MatchLogRounds';

describe('pistol result label', () => {
  it('shows Unknown for a result that was never recorded', () => {
    expect(`${pistolResultLabel('')} / ${pistolResultLabel(undefined)}`).toBe('Unknown / Unknown');
    expect(pistolResultLabel('  ')).toBe('Unknown');
    expect(`${pistolResultLabel('W')} / ${pistolResultLabel(null)}`).toBe('W / Unknown');
  });

  it('colours a won pistol green, a lost one red, and leaves an unrecorded one neutral', () => {
    expect(pistolResultClass('W')).toBe('text-emerald-400');
    expect(pistolResultClass('L')).toBe('text-rose-400');
    expect(pistolResultClass('')).toBe('text-slate-400');
  });
});
