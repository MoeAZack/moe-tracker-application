import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';
afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); tempDir = ''; });

describe('durable login throttling', () => {
  it('persists account failures outside the main tracker state and clears them after success', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-login-throttle-'));
    const dbPath = path.join(tempDir, 'db.json'); vi.stubEnv('DB_PATH', dbPath); vi.stubEnv('USE_FIRESTORE', 'false');
    const store = await import('../lib/store');
    for (let attempt = 0; attempt < 5; attempt += 1) await store.recordLoginThrottleFailure('account:example', 1_000 + attempt);
    expect(await store.loginThrottleRemaining('account:example', 2_000)).toBeGreaterThan(0);
    expect(await fs.readFile(`${dbPath}.login-throttle.json`, 'utf8')).not.toContain('account:example');
    await store.clearLoginThrottle('account:example');
    expect(await store.loginThrottleRemaining('account:example', 2_000)).toBe(0);
  });
});

