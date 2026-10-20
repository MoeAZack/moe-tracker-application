import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';

const adminKey = 'coaching-master-secret-at-least-24-characters'; const playerKey = 'coaching-player-key'; const playerId = '00000000-0000-4000-8000-000000000011';
let tempDir: string; let dbPath: string; let server: Server; let origin: string;
function fixture() { const db: any = createSeed(); db.rosterPlayers = [{ id: playerId, displayName: 'caelia', createdAt: '2026-10-18T10:00:00Z' }]; db.authKeys = [{ id: 'player', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), credentialType: 'access-key', label: 'caelia', role: 'player', playerId }]; db.matches = [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'PYO', map: 'Ascent', attW: 5, attL: 7, defW: 8, defL: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }]; db.playerStats = [{ id: 's1', matchId: 'm1', playerId, player: 'caelia', agent: 'Cypher', kills: 20, deaths: 15, assists: 4, kAtt: 10, kDef: 10, dAtt: 8, dDef: 7, aAtt: 2, aDef: 2, fk: 1, fd: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', buy: 'Full', enemyBuy: 'Full', result: 'L' }, { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Att', buy: 'Full', enemyBuy: 'Eco', result: 'L' }]; db.schedule = [{ id: '00000000-0000-4000-8000-000000000020', date: '2026-10-18', primary: 'PRACC vs PYO', calendarKey: 'practice', attendance: {} }, { id: 'talk', date: '2026-10-18', primary: 'Team Talk', calendarKey: 'team-talk', attendance: {} }, { id: 'debrief', date: '2026-10-18', primary: 'Debrief', calendarKey: 'debrief', attendance: {} }]; db.goals = [{ id: 'goal-1', date: '2026-10-18', goal: 'Anti-eco', status: 'Open' }]; return db; }
async function login(key: string) { const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }); expect(response.status).toBe(200); return (await response.json()).key as string; }
async function request(token: string, url: string, body?: unknown) { return fetch(`${origin}${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

beforeAll(async () => { vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-coaching-')); dbPath = path.join(tempDir, 'db.json'); for (const [key, value] of Object.entries({ NODE_ENV: 'test', USE_FIRESTORE: 'false', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: 'coaching-session-secret-at-least-24-characters', CRON_SECRET: 'coaching-cron-secret-at-least-24-characters', GEMINI_API_KEY: 'test', GOOGLE_CLIENT_ID: '' })) vi.stubEnv(key, value); await fs.writeFile(dbPath, JSON.stringify(fixture())); const { createApp } = await import('../server'); const app = await createApp(false); server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }, 15_000);
beforeEach(async () => { await fs.writeFile(dbPath, JSON.stringify(fixture())); });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(tempDir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('coaching workflow HTTP contract', () => {
  it('stores round review decisions, notes and local clip references on the canonical round', async () => {
    const coach = await login(adminKey);
    const first = await request(coach, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, note: 'Hold the crossfire before re-peeking.', classification: { type: 'first-death-review', status: 'confirmed', player: 'caelia', reason: 'Confirmed during VOD review.' } });
    expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ reviewCockpit: { note: 'Hold the crossfire before re-peeking.', classifications: [{ type: 'first-death-review', status: 'confirmed', player: 'caelia' }] } });
    const second = await request(coach, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, clips: [{ id: 'clip-1', fileName: 'round-1.mp4', label: 'R1 advantage lost', startMs: 12000, endMs: 28000 }] });
    expect(second.status).toBe(200); expect((await second.json()).reviewCockpit.clips).toEqual([expect.objectContaining({ id: 'clip-1', fileName: 'round-1.mp4' })]);
    const player = await login(playerKey); expect((await request(player, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, note: 'overwrite' })).status).toBe(403);
  });
  it('lets only a coach link a PRACC session to match and goal progress', async () => {
    const player = await login(playerKey); const body = { scheduleId: '00000000-0000-4000-8000-000000000020', matchIds: ['m1'], goalIds: ['goal-1'] };
    expect((await request(player, '/api/practice-sessions/link', body)).status).toBe(403);
    const coach = await login(adminKey); const response = await request(coach, '/api/practice-sessions/link', body); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toMatchObject({ session: { linkedGoalIds: ['goal-1'] }, block: { matchIds: ['m1'] }, progress: { linked: true } });
  });
  it('links Team Talk and Debrief symmetrically and rejects unrelated event types', async () => {
    const coach = await login(adminKey); const talk = fixture().schedule.find((item: any) => item.id === 'talk');
    const linked = await request(coach, '/api/upsert', { sheet: 'Schedule', row: { ...talk, linkedReviewEventId: 'debrief' } }); expect(linked.status).toBe(200);
    const data = await request(coach, '/api/data'); const schedule = (await data.json()).schedule; expect(schedule.find((item: any) => item.id === 'talk').linkedReviewEventId).toBe('debrief'); expect(schedule.find((item: any) => item.id === 'debrief').linkedReviewEventId).toBe('talk');
    expect((await request(coach, '/api/upsert', { sheet: 'Schedule', row: { ...talk, linkedReviewEventId: '00000000-0000-4000-8000-000000000020' } })).status).toBe(400);
    expect((await request(coach, '/api/remove', { sheet: 'Schedule', id: 'debrief' })).status).toBe(200); const afterDelete = await request(coach, '/api/data'); expect((await afterDelete.json()).schedule.find((item: any) => item.id === 'talk').linkedReviewEventId).toBeUndefined();
  });
  it('fails closed when a goal round is outside its selected match', async () => {
    const coach = await login(adminKey); const response = await request(coach, '/api/upsert', { sheet: 'Goals', row: { date: '2026-10-18', goal: 'Bad link', status: 'Open', matchId: 'm1', roundId: 'not-r1' } }); expect(response.status).toBe(400); expect((await response.json()).error).toContain('does not belong');
  });
  it('refreshes deterministic signals, persists review state, and creates a provenance-linked action', async () => {
    const token = await login(adminKey); const refreshed = await request(token, '/api/coaching/refresh', {}); expect(refreshed.status).toBe(200); const payload = await refreshed.json(); expect(payload.summaries).toHaveLength(1); expect(payload.signals.length).toBeGreaterThan(0);
    const source = payload.signals.find((signal: any) => signal.type === 'full-buy-loss'); expect(source).toBeTruthy();
    const corrected = await request(token, `/api/coaching/signals/${source.id}/correct`, { type: 'advantage-collapse', reason: 'Coach-confirmed VOD classification' }); expect(corrected.status).toBe(200); expect((await corrected.json()).classificationCorrections[0]).toMatchObject({ reason: 'Coach-confirmed VOD classification', original: { type: 'full-buy-loss' }, corrected: { type: 'advantage-collapse' } });
    const reviewed = await request(token, `/api/coaching/signals/${source.id}/status`, { status: 'accepted' }); expect(reviewed.status).toBe(200); expect((await reviewed.json()).status).toBe('accepted');
    const created = await request(token, '/api/coaching/actions', { signalId: source.id, kind: 'team-task', ownerIds: [playerId], priority: 'high', visibility: 'team' }); expect(created.status).toBe(201); const createdBody = await created.json(); const action = createdBody.action; expect(action).toMatchObject({ sourceSignalId: source.id, ownerIds: [playerId], state: 'assigned', goalId: createdBody.goal.id }); expect(action.evidence.matchIds).toEqual(['m1']); expect(createdBody.goal).toMatchObject({ ownerPlayerId: playerId, matchId: 'm1', coachingActionId: action.id, sourceSignalId: source.id });
  });

  it('keeps the private signal inbox hidden from players while exposing their team action', async () => {
    const coach = await login(adminKey); const refreshed = await request(coach, '/api/coaching/refresh', {}); const source = (await refreshed.json()).signals[0]; await request(coach, `/api/coaching/signals/${source.id}/status`, { status: 'accepted' }); await request(coach, '/api/coaching/actions', { signalId: source.id, ownerIds: [playerId], visibility: 'team' });
    const player = await login(playerKey); const response = await request(player, '/api/coaching'); expect(response.status).toBe(200); const payload = await response.json(); expect(payload.signals).toEqual([]); expect(payload.actions).toHaveLength(1);
    const acknowledged = await request(player, `/api/coaching/actions/${payload.actions[0].id}/status`, { state: 'acknowledged' }); expect(acknowledged.status).toBe(200); expect((await acknowledged.json()).state).toBe('acknowledged');
    const refreshedAgain = await request(coach, '/api/coaching/refresh', {}); const another = (await refreshedAgain.json()).signals.find((item: any) => item.status === 'new'); await request(coach, `/api/coaching/signals/${another.id}/status`, { status: 'accepted' }); const unowned = await request(coach, '/api/coaching/actions', { signalId: another.id, ownerIds: [], visibility: 'team' }); const unownedAction = (await unowned.json()).action;
    expect((await request(player, `/api/coaching/actions/${unownedAction.id}/status`, { state: 'in-progress' })).status).toBe(403);
  });

  it('allows dismissed review items to be recovered or permanently deleted', async () => {
    const coach = await login(adminKey); const refreshed = await request(coach, '/api/coaching/refresh', {}); const source = (await refreshed.json()).signals[0];
    const dismissed = await request(coach, `/api/coaching/signals/${source.id}/status`, { status: 'dismissed', reason: 'Not useful for this block.' }); expect(dismissed.status).toBe(200);
    const recovered = await request(coach, `/api/coaching/signals/${source.id}/status`, { status: 'new' }); expect(recovered.status).toBe(200); expect((await recovered.json()).status).toBe('new');
    await request(coach, `/api/coaching/signals/${source.id}/status`, { status: 'dismissed', reason: 'Delete after review.' });
    const removed = await fetch(`${origin}/api/coaching/signals/${source.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${coach}` } }); expect(removed.status).toBe(200); expect(await removed.json()).toEqual({ deleted: true, id: source.id });
  });

  it('does not let an assigned player discover or update a private action by ID', async () => {
    const coach = await login(adminKey); const refreshed = await request(coach, '/api/coaching/refresh', {}); const source = (await refreshed.json()).signals[0];
    await request(coach, `/api/coaching/signals/${source.id}/status`, { status: 'accepted' });
    const created = await request(coach, '/api/coaching/actions', { signalId: source.id, ownerIds: [playerId], visibility: 'private' }); const action = (await created.json()).action;
    const player = await login(playerKey); const listing = await request(player, '/api/coaching'); expect((await listing.json()).actions).toEqual([]);
    const response = await request(player, `/api/coaching/actions/${action.id}/status`, { state: 'acknowledged' }); expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: 'Players may acknowledge or start only their own team-visible actions.' });
  });
});
