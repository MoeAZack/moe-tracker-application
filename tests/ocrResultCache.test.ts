import { describe, expect, it } from 'vitest';
import { localScoreboardCacheKey, pruneOcrResultCache } from '../lib/ocrResultCache';

describe('incremental OCR result cache', () => {
  it('reuses the same pixels regardless of roster order', () => {
    const a = localScoreboardCacheKey({ imageSha256: 'abc', rosterPlayers: [{ id: '2', displayName: 'Beta' }, { id: '1', displayName: 'Alpha' }] });
    const b = localScoreboardCacheKey({ imageSha256: 'abc', rosterPlayers: [{ id: '1', displayName: 'Alpha' }, { id: '2', displayName: 'Beta' }] });
    expect(a).toBe(b);
  });

  it('invalidates only changed pixels, roster projection, selection, or extractor version', () => {
    const base = { imageSha256: 'abc', rosterPlayers: [{ id: '1', displayName: 'Alpha' }] };
    const key = localScoreboardCacheKey(base);
    expect(localScoreboardCacheKey({ ...base, imageSha256: 'def' })).not.toBe(key);
    expect(localScoreboardCacheKey({ ...base, rosterPlayers: [{ id: '1', displayName: 'Beta' }] })).not.toBe(key);
    expect(localScoreboardCacheKey({ ...base, selection: { top: 1 } })).not.toBe(key);
    expect(localScoreboardCacheKey({ ...base, extractorVersion: 'scoreboard-result/v7' })).not.toBe(key);
  });

  it('re-runs extraction after a learned alias changes the roster projection', () => {
    const base = { imageSha256: 'abc', rosterPlayers: [{ id: '1', displayName: 'Alpha' }] };
    expect(localScoreboardCacheKey({ ...base, rosterPlayers: [{ id: '1', displayName: 'Alpha', aliases: ['A1pha'] }] })).not.toBe(localScoreboardCacheKey(base));
  });

  it('keeps only the most recently used bounded entries', () => {
    const result = pruneOcrResultCache({ a: { usedAt: '2026-01-01T00:00:00Z' }, b: { usedAt: '2026-01-03T00:00:00Z' }, c: { usedAt: '2026-01-02T00:00:00Z' } }, 2);
    expect(Object.keys(result)).toEqual(['b', 'c']);
  });
});
