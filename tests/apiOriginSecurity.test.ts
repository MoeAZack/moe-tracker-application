import { describe, expect, it } from 'vitest';
import { applicationApiTarget } from '../src/utils/api';

describe('API credential origin boundary', () => {
  it('rejects external and lookalike URLs containing /api/', () => {
    const base = 'http://127.0.0.1:43123/dashboard'; const origin = 'http://127.0.0.1:43123';
    expect(applicationApiTarget('https://external.example/api/collect', base, origin)).toBeNull();
    expect(applicationApiTarget('http://127.0.0.1:43123.evil.test/api/collect', base, origin)).toBeNull();
    expect(applicationApiTarget('http://localhost:43123/api/collect', base, origin)).toBeNull();
  });

  it('accepts only same-origin API paths', () => {
    const base = 'http://127.0.0.1:43123/dashboard'; const origin = 'http://127.0.0.1:43123';
    expect(applicationApiTarget('/api/session', base, origin)?.pathname).toBe('/api/session');
    expect(applicationApiTarget('/assets/api/example.js', base, origin)).toBeNull();
  });
});
