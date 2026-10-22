import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

const adminKey = 'pracc-sync-master-secret-at-least-24-characters';
const feedUrl = 'https://pracc.com/api/matches/synthetic-feed/calendar.ics';
const feed = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:practice-1@pracc.com', 'DTSTART:20261025T120000Z', 'DTEND:20261025T140000Z', 'SUMMARY:Practice', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const realFetch = globalThis.fetch;
let tempDir: string; let dbPath: string; let server: Server; let origin: string; let praccCalls = 0;
let release: () => void = () => {};

async function login() { const response = await realFetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: adminKey }) }); return (await response.json()).key as string; }
const post = (token: string, url: string, body: unknown) => realFetch(`${origin}${url}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-pracc-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: 'pracc-sync-session-secret-at-least-24-chars', CRON_SECRET: 'pracc-sync-cron-secret-at-least-24-characters', GEMINI_API_KEY: 'test' })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify(createSeed()));
  // PRACC is faked; every other request (the test's own HTTP calls) is real.
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    if (!String(input).startsWith('https://pracc.com/')) return realFetch(input, init);
    praccCalls += 1; await new Promise<void>(resolve => { release = resolve; });
    return new Response(feed, { status: 200, headers: { 'content-type': 'text/calendar' } });
  });
  const { createApp } = await import('../server'); const app = await createApp(false);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 15_000);
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(tempDir, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('PRACC calendar sync HTTP contract', () => {
  it('shares one in-flight sync between concurrent requests and survives writes made while it downloads', async () => {
    const coach = await login();
    const configured = post(coach, '/api/pracc/calendar/configure', { url: feedUrl });
    await vi.waitFor(() => expect(praccCalls).toBe(1));
    const concurrent = post(coach, '/api/pracc/calendar/sync', { force: true });
    // An unrelated write lands while PRACC is still downloading.
    const goal = await post(coach, '/api/upsert', { sheet: 'Goals', row: { id: 'goal-during-sync', date: '2026-10-20', goal: 'Anti-eco', status: 'Open' } });
    expect(goal.status).toBe(200);
    release();
    const [first, second] = await Promise.all([configured, concurrent]);
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    expect(praccCalls).toBe(1);
    const db = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(db.schedule.filter((row: any) => row.source === 'pracc')).toHaveLength(1);
    expect(db.goals.some((row: any) => row.id === 'goal-during-sync')).toBe(true);
    expect(db.settings.praccCalendarUrl).toBe(feedUrl);
  });
});
