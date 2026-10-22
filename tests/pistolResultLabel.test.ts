import { describe, expect, it } from 'vitest';
import { pistolResultLabel } from '../src/components/MatchLogRounds';

describe('pistol result label', () => {
  it('shows Unknown for a result that was never recorded', () => {
    expect(`${pistolResultLabel('')} / ${pistolResultLabel(undefined)}`).toBe('Unknown / Unknown');
    expect(pistolResultLabel('  ')).toBe('Unknown');
    expect(`${pistolResultLabel('W')} / ${pistolResultLabel(null)}`).toBe('W / Unknown');
  });
});
