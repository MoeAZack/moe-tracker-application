import { describe, expect, it } from 'vitest';
import { percentageBarClass, percentageTextClass, percentageTone } from '../src/utils/percentageColor';

describe('percentage color scale', () => {
  it('moves from red through orange and yellow to green', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 99, 100].map(value => percentageTone(value))).toEqual([
      'critical', 'critical', 'poor', 'poor', 'neutral', 'neutral', 'good', 'good', 'perfect',
    ]);
    expect(percentageTextClass(100)).toBe('text-emerald-400');
    expect(percentageTextClass(49)).toBe('text-orange-400');
    expect(percentageBarClass(50)).toBe('bg-yellow-400');
  });
  it('supports inverse scales for loss percentages and preserves unknown', () => {
    expect(percentageTone(100, true)).toBe('critical');
    expect(percentageTone(0, true)).toBe('perfect');
    expect(percentageTone(null)).toBe('unknown');
  });
});
