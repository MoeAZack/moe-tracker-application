import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isTrustedSenderUrl, sessionIsFresh } = require('../desktop/session-security.cjs');

describe('desktop session and sender security', () => {
  it('accepts only the exact local application origin', () => {
    expect(isTrustedSenderUrl('http://127.0.0.1:43123/dashboard', 43123)).toBe(true);
    expect(isTrustedSenderUrl('http://127.0.0.1:43123.evil.test/api', 43123)).toBe(false);
    expect(isTrustedSenderUrl('https://127.0.0.1:43123/dashboard', 43123)).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:43123/dashboard', 43123)).toBe(false);
    expect(isTrustedSenderUrl('not-a-url', 43123)).toBe(false);
  });

  it('renews before expiry instead of reusing a nearly expired session', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    expect(sessionIsFresh({ key: 'session', expiresAt: '2026-10-18T12:06:00.000Z' }, now)).toBe(true);
    expect(sessionIsFresh({ key: 'session', expiresAt: '2026-10-18T12:04:59.000Z' }, now)).toBe(false);
    expect(sessionIsFresh({ key: '', expiresAt: '2026-10-18T13:00:00.000Z' }, now)).toBe(false);
  });
});
