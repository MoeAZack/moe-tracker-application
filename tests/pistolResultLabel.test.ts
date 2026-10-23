import { describe, expect, it } from 'vitest';
import { matchScoreDisplay, pistolResultClass, pistolResultLabel } from '../src/components/MatchLogRounds';

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

describe('match score detail label', () => {
  it('shows retained HUD evidence as partial instead of hiding it behind Pending', () => {
    expect(matchScoreDisplay({ ourScore: null, theirScore: null, partialScore: { ours: 8, theirs: 9, source: 'vod-hud', basis: 'last-hud', reads: 6, orientation: 'left-is-ours', derivedAt: '2026-10-23T20:00:00Z' } } as any)).toBe('Pending · last HUD 8–9 (partial)');
  });

  it('prefers a final score when one exists', () => {
    expect(matchScoreDisplay({ ourScore: 10, theirScore: 14, partialScore: { ours: 8, theirs: 9 } } as any)).toBe('10 - 14');
  });
});
