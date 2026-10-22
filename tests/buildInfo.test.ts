import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildInfo } from '../lib/buildInfo';
import { buildRevision } from '../scripts/build-revision.mjs';

let tempDir: string | undefined; let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  server = undefined; tempDir = undefined; vi.unstubAllEnvs();
});

describe('build identity', () => {
  it('names the surface, version and revision, and says development when unstamped', () => {
    expect(buildInfo({ CLOUDFLARE_WORKER: 'true', APP_REVISION: 'abc123', APP_VERSION: '0.2.0' })).toEqual({ version: '0.2.0', revision: 'abc123', surface: 'website' });
    expect(buildInfo({ APP_DESKTOP: 'true', APP_VERSION: '0.2.0' })).toEqual({ version: '0.2.0', revision: 'development', surface: 'desktop' });
    expect(buildInfo({})).toEqual({ version: null, revision: 'development', surface: 'server' });
  });

  it('takes the revision from CI when given and from git otherwise', () => {
    expect(buildRevision({ APP_REVISION: 'ci-sha' })).toBe('ci-sha');
    expect(buildRevision({})).toMatch(/^([0-9a-f]{12}(-dirty)?|development)$/);
  });

  it('reports the build on /api/health and keeps the legacy build field', async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-health-'));
    const dbPath = path.join(tempDir, 'db.json'); await fs.writeFile(dbPath, JSON.stringify({ matches: [], rounds: [], playerStats: [] }));
    for (const [key, value] of Object.entries({ NODE_ENV: 'test', DB_PATH: dbPath, ADMIN_PASSWORD: 'health-test-master-secret-24-chars', JWT_SECRET: 'health-test-session-secret-24-chars', APP_REVISION: 'deadbeef1234', APP_VERSION: '0.2.0', APP_DESKTOP: 'true' })) vi.stubEnv(key, value);
    const { createApp } = await import('../server');
    const app = await createApp(false);
    server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const body = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`)).json();
    expect(body).toMatchObject({ status: 'ok', build: 'deadbeef1234', revision: 'deadbeef1234', version: '0.2.0', surface: 'desktop' });
  });

  it('stamps the static bundle with build.json and the deploy scripts with the revision', async () => {
    const vite = await fs.readFile('vite.config.ts', 'utf8');
    expect(vite).toContain("fileName: 'build.json'");
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    expect(pkg.scripts['cf:worker:deploy']).toBe('node scripts/cf-deploy.mjs worker');
    expect(pkg.scripts['cf:pages:deploy']).toBe('node scripts/cf-deploy.mjs pages');
    expect(await fs.readFile('scripts/cf-deploy.mjs', 'utf8')).toContain('--var APP_REVISION:${revision}');
  });
});
