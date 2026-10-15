import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

const adminKey = 'attendance-master-secret-at-least-24-characters';
const playerKey = 'attendance-player-key';
const playerId = '00000000-0000-4000-8000-000000000001';
let tempDir: string; let dbPath: string; let server: Server; let origin: string;

function cairoNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function fixture() {
  const current = cairoNow();
  return { ...createSeed(), rosterPlayers: [{ id: playerId, displayName: 'Alpha', createdAt: new Date().toISOString() }], schedule: [{ id: 'practice-now', date: current.date, startTime: current.time, primary: 'Practice', attendance: {}, attendanceEnabled: true, requiredPlayerIds: [playerId], attendanceCheckIns: [] }], authKeys: [{ id: 'player-key', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Alpha', role: 'player', playerId }] };
}

async function login(key: string) {
  const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  expect(response.status).toBe(200); return (await response.json()).key as string;
}

beforeAll(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-attendance-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, value] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: 'attendance-session-secret-at-least-24-characters', CRON_SECRET: 'attendance-cron-secret-at-least-24-characters', GEMINI_API_KEY: 'test', GOOGLE_CLIENT_ID: '' })) vi.stubEnv(key, value);
  await fs.writeFile(dbPath, JSON.stringify(fixture())); const { createApp } = await import('../server'); const app = await createApp(false);
  server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 15_000);

beforeEach(async () => { await fs.writeFile(dbPath, JSON.stringify(fixture())); });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(tempDir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('attendance HTTP permissions and idempotency', () => {
  it('lets only the linked assigned player check in and returns the same record on retry', async () => {
    const token = await login(playerKey); const request = () => fetch(`${origin}/api/attendance/check-in`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduleId: 'practice-now' }) });
    const first = await request(); expect(first.status).toBe(201); const created = await first.json(); expect(created.checkIn).toMatchObject({ playerId, status: 'on-time' });
    const second = await request(); expect(second.status).toBe(200); expect((await second.json()).checkIn.id).toBe(created.checkIn.id);
  });

  it('keeps corrections and green-dot decisions coach-only', async () => {
    const token = await login(playerKey);
    for (const [pathName, body] of [['/api/attendance/correct', { scheduleId: 'practice-now', playerId, status: 'excused', reason: 'Approved' }], ['/api/attendance/green-credit', { playerId, reason: 'Good streak' }]] as const) {
      const response = await fetch(`${origin}${pathName}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); expect(response.status).toBe(403);
    }
  });
});
