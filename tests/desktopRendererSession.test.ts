import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { publicSession, apiRequestFilter, createSessionHeaderInjector } = require('../desktop/renderer-session.cjs');

const port = 43123;
const session = { success: true, role: 'coach', username: 'Coach', key: 'header.payload.signature', expiresAt: '2026-10-21T18:00:00.000Z' };

function send(injector: (details: any, callback: (response: any) => void) => void, details: any) {
  return new Promise<Record<string, string>>(resolve => injector({ webContentsId: 1, requestHeaders: {}, ...details }, (response: any) => resolve(response.requestHeaders)));
}

describe('desktop renderer session', () => {
  it('tells the renderer who is signed in without the bearer token', () => {
    const shared = publicSession(session);
    expect(shared).toEqual({ success: true, role: 'coach', username: 'Coach', expiresAt: '2026-10-21T18:00:00.000Z' });
    expect(JSON.stringify(shared)).not.toContain(session.key);
  });

  it('adds the main-process token to the trusted window\'s local API requests', async () => {
    let renewals = 0;
    const injector = createSessionHeaderInjector({ port, getSession: async () => { renewals += 1; return session; }, isTrustedWebContents: (id: number) => id === 1 });
    expect(apiRequestFilter(port)).toEqual({ urls: ['http://127.0.0.1:43123/api/*'] });
    expect(await send(injector, { url: 'http://127.0.0.1:43123/api/data', requestHeaders: { Accept: 'application/json' } })).toEqual({ Accept: 'application/json', Authorization: 'Bearer header.payload.signature' });
    expect(renewals).toBe(1);
  });

  it('leaves login, other origins, other windows and page-supplied credentials alone', async () => {
    const injector = createSessionHeaderInjector({ port, getSession: async () => session, isTrustedWebContents: (id: number) => id === 1 });
    expect(await send(injector, { url: 'http://127.0.0.1:43123/api/login-key' })).toEqual({});
    expect(await send(injector, { url: 'http://127.0.0.1:9999/api/data' })).toEqual({});
    expect(await send(injector, { url: 'http://localhost:43123/api/data' })).toEqual({});
    expect(await send(injector, { url: 'http://127.0.0.1:43123/assets/index.js' })).toEqual({});
    expect(await send(injector, { url: 'http://127.0.0.1:43123/api/data', webContentsId: 2 })).toEqual({});
    expect(await send(injector, { url: 'http://127.0.0.1:43123/api/data', requestHeaders: { authorization: 'Bearer typed-in' } })).toEqual({ authorization: 'Bearer typed-in' });
  });

  it('still sends the request when the session cannot be renewed', async () => {
    const injector = createSessionHeaderInjector({ port, getSession: async () => { throw new Error('offline'); } });
    expect(await send(injector, { url: 'http://127.0.0.1:43123/api/data' })).toEqual({});
  });
});
