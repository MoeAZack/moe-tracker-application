import { describe, expect, it } from 'vitest';
import { splitPendingCaptures } from '../src/utils/captureQueue';

describe('pending capture queue', () => {
  it('keeps a capture that is missing rounds from standing in front of readable ones', () => {
    const pending = [
      { id: 'older', capture: { captureId: '20261014-100555', requestedRounds: 22, missingRounds: 0 } },
      { id: 'loose', capture: null },
      { id: 'newest', capture: { captureId: '20261014-101834', requestedRounds: 28, missingRounds: 4 } },
    ];
    const { readable, incomplete } = splitPendingCaptures(pending);
    expect(readable.map(item => item.id)).toEqual(['older']);
    expect(incomplete.map(item => item.id)).toEqual(['newest']);
  });
});
