import net from 'node:net';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { DEFAULT_LOCAL_PORT, isPortFree, chooseLocalPort, strandedOriginPorts, startStrandedOriginServer, combineStrandedLearning, createStrandedLearningRecovery } = require('../desktop/local-origin.cjs');

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
    expect(combined.learningEnabled).toBe(true);
    expect(combined.corrections).toEqual([{ id: 'c1', v: 1 }, { id: 'c2' }]);
    expect(combined.outcomes).toEqual([{ id: 'o1' }, { id: 'o2' }]);
  });

  it('refuses a post over the size cap', async () => {
    const probe = await listen(); const port = (probe.address() as net.AddressInfo).port; await new Promise(resolve => probe.close(resolve));
    const server = await startStrandedOriginServer(port, { token: 'cap', maxBytes: 1024 });
    try {
      const rejected = expect(server.result).rejects.toThrow(/too large/);
      await fetch(`${server.url}/rows`, { method: 'POST', body: 'x'.repeat(64 * 1024) }).catch(() => null);
      await rejected;
    } finally { await server.close(); }
  });

  it('newest old origin decides the learning switch', () => {
    expect(combineStrandedLearning([{ learningEnabled: false, corrections: [], outcomes: [] }, { learningEnabled: true, corrections: [], outcomes: [] }]).learningEnabled).toBe(false);
    expect(combineStrandedLearning([]).learningEnabled).toBeNull();
  });
});

function fakeRecovery({ folders, posts, busy = [] as number[], config = {} as any, failPorts = [] as number[] }) {
  const saves: any[] = []; const opened: number[] = []; const closed: number[] = []; const serversClosed: number[] = [];
  const recovery = createStrandedLearningRecovery({
    currentPort: 47615, config, saveConfig: async () => { saves.push(structuredClone(config)); },
    listOrigins: async () => folders,
    isFree: async (port: number) => !busy.includes(port),
    startServer: async (port: number) => ({ url: `http://127.0.0.1:${port}/x`, result: failPorts.includes(port) ? Promise.reject(new Error('page failed')) : Promise.resolve(posts[port]), close: async () => { serversClosed.push(port); } }),
    openPage: async (url: string) => { const port = Number(new URL(url).port); opened.push(port); return () => { closed.push(port); }; },
  });
  return { recovery, config, saves, opened, closed, serversClosed };
}

const folder = (port: number, modifiedMs: number) => ({ name: `http_127.0.0.1_${port}.indexeddb.leveldb`, modifiedMs });

describe('stranded OCR learning recovery (main process)', () => {
  it('reads every free old origin newest first, closes each page and server, and offers the combined rows', async () => {
    const posts = { 50141: { learningEnabled: true, corrections: [{ id: 'old' }], outcomes: [] }, 57856: { learningEnabled: false, corrections: [{ id: 'new' }], outcomes: [{ id: 'o1' }] } };
    const fake = fakeRecovery({ folders: [folder(50141, 1), folder(57856, 2), folder(59515, 3), folder(47615, 4)], posts, busy: [59515] });
    fake.recovery.start();
    const taken = await fake.recovery.take();
    expect(fake.opened).toEqual([57856, 50141]);
    expect(fake.closed).toEqual([57856, 50141]);
    expect(fake.serversClosed).toEqual([57856, 50141]);
    expect(taken).toEqual({ ports: [57856, 50141], learningEnabled: false, corrections: [{ id: 'old' }], outcomes: [{ id: 'o1' }] });
  });

  it('leaves a failed origin unconfirmed so the next launch tries it again', async () => {
    const fake = fakeRecovery({ folders: [folder(50141, 1), folder(57856, 2)], posts: { 50141: { corrections: [], outcomes: [] } }, failPorts: [57856] });
    fake.recovery.start();
    expect((await fake.recovery.take()).ports).toEqual([50141]);
    expect(fake.serversClosed).toEqual([57856, 50141]);
  });

  it('confirms only ports it offered and saves them', async () => {
    const fake = fakeRecovery({ folders: [folder(50141, 1)], posts: { 50141: { corrections: [], outcomes: [] } }, config: { recoveredLearningOrigins: [40000] } });
    fake.recovery.start(); await fake.recovery.take();
    expect(await fake.recovery.confirm([50141, 61000, 'x'])).toEqual({ recorded: 1 });
    expect(fake.config.recoveredLearningOrigins).toEqual([40000, 50141]);
    expect(fake.saves.at(-1).recoveredLearningOrigins).toEqual([40000, 50141]);
  });

  it('skips recovered origins and un-marks the current port so its rows are read if the port ever changes', async () => {
    const fake = fakeRecovery({ folders: [folder(50141, 1), folder(57856, 2)], posts: { 57856: { corrections: [], outcomes: [] } }, config: { recoveredLearningOrigins: [50141, 47615] } });
    fake.recovery.start(); await fake.recovery.take();
    expect(fake.opened).toEqual([57856]);
    expect(fake.saves[0].recoveredLearningOrigins).toEqual([50141]);
  });

  it('offers nothing when the folder cannot be listed or recovery was never started', async () => {
    const recovery = createStrandedLearningRecovery({ currentPort: 47615, config: {}, saveConfig: async () => {}, listOrigins: async () => { throw new Error('ENOENT'); }, openPage: async () => () => {} });
    expect(await recovery.take()).toEqual({ ports: [], learningEnabled: null, corrections: [], outcomes: [] });
    recovery.start();
    expect((await recovery.take()).ports).toEqual([]);
  });
});
