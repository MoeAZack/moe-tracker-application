import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir: string | undefined;
let server: Server | undefined;

async function policyFor(nodeEnv: string, serveFrontend: boolean) {
  vi.resetModules();
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-csp-'));
  const dbPath = path.join(tempDir, 'db.json');
  await fs.writeFile(dbPath, JSON.stringify({ matches: [], rounds: [], playerStats: [] }));
  for (const [key, value] of Object.entries({
    NODE_ENV: nodeEnv, USE_FIRESTORE: 'false', DB_PATH: dbPath,
    ADMIN_PASSWORD: 'csp-test-master-secret-24-characters', JWT_SECRET: 'csp-test-session-secret-24-characters', GEMINI_API_KEY: 'test-no-external-calls', GOOGLE_CLIENT_ID: '',
  })) vi.stubEnv(key, value);
  const { createApp } = await import('../server');
  const app = await createApp(serveFrontend);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`);
  return directives(response.headers.get('content-security-policy') || '');
}

function directives(policy: string) {
  return new Map(policy.split(';').map(item => item.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]));
}

afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  vi.unstubAllEnvs(); vi.resetModules();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe('content security policy', () => {
  it('refuses inline script on the built app the desktop and website serve', async () => {
    const policy = await policyFor('production', true);
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", 'https://accounts.google.com', 'https://apis.google.com']);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
  });

  it('refuses inline script on the API-only server', async () => {
    expect((await policyFor('test', false)).get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('ships the same script policy in the Cloudflare Pages headers', async () => {
    const headers = await fs.readFile(path.join(process.cwd(), 'public', '_headers'), 'utf8');
    const line = headers.split('\n').find(item => item.trim().startsWith('Content-Security-Policy:'));
    const policy = directives(String(line).trim().replace(/^Content-Security-Policy:\s*/, ''));
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", 'https://accounts.google.com', 'https://apis.google.com']);
  });
});
