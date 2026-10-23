import { describe, expect, it, vi } from 'vitest';
import { retryTransientFileLock, isTransientFileLock } from '../lib/windowsFileRetry';
import { fetchTrackerState, trackerStateFailure } from '../src/utils/trackerStateFetch';

const lock = (code: string) => Object.assign(new Error(`${code}: operation not permitted, open 'db.json'`), { code });

describe('Windows file locks while a save replaces db.json', () => {
  it('retries a read blocked for a moment and returns its result', async () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      let calls = 0;
      const read = vi.fn(async () => { calls += 1; if (calls < 3) throw lock(code); return '{"ok":true}'; });
      await expect(retryTransientFileLock(read, { delayMs: 1 })).resolves.toBe('{"ok":true}');
      expect(read).toHaveBeenCalledTimes(3);
    }
  });

  it('gives up after the last attempt and throws other errors at once', async () => {
    const stuck = vi.fn(async () => { throw lock('EBUSY'); });
    await expect(retryTransientFileLock(stuck, { attempts: 4, delayMs: 1 })).rejects.toMatchObject({ code: 'EBUSY' });
    expect(stuck).toHaveBeenCalledTimes(4);
    const missing = vi.fn(async () => { throw lock('ENOENT'); });
    await expect(retryTransientFileLock(missing, { delayMs: 1 })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(missing).toHaveBeenCalledTimes(1);
    expect(isTransientFileLock(lock('EPERM'))).toBe(true);
    expect(isTransientFileLock(new Error('plain'))).toBe(false);
  });
});

describe('loading the tracker state', () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it('retries once after a server error and uses the second answer', async () => {
    const request = vi.fn().mockResolvedValueOnce(json(500, { error: 'EBUSY: resource busy' })).mockResolvedValueOnce(json(200, { matches: [] }));
    const response = await fetchTrackerState(request, { retryDelayMs: 1 });
    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries once after a dropped request', async () => {
    const request = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, {}));
    expect((await fetchTrackerState(request, { retryDelayMs: 1 })).status).toBe(200);
  });

  it('does not retry an answer the app handles itself, and stops after one retry', async () => {
    for (const status of [200, 401, 503]) {
      const request = vi.fn().mockResolvedValue(json(status, {}));
      expect((await fetchTrackerState(request, { retryDelayMs: 1 })).status).toBe(status);
      expect(request).toHaveBeenCalledTimes(1);
    }
    const failing = vi.fn().mockResolvedValue(json(500, { error: 'still broken' }));
    expect((await fetchTrackerState(failing, { retryDelayMs: 1 })).status).toBe(500);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('describes the failure with status, code and server message for the diagnostic log', async () => {
    await expect(trackerStateFailure(json(500, { error: 'EPERM: operation not permitted, open db.json', code: 'X' }))).resolves.toBe('GET tracker state failed: HTTP 500 · X · EPERM: operation not permitted, open db.json');
    await expect(trackerStateFailure(new Response('not json', { status: 502 }))).resolves.toBe('GET tracker state failed: HTTP 502');
  });
});

describe('the file store under a brief Windows lock', () => {
  it('readDB waits out EPERM on db.json instead of failing the request', async () => {
    const fs = (await import('fs/promises')).default; const os = await import('os'); const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-lock-'));
    vi.stubEnv('DB_PATH', path.join(dir, 'db.json'));
    vi.resetModules();
    try {
      const { readDB } = await import('../lib/store');
      await readDB();
      const real = fs.readFile.bind(fs); let blocked = 0;
      const spy = vi.spyOn(fs, 'readFile').mockImplementation((async (file: any, ...rest: any[]) => {
        if (String(file).endsWith('db.json') && blocked < 2) { blocked += 1; throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); }
        return (real as any)(file, ...rest);
      }) as any);
      try {
        await expect(readDB()).resolves.toMatchObject({ matches: expect.any(Array) });
        expect(blocked).toBe(2);
      } finally { spy.mockRestore(); }
    } finally { vi.unstubAllEnvs(); vi.resetModules(); await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('saving under a brief Windows lock', () => {
  it('saveDB waits out EPERM when replacing db.json, and the saved file holds the change', async () => {
    const fs = (await import('fs/promises')).default; const os = await import('os'); const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-rename-'));
    const dbPath = path.join(dir, 'db.json');
    vi.stubEnv('DB_PATH', dbPath);
    vi.resetModules();
    try {
      const { readDB, saveDB } = await import('../lib/store');
      const db: any = await readDB();
      db.settings = { ...(db.settings || {}), teamName: 'Renamed under lock' };
      const real = fs.rename.bind(fs); let blocked = 0;
      const spy = vi.spyOn(fs, 'rename').mockImplementation((async (from: any, to: any) => {
        if (String(to) === dbPath && blocked < 2) { blocked += 1; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }); }
        return real(from, to);
      }) as any);
      try {
        await saveDB(db);
        expect(blocked).toBe(2);
      } finally { spy.mockRestore(); }
      expect(JSON.parse(await fs.readFile(dbPath, 'utf8')).settings.teamName).toBe('Renamed under lock');
      expect((await fs.readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally { vi.unstubAllEnvs(); vi.resetModules(); await fs.rm(dir, { recursive: true, force: true }); }
  });
});
