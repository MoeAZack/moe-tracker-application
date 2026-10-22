import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeed } from '../lib/seed';
import { recomputeAcceptedMatchAggregates } from '../lib/aggregateVersioning';
import { buildAutomaticCaptureImport } from '../lib/automaticCaptureImport';

const adminKey = 'coaching-master-secret-at-least-24-characters'; const playerKey = 'coaching-player-key'; const playerId = '00000000-0000-4000-8000-000000000011';
let tempDir: string; let dbPath: string; let server: Server; let origin: string;
function fixture() { const db: any = createSeed(); db.settings.stats.lowSample = 1; db.rosterPlayers = [{ id: playerId, displayName: 'caelia', createdAt: '2026-10-18T10:00:00Z' }]; db.authKeys = [{ id: 'player', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), credentialType: 'access-key', label: 'caelia', role: 'player', playerId }]; db.matches = [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'PYO', map: 'Ascent', attW: 5, attL: 7, defW: 8, defL: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }]; db.playerStats = [{ id: 's1', matchId: 'm1', playerId, player: 'caelia', agent: 'Cypher', kills: 20, deaths: 15, assists: 4, kAtt: 10, kDef: 10, dAtt: 8, dDef: 7, aAtt: 2, aDef: 2, fk: 1, fd: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }]; db.rounds = [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', buy: 'Full', enemyBuy: 'Full', result: 'L' }, { id: 'r2', matchId: 'm1', roundNo: 2, side: 'Att', buy: 'Full', enemyBuy: 'Eco', result: 'L' }]; db.schedule = [{ id: '00000000-0000-4000-8000-000000000020', date: '2026-10-18', primary: 'PRACC vs PYO', calendarKey: 'practice', attendance: {} }, { id: 'talk', date: '2026-10-18', primary: 'Team Talk', calendarKey: 'team-talk', attendance: {} }, { id: 'debrief', date: '2026-10-18', primary: 'Debrief', calendarKey: 'debrief', attendance: {} }]; db.goals = [{ id: 'goal-1', date: '2026-10-18', goal: 'Anti-eco', status: 'Open' }]; return db; }
async function login(key: string) { const response = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }); expect(response.status).toBe(200); return (await response.json()).key as string; }
async function request(token: string, url: string, body?: unknown) { return fetch(`${origin}${url}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }

beforeAll(async () => { vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-coaching-')); dbPath = path.join(tempDir, 'db.json'); for (const [key, value] of Object.entries({ NODE_ENV: 'test', DB_PATH: dbPath, ADMIN_PASSWORD: adminKey, JWT_SECRET: 'coaching-session-secret-at-least-24-characters', CRON_SECRET: 'coaching-cron-secret-at-least-24-characters', GEMINI_API_KEY: 'test' })) vi.stubEnv(key, value); await fs.writeFile(dbPath, JSON.stringify(fixture())); const { createApp } = await import('../server'); const app = await createApp(false); server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; }, 15_000);
beforeEach(async () => { await fs.writeFile(dbPath, JSON.stringify(fixture())); });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(tempDir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('coaching workflow HTTP contract', () => {
  it('stores round review decisions, notes and local clip references on the canonical round', async () => {
    const coach = await login(adminKey);
    const first = await request(coach, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, note: 'Hold the crossfire before re-peeking.', classification: { type: 'first-death-review', status: 'confirmed', player: 'caelia', reason: 'Confirmed during VOD review.' } });
    expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ reviewCockpit: { note: 'Hold the crossfire before re-peeking.', classifications: [{ type: 'first-death-review', status: 'confirmed', player: 'caelia' }] } });
    const second = await request(coach, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, clips: [{ id: 'clip-1', fileName: 'round-1.mp4', label: 'R1 advantage lost', startMs: 12000, endMs: 28000 }] });
    expect(second.status).toBe(200); expect((await second.json()).reviewCockpit.clips).toEqual([expect.objectContaining({ id: 'clip-1', fileName: 'round-1.mp4' })]);
    const corrected = await request(coach, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, factCorrection: { field: 'result', value: 'W', reason: 'Verified against the linked VOD.' } });
    expect(corrected.status).toBe(200); expect(await corrected.json()).toMatchObject({ result: 'W', reviewCockpit: { factCorrections: [{ field: 'result', previousValue: 'L', value: 'W', reason: 'Verified against the linked VOD.' }] } });
    expect((await request(coach, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, factCorrection: { field: 'result', value: 'maybe', reason: 'Invalid correction attempt.' } })).status).toBe(400);
    const player = await login(playerKey); expect((await request(player, '/api/vod/round-review', { matchId: 'm1', roundNo: 1, note: 'overwrite' })).status).toBe(403);
  });
  it('turns a reviewed round into a task the assigned player can see and start, with no metric check', async () => {
    const coach = await login(adminKey); const player = await login(playerKey);
    const body = { matchId: 'm1', roundNo: 2, title: 'Hold the trade on B main', kind: 'player-feedback', ownerIds: [playerId], vodSeconds: 754 };
    expect((await request(player, '/api/coaching/round-tasks', body)).status).toBe(403);
    expect((await request(coach, '/api/coaching/round-tasks', { ...body, matchId: 'missing' })).status).toBe(404);
    expect((await request(coach, '/api/coaching/round-tasks', { ...body, title: '  ' })).status).toBe(400);
    expect((await request(coach, '/api/coaching/round-tasks', { ...body, roundNo: 0 })).status).toBe(400);
    expect((await request(coach, '/api/coaching/round-tasks', { ...body, ownerIds: ['not-on-roster'] })).status).toBe(400);
    const created = await request(coach, '/api/coaching/round-tasks', body); expect(created.status).toBe(201);
    const { action } = await created.json();
    expect(action).toMatchObject({ title: 'Hold the trade on B main', kind: 'player-feedback', ownerIds: [playerId], visibility: 'team', state: 'assigned', check: null, sourceSignalId: '', evidence: { matchIds: ['m1'], roundIds: ['r2'] }, sourceRound: { matchId: 'm1', roundNo: 2, roundId: 'r2', map: 'Ascent', opponent: 'PYO', vodSeconds: 754 } });
    // A refresh does not drop or "evaluate" a task that has no metric behind it.
    expect((await request(coach, '/api/coaching/refresh', {})).status).toBe(200);
    const seen = await (await request(player, '/api/coaching')).json();
    expect(seen.actions).toEqual([expect.objectContaining({ id: action.id, sourceRound: expect.objectContaining({ roundNo: 2 }), outcome: null })]);
    expect((await request(player, `/api/coaching/actions/${action.id}/status`, { state: 'in-progress' })).status).toBe(200);
    // Without owners it is a staff note the players do not see.
    const staff = await (await request(coach, '/api/coaching/round-tasks', { matchId: 'm1', roundNo: 1, title: 'Rewatch the retake', kind: 'vod-review' })).json();
    expect(staff.action).toMatchObject({ visibility: 'staff', state: 'planned', ownerIds: [], sourceRound: { roundNo: 1, vodSeconds: null } });
    expect((await (await request(player, '/api/coaching')).json()).actions.map((item: any) => item.id)).toEqual([action.id]);
  });
  it('keeps a drawing on a VOD note as clean vectors and refuses a broken one', async () => {
    const coach = await login(adminKey);
    const reviews = await (await request(coach, '/api/vod/save', { review: { title: 'Player1 POV', vodUrl: 'https://youtu.be/abcdefghijk', matchId: 'm1' } })).json();
    const reviewId = reviews[0].id;
    const drawing = { strokes: [{ tool: 'arrow', color: '#ff4655', points: [[0.1, 0.2], [0.3, 0.3], [1.4, -0.2]] }, { tool: 'laser', color: '#ff4655', points: [[0, 0], [1, 1]] }] };
    const saved = await request(coach, '/api/vod/note', { reviewId, seconds: 754, timeLabel: '12:34', roundNo: 2, text: 'Swing wide here', drawing });
    expect(saved.status).toBe(200);
    const note = (await saved.json()).find((review: any) => review.id === reviewId).notes[0];
    expect(note).toMatchObject({ seconds: 754, roundNo: 2, text: 'Swing wide here', drawing: { schema: 'moetracker.frame-drawing/v1', strokes: [{ tool: 'arrow', color: '#ff4655', points: [[0.1, 0.2], [1, 0]] }] } });
    expect((await request(coach, '/api/vod/note', { reviewId, seconds: 5, text: 'Nothing drawn', drawing: { strokes: [] } })).status).toBe(400);
    const plain = await (await request(coach, '/api/vod/note', { reviewId, seconds: 6, text: 'No drawing' })).json();
    expect(plain.find((review: any) => review.id === reviewId).notes.find((item: any) => item.text === 'No drawing')).not.toHaveProperty('drawing');
  });
  it('lets only a coach link a PRACC session to match and goal progress', async () => {
    const player = await login(playerKey); const body = { scheduleId: '00000000-0000-4000-8000-000000000020', matchIds: ['m1'], goalIds: ['goal-1'] };
    expect((await request(player, '/api/practice-sessions/link', body)).status).toBe(403);
    const coach = await login(adminKey); const response = await request(coach, '/api/practice-sessions/link', body); expect(response.status).toBe(200);
    const result = await response.json(); expect(result).toMatchObject({ session: { linkedGoalIds: ['goal-1'] }, block: { matchIds: ['m1'] }, progress: { linked: true } });
  });
  it('links an automatically saved capture to the PRACC session it was played in', async () => {
    const db = fixture(); db.schedule.push({ id: 'pracc-slot', source: 'pracc', date: '2026-10-20', startTime: '20:00', durationMinutes: 120, primary: 'Practice vs Nova', secondary: '', attendance: {} }); await fs.writeFile(dbPath, JSON.stringify(db));
    const coach = await login(adminKey);
    const match = { date: '2026-10-20', type: 'Scrim', opponent: 'Nova', map: 'Ascent', ourScore: 13, theirScore: 9, reviewConfirmation: { alliedSideConfirmed: true }, automation: { mode: 'complete-capture-consensus', editable: true, praccScheduleId: 'pracc-slot' } };
    const response = await request(coach, '/api/save-match', { match, statsUpdate: { operation: 'preserve' } }); expect(response.status).toBe(200);
    const saved = (await response.json()).match; const data = await (await request(coach, '/api/data')).json();
    const session = data.schedule.find((item: any) => item.id === 'pracc-slot'); expect(session).toMatchObject({ progressLinkedAutomatically: true });
    expect(data.practiceBlocks.find((block: any) => block.id === session.practiceBlockId).matchIds).toEqual([saved.id]);
  });
  it('accepts the payload the automatic capture pipeline builds', async () => {
    const coach = await login(adminKey); const current = await (await request(coach, '/api/data')).json();
    const extracted = {
      meta: { map: current.settings.maps[0], ourScore: 13, theirScore: 9 }, startingSide: { firstHalf: 'Att' }, reconciled: { missing: [] },
      sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-20T18:30:00.000Z', provider: 'tesseract-local', model: 'tesseract/eng-1.0.0/parser-v1' },
      players: Array.from({ length: 10 }, (_, index) => ({ include: index < 5, matchedPlayerId: null, extractedName: `Auto${"abcdefghij"[index]}`, agent: 'Jett', kills: 10 + index, deaths: 8, assists: 4 })),
      rounds: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index < 13 ? 'W' : 'L', screenshotEvidence: { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'high', players: [], events: [], objectives: [], eventsComplete: false } })),
    };
    const { payload, decision } = buildAutomaticCaptureImport(extracted, current, 'auto-capture', '2026-10-20T18:30:00.000Z'); expect(decision.reasons).toEqual([]);
    const response = await request(coach, '/api/save-match', { match: payload!.match, statsUpdate: { operation: 'replace', stats: payload!.stats }, rounds: payload!.roundRows });
    expect(response.status).toBe(200); expect((await response.json()).match).toMatchObject({ opponent: 'Unknown opponent', reviewConfirmation: { alliedSideConfirmed: true } });
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
  it('reads a stored 0.1.x screenshot metric as unknown in coaching summaries and round saves, and keeps it stored', async () => {
    const db = fixture(); const stale = { schemaVersion: 1, calculationVersion: 'player-screenshot/v0', coveredRounds: 1, kast: { successful: 1, covered: 1 }, multikills: { two: 1, three: 0, four: 0, ace: 0 }, weapons: [] };
    db.playerStats[0].screenshotMetrics = stale; await fs.writeFile(dbPath, JSON.stringify(db));
    const coach = await login(adminKey);
    const summaries = (await (await request(coach, '/api/coaching')).json()).summaries;
    expect(summaries[0].roster[0]).toMatchObject({ multikills: null });
    const saved = await request(coach, '/api/save-rounds', { matchId: 'm1', rows: db.rounds.filter((round: any) => round.matchId === 'm1') });
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body.playerStats[0]).not.toHaveProperty('screenshotMetrics'); expect(body.screenshotSummary?.playerStats || []).toEqual([]);
    expect(JSON.parse(await fs.readFile(dbPath, 'utf8')).playerStats[0].screenshotMetrics).toEqual(stale);
  });
  it('returns practice-session progress with a stale stored metric as unknown and a current one as a number', async () => {
    const coach = await login(adminKey); const body = { scheduleId: '00000000-0000-4000-8000-000000000020', matchIds: ['m1'] };
    const linkedRow = async (db: any) => { await fs.writeFile(dbPath, JSON.stringify(db)); const response = await request(coach, '/api/practice-sessions/link', body); expect(response.status).toBe(200); return (await response.json()).progress.summary.roster[0]; };
    const stale = fixture(); stale.playerStats[0].screenshotMetrics = { schemaVersion: 1, calculationVersion: 'player-screenshot/v0', coveredRounds: 1, kast: { successful: 1, covered: 1 }, multikills: { two: 1, three: 0, four: 0, ace: 0 }, weapons: [{ weapon: 'Vandal', kills: 2 }] };
    expect(await linkedRow(stale)).toMatchObject({ multikills: null, kast: null });
    // The same row with a metric 0.2.0 rebuilt from id-linked round evidence.
    const current = fixture(); current.rounds[0].screenshotEvidence = { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'confirmed', eventsComplete: true,
      players: [{ playerId, displayName: 'caelia', team: 'ours', assists: 0, survived: true }],
      events: [{ sequence: 1, killerPlayerId: playerId, victimPlayerId: 'enemy-1' }, { sequence: 2, killerPlayerId: playerId, victimPlayerId: 'enemy-2' }] };
    recomputeAcceptedMatchAggregates(current, 'm1');
    expect(current.playerStats[0].screenshotMetrics).toBeTruthy();
    expect((await linkedRow(current)).multikills).toBe(1);
  });
});

