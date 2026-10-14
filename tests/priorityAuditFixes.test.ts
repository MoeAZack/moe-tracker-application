import { describe, expect, it, vi } from 'vitest';
import { compositionMatchOutcome } from '../src/components/TeamCompositions';
import { clientIp, requestRateLimit } from '../lib/utils';

describe('priority audit fixes', () => {
  it('uses final scores before half scores and never invents a loss', () => {
    expect(compositionMatchOutcome({ ourScore: 13, theirScore: 9 })).toBe('win');
    expect(compositionMatchOutcome({ ourScore: 8, theirScore: 13 })).toBe('loss');
    expect(compositionMatchOutcome({ attW: 7, attL: 5, defW: 6, defL: 4 })).toBe('win');
    expect(compositionMatchOutcome({ map: 'Haven' })).toBeNull();
    expect(compositionMatchOutcome({ ourScore: 12, theirScore: 12 })).toBeNull();
  });

  it('does not trust a client-supplied forwarded-for header outside Cloudflare', () => {
    vi.stubEnv('CLOUDFLARE_WORKER', 'false');
    expect(clientIp({ headers: { 'x-forwarded-for': 'attacker-controlled' }, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
    vi.unstubAllEnvs();
  });

  it('throttles a bounded request window', () => {
    const key = `test:${Math.random()}`;
    expect(requestRateLimit(key, 2, 1_000, 100)).toBe(0);
    expect(requestRateLimit(key, 2, 1_000, 100)).toBe(0);
    expect(requestRateLimit(key, 2, 1_000, 100)).toBe(1);
    expect(requestRateLimit(key, 2, 1_000, 1_101)).toBe(0);
  });
});
