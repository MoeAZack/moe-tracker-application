import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import pagesWorker, { CANONICAL_ORIGIN, canonicalRedirect } from '../cloudflare/pages-worker.js';

const get = (url: string, method = 'GET') => new Request(url, { method });

describe('one canonical website address', () => {
  it('sends page visits on the older addresses to moezack.pages.dev, keeping path and query', () => {
    expect(CANONICAL_ORIGIN).toBe('https://moezack.pages.dev');
    for (const legacy of ['https://moetracker-site.pages.dev', 'https://moetracker.moeazack.workers.dev', 'https://abc123.moetracker-site.pages.dev']) {
      const response = canonicalRedirect(get(`${legacy}/vod?match=m1`))!;
      expect(response.status).toBe(301);
      expect(response.headers.get('Location')).toBe('https://moezack.pages.dev/vod?match=m1');
    }
  });

  it('never redirects the API, writes, the canonical site, its previews, local dev or a custom domain', () => {
    expect(canonicalRedirect(get('https://moetracker-site.pages.dev/api/health'))).toBeNull();
    expect(canonicalRedirect(get('https://moetracker-site.pages.dev/api'))).toBeNull();
    expect(canonicalRedirect(get('https://moetracker-site.pages.dev/anything', 'POST'))).toBeNull();
    expect(canonicalRedirect(get('https://moezack.pages.dev/vod'))).toBeNull();
    expect(canonicalRedirect(get('https://f00d.moezack.pages.dev/vod'))).toBeNull();
    expect(canonicalRedirect(get('http://localhost:3000/'))).toBeNull();
    expect(canonicalRedirect(get('https://tracker.example.com/'))).toBeNull();
  });

  it('keeps installed desktops syncing through a legacy address while its pages move', async () => {
    const env = { API: { fetch: vi.fn(async () => new Response('api')) }, ASSETS: { fetch: vi.fn(async () => new Response('page')) } };
    expect(await (await pagesWorker.fetch(get('https://moetracker-site.pages.dev/api/sync', 'POST'), env)).text()).toBe('api');
    expect((await pagesWorker.fetch(get('https://moetracker-site.pages.dev/'), env)).status).toBe(301);
    expect(await (await pagesWorker.fetch(get('https://moezack.pages.dev/'), env)).text()).toBe('page');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('points new desktops, pairing and the deploy at the canonical site, and redirects on the workers.dev host too', () => {
    expect(fs.readFileSync('desktop/main.cjs', 'utf8')).toContain("cloudUrl: 'https://moezack.pages.dev'");
    expect(fs.readFileSync('src/components/DesktopDeviceSettings.tsx', 'utf8')).toContain("useState('https://moezack.pages.dev')");
    expect(fs.readFileSync('scripts/cf-deploy.mjs', 'utf8')).toContain("['moezack', 'moetracker-site']");
    expect(fs.readFileSync('cloudflare/worker.ts', 'utf8')).toContain('canonicalRedirect(request) || bindings.ASSETS.fetch(request)');
    expect(fs.readFileSync('cloudflare/worker.ts', 'utf8')).toContain("path === '/api' || path.startsWith('/api/')");
  });
});
