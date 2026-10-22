import net from 'node:net';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { DEFAULT_LOCAL_PORT, isPortFree, chooseLocalPort, strandedOriginPorts, startStrandedOriginServer, combineStrandedLearning } = require('../desktop/local-origin.cjs');

const busy = (ports: number[]) => async (port: number) => !ports.includes(port);

function listen(port = 0) {
  return new Promise<net.Server>(resolve => { const server = net.createServer(); server.listen(port, '127.0.0.1', () => resolve(server)); });
}

describe('desktop local origin', () => {
  it('keeps the saved port between launches, so browser storage survives a restart', async () => {
    const freePort = async () => { throw new Error('should not pick a random port'); };
    expect(await chooseLocalPort({ saved: 47999, isFree: busy([]), freePort })).toBe(47999);
    expect(await chooseLocalPort({ saved: 47999, isFree: busy([]), freePort })).toBe(47999);
  });

  it('uses the fixed default on the first launch and when the saved port is taken', async () => {
    const freePort = async () => 61234;
    expect(await chooseLocalPort({ saved: undefined, isFree: busy([]), freePort })).toBe(DEFAULT_LOCAL_PORT);
    expect(await chooseLocalPort({ saved: 'junk', isFree: busy([]), freePort })).toBe(DEFAULT_LOCAL_PORT);
    expect(await chooseLocalPort({ saved: 47999, isFree: busy([47999]), freePort })).toBe(DEFAULT_LOCAL_PORT);
    expect(DEFAULT_LOCAL_PORT).toBeLessThan(49152);
  });

  it('falls back to a random port only when the saved and default ports are both taken', async () => {
    expect(await chooseLocalPort({ saved: 47999, isFree: busy([47999, DEFAULT_LOCAL_PORT]), freePort: async () => 61234 })).toBe(61234);
  });

  it('sees a real listener as taken', async () => {
    const server = await listen();
    const port = (server.address() as net.AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    await new Promise(resolve => server.close(resolve));
    expect(await isPortFree(port)).toBe(true);
  });

  it('lists old per-launch origins once, skipping the current and already recovered ones', () => {
    const names = ['http_127.0.0.1_57856.indexeddb.leveldb', 'http_127.0.0.1_47615.indexeddb.leveldb', 'http_127.0.0.1_50141.indexeddb.leveldb', 'http_127.0.0.1_59515.indexeddb.leveldb', 'http_localhost_3000.indexeddb.leveldb', 'http_127.0.0.1_99999.indexeddb.leveldb', 'http_127.0.0.1_57856.indexeddb.blob', 'notes.txt'];
    expect(strandedOriginPorts(names, { currentPort: 47615, recovered: [50141] })).toEqual([57856, 59515]);
  });

  it('serves the read-only page and collects what it posts back, refusing other requests', async () => {
    const probe = await listen(); const port = (probe.address() as net.AddressInfo).port; await new Promise(resolve => probe.close(resolve));
    const server = await startStrandedOriginServer(port, { token: 'abc123' });
    try {
      expect(server.url).toBe(`http://127.0.0.1:${port}/__moe-recover-abc123`);
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('indexedDB.databases()');
      expect((await fetch(`http://127.0.0.1:${port}/__moe-recover-wrong/rows`, { method: 'POST', body: '{}' })).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
      const posted = { learningEnabled: true, corrections: [{ id: 'c1' }], outcomes: [] };
      expect((await fetch(`${server.url}/rows`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(posted) })).status).toBe(204);
      expect(await server.result).toEqual(posted);
    } finally { await server.close(); }
  });

  it('merges every old origin without duplicates and leaves out corrections where learning was off', () => {
    const combined = combineStrandedLearning([
      { learningEnabled: true, corrections: [{ id: 'c1', v: 1 }, { id: 'c2' }, { nope: true }], outcomes: [{ id: 'o1' }] },
      { learningEnabled: false, corrections: [{ id: 'c3' }], outcomes: [{ id: 'o2' }] },
      { learningEnabled: true, corrections: [{ id: 'c1', v: 2 }], outcomes: [{ id: 'o1' }] },
      null,
    ]);
    expect(combined.corrections).toEqual([{ id: 'c1', v: 1 }, { id: 'c2' }]);
    expect(combined.outcomes).toEqual([{ id: 'o1' }, { id: 'o2' }]);
  });
});
