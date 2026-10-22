import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';
afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); tempDir = ''; });

describe('durable login throttling', () => {
  it('persists account failures outside the main tracker state and clears them after success', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-login-throttle-'));
    const dbPath = path.join(tempDir, 'db.json'); vi.stubEnv('DB_PATH', dbPath); 
    const store = await import('../lib/store');
    for (let attempt = 0; attempt < 5; attempt += 1) await store.recordLoginThrottleFailure('account:example', 1_000 + attempt);
    expect(await store.loginThrottleRemaining('account:example', 2_000)).toBeGreaterThan(0);
    expect(await fs.readFile(`${dbPath}.login-throttle.json`, 'utf8')).not.toContain('account:example');
    await store.clearLoginThrottle('account:example');
    expect(await store.loginThrottleRemaining('account:example', 2_000)).toBe(0);
  });

  it('counts parallel D1 failures with one atomic upsert per attempt', async () => {
    const rows = new Map<string, { fails: number; locked_until: number }>(); const statements: string[] = [];
    const d1 = { exec: vi.fn(), prepare(sql: string) { statements.push(sql); return { bind: (...args: any[]) => ({
      async run() { const key = args[0]; if (sql.startsWith('DELETE')) { rows.delete(key); return; } const current = rows.get(key); if (!current) rows.set(key, { fails: 1, locked_until: 0 }); else if (current.locked_until <= args[2]) rows.set(key, current.fails + 1 >= args[3] ? { fails: 0, locked_until: args[6] } : { fails: current.fails + 1, locked_until: 0 }); },
      async first() { const row = rows.get(args[0]); return row ? { locked_until: row.locked_until } : null; },
    }) }; } };
    const store = await import('../lib/store'); store.configureD1Store(d1);
    await Promise.all(Array.from({ length: 5 }, (_, index) => store.recordLoginThrottleFailure('parallel-account', 10_000 + index)));
    expect(await store.loginThrottleRemaining('parallel-account', 11_000)).toBeGreaterThan(0);
    expect(statements.filter(sql => sql.startsWith('SELECT fails'))).toHaveLength(0);
    store.configureD1Store(null);
  });
});

