import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adminKey = 'review-admin-secret-at-least-24-characters';
const playerKey = 'review-player-secret';
const sha256 = 'a'.repeat(64);
const secondSha256 = 'd'.repeat(64);
let tempDir: string; let dbPath: string; let server: Server | undefined; let origin: string;

const value = (entry: number | string) => ({ value: entry, status: 'available', source: 'synthetic-redacted-fixture', confidence: 1 });
const players = [
  { playerId: 'raw-a', teamId: 'team-us', displayName: value('Player A'), kills: value(2), deaths: value(0), assists: value(1), firstBloods: value(1), firstDeaths: value(0), plants: value(1), defuses: value(0) },
  { playerId: 'raw-b', teamId: 'team-us', displayName: value('Player B'), kills: value(1), deaths: value(1), assists: value(2), firstBloods: value(0), firstDeaths: value(1), plants: value(0), defuses: value(1) },
  { playerId: 'raw-x', teamId: 'team-them', displayName: value('Opponent X'), kills: value(1), deaths: value(2), assists: value(0), firstBloods: value(0), firstDeaths: value(1), plants: value(0), defuses: value(0) },
  { playerId: 'raw-y', teamId: 'team-them', displayName: value('Opponent Y'), kills: value(0), deaths: value(1), assists: value(0), firstBloods: value(0), firstDeaths: value(0), plants: value(0), defuses: value(0) },
];
const reviewDraft = {
  contractVersion: 1, status: 'review-required', reviewRequired: true, writable: false,
  parser: { name: 'vrfkit', version: '0.2.5' }, provenance: { replaySha256: sha256 }, file: { format: 'vrf', support: 'supported' }, crossChecks: [],
  rounds: [{ roundNumber: 1, status: 'resolved', firstKillPlayerId: 'raw-a', firstDeathPlayerId: 'raw-x', sourceEventId: 'e1', reason: null, excludedEventCount: 0 }],
  coverage: { playedRounds: 1, resolvedRounds: 1, unknownRounds: 0, resolvedPercent: 100, unknownReasons: {} },
  playerTotals: players.map(item => ({ playerId: item.playerId, observedFirstKills: evidence(item.firstBloods), observedFirstDeaths: evidence(item.firstDeaths), firstKills: evidence(item.firstBloods), firstDeaths: evidence(item.firstDeaths) })),
  evidence: { tradeWindowMs: 5000, capabilities: [], observations: [], observationIssues: [], coverageBySignal: [{ signal: 'eliminations', support: 'complete', grade: 'event-log', coveredRounds: 1, playedRounds: 1 }], playerMetrics: players.map(item => ({ playerId: item.playerId, kills: evidence(item.kills), deaths: evidence(item.deaths), assists: evidence(item.assists), damage: item.teamId === 'team-us' ? 250 : 100, utilityCasts: null, utilityEffects: null, ultimateUses: null, plants: evidence(item.plants), defuses: evidence(item.defuses) })), rounds: [{ roundNumber: 1, events: [], winnerTeamId: 'team-us', endReason: 'elimination', sideByTeam: { 'team-us': 'attack', 'team-them': 'defense' }, derived: { tradeOpportunities: 1, successfulTrades: 1, tradedDeathPlayerIds: ['raw-b'], multikills: [{ playerId: 'raw-a', kills: 2 }], clutches: [] } }] },
};
function evidence(field: any) { return field.status === 'available' ? field.value : null; }
const parserResult = { scoreboard: { reviewRequired: true, evidenceCoverage: { status: 'complete', reason: null }, map: value('Haven'), durationMs: value(120000), finalScore: { teamA: { teamId: 'team-us', score: value(1) }, teamB: { teamId: 'team-them', score: value(0) } }, players, unavailableFields: [] }, reviewDraft, diagnostics: { replaySha256: sha256, binarySha256: 'b'.repeat(64), binaryVersion: '0.2.5', binaryCommit: 'redacted', manifestSha256: 'c'.repeat(64), replayBuild: 'fixture', outputFileCount: 1, outputBytes: 1, identityMappingComplete: true, duplicateActorMappings: 0, duplicatePawnMappings: 0 } };
const formula = { version: 'shadow/replay-fixture-v1', weights: { killsPerRound: .25, deathsPerRound: .2, assistsPerRound: .1, averageDamagePerRound: .15, kastRate: .15, firstKillsPerRound: .1, firstDeathsPerRound: .05 }, thresholds: { minimumCoverage: .5, minimumMatches: 1, minimumRounds: 1, minimumMetricSamples: 1, minimumBaselineRounds: 1 }, zCap: 3, center: 1, scale: .15, bounds: { minimum: 0, maximum: 2 } };
const baseline = { id: 'replay-fixture', version: 'baseline/replay-fixture-v1', mode: 'scrim', source: { id: 'replay', version: '1' }, metrics: Object.fromEntries(Object.keys(formula.weights).map(key => [key, { median: key === 'averageDamagePerRound' ? 130 : .5, mad: key === 'averageDamagePerRound' ? 10 : .1, rounds: 10 }])) };

async function request(route: string, token?: string, body?: unknown) { return fetch(`${origin}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
async function login(key: string) { const response = await request('/api/login-key', undefined, { key }); expect(response.status).toBe(200); return (await response.json()).key as string; }
const mappings = [
  { parserPlayerId: 'raw-a', rosterPlayerId: 'p1', displayName: 'Reviewed Alpha' }, { parserPlayerId: 'raw-b', rosterPlayerId: 'p2', displayName: 'Reviewed Bravo' },
  { parserPlayerId: 'raw-x', rosterPlayerId: null, displayName: 'Opponent X' }, { parserPlayerId: 'raw-y', rosterPlayerId: null, displayName: 'Opponent Y' },
];

beforeEach(async () => {
  vi.resetModules(); tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-replay-review-')); dbPath = path.join(tempDir, 'db.json');
  for (const [key, entry] of Object.entries({ NODE_ENV: 'test', DB_PATH: dbPath, REPLAY_STORAGE_DIR: path.join(tempDir, 'private'), ADMIN_PASSWORD: adminKey, JWT_SECRET: 'review-session-secret-at-least-24-characters' })) vi.stubEnv(key, entry);
  await fs.writeFile(dbPath, JSON.stringify({
    settings: {}, matches: [{ id: 'm1', date: '2026-10-03', type: 'Scrim', opponent: 'Redacted', map: 'Haven', rosterContext: { kind: 'core' } }], playerStats: [], seasonArchives: [],
    rosterPlayers: [{ id: 'p1', displayName: 'Alpha', retiredAt: null }, { id: 'p2', displayName: 'Bravo', retiredAt: null }], coreMemberships: [{ id: 'c1', playerId: 'p1', joinedAt: '2026-01-01' }, { id: 'c2', playerId: 'p2', joinedAt: '2026-01-01' }],
    authKeys: [{ id: 'player-key', keyHash: crypto.createHash('sha256').update(playerKey).digest('hex'), label: 'Alpha', role: 'player', playerId: 'p1' }], allowedUsers: [],
    replayIntake: { schemaVersion: 4, devices: { d_fixture01: { id: 'd_fixture01', name: 'Fixture PC', tokenHash: 'redacted', credentialVersion: 1, owner: { actorId: 'key:admin', role: 'coach', playerId: null }, createdAt: '2026-10-03T00:00:00.000Z', expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: null, lastSeenAt: null } }, blobs: { [sha256]: { sha256, size: 100, storedAt: '2026-10-03T00:00:00.000Z', parserStatus: 'parsed-review-required', parserJobId: 'job1', reviewStatus: 'review-required', matchId: null } }, associations: { receipt: { id: 'receipt', sha256, size: 100, originalName: 'redacted-fixture.vrf', deviceId: 'd_fixture01', owner: { actorId: 'key:admin', role: 'coach', playerId: null }, receivedAt: '2026-10-03T00:00:00.000Z' }, playerReceipt: { id: 'player-receipt', sha256, size: 100, originalName: 'player-redacted-fixture.vrf', deviceId: 'd_player01', owner: { actorId: 'key:player-key', role: 'player', playerId: 'p1' }, receivedAt: '2026-10-03T00:00:00.000Z' } }, parserJobs: { job1: { id: 'job1', sha256, requestedBy: 'key:admin', sourceDeviceIds: ['d_fixture01'], status: 'completed', createdAt: '2026-10-03T00:00:00.000Z', startedAt: '2026-10-03T00:00:01.000Z', completedAt: '2026-10-03T00:00:02.000Z', parser: { name: 'vrfkit', version: '0.2.5' }, reviewStatus: 'review-required', result: parserResult } }, reviews: {} },
    engineAdapters: { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: { config: { key: `${formula.version}:${baseline.id}:${baseline.version}`, calibrationStatus: 'uncalibrated', formula, baseline } }, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } },
  }));
  const { createApp } = await import('../server'); const app = await createApp(false); server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); }); origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined; } vi.unstubAllEnvs(); vi.resetModules(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); });

describe('coach replay review workflow', () => {
  it.each([
    ['tied unresolved ordering', [{ kind: 'player-elimination', timestampMs: 1_000, killerPlayerId: 'raw-a', victimPlayerId: 'raw-x' }, { kind: 'player-elimination', timestampMs: 1_000, killerPlayerId: 'raw-b', victimPlayerId: 'raw-y' }]],
    ['repeated impossible death', [{ kind: 'player-elimination', timestampMs: 1_000, killerPlayerId: 'raw-a', victimPlayerId: 'raw-x' }, { kind: 'player-elimination', timestampMs: 2_000, killerPlayerId: 'raw-b', victimPlayerId: 'raw-x' }]],
    ['incomplete participant identity', [{ kind: 'player-elimination', timestampMs: 1_000, killerPlayerId: 'raw-a', victimPlayerId: 'missing-player' }]],
  ])('does not accept complete advantage evidence from %s', async (_label, events) => {
    const coach = await login(adminKey); const seeded = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    const round = seeded.replayIntake.parserJobs.job1.result.reviewDraft.evidence.rounds[0];
    round.events = events; round.winnerTeamId = 'team-them';
    round.derived = { tradeOpportunities: null, successfulTrades: null, tradedDeathPlayerIds: null, multikills: null, clutches: null };
    await fs.writeFile(dbPath, JSON.stringify(seeded));
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: `invalid-${_label}`, matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(200);
    expect((await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, { expectedRevision: 1, requestId: `accept-${_label}`, confirmed: true })).status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); const advantage = stored.rounds.find((item: any) => item.matchId === 'm1' && item.roundNo === 1).advantageEvidence;
    expect(advantage).toMatchObject({ status: 'partial', states: [] });
  });

  it('accepts a replay-engine-validated lost 5v3 advantage', async () => {
    const coach = await login(adminKey); const seeded = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    const round = seeded.replayIntake.parserJobs.job1.result.reviewDraft.evidence.rounds[0];
    round.events = [
      { kind: 'player-elimination', timestampMs: 1_000, killerPlayerId: 'raw-a', victimPlayerId: 'raw-x' },
      { kind: 'player-elimination', timestampMs: 2_000, killerPlayerId: 'raw-b', victimPlayerId: 'raw-y' },
    ];
    round.winnerTeamId = 'team-them'; round.endReason = 'spike-detonated';
    round.derived = { tradeOpportunities: 2, successfulTrades: 0, tradedDeathPlayerIds: [], multikills: [], clutches: [] };
    await fs.writeFile(dbPath, JSON.stringify(seeded));
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'valid-5v3', matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(200);
    expect((await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, { expectedRevision: 1, requestId: 'accept-valid-5v3', confirmed: true })).status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); const advantage = stored.rounds.find((item: any) => item.matchId === 'm1' && item.roundNo === 1).advantageEvidence;
    expect(advantage).toMatchObject({ status: 'complete', roundOutcome: 'lost', states: expect.arrayContaining([expect.objectContaining({ label: '5v3', differential: 2, outcome: 'lost' })]) });
  });

  it('keeps the existing score and uncertainty when accepted replay score is incomplete', async () => {
    const coach = await login(adminKey); const seeded = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    seeded.matches[0].ourScore = 8; seeded.matches[0].theirScore = 16;
    seeded.matches[0].scoreEvidence = { source: 'vod-hud', basis: 'end-banner', reads: 2 };
    seeded.matches[0].partialScore = { ours: 8, theirs: 15, source: 'vod-hud' };
    seeded.replayIntake.parserJobs.job1.result.scoreboard.finalScore.teamB.score = { value: null, status: 'unavailable', source: 'synthetic-redacted-fixture', confidence: 0 };
    await fs.writeFile(dbPath, JSON.stringify(seeded));
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'partial-score-review', matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(200);
    expect((await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, { expectedRevision: 1, requestId: 'partial-score-accept', confirmed: true })).status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8')); const match = stored.matches[0];
    expect(match).toMatchObject({ ourScore: 8, theirScore: 16, scoreEvidence: { source: 'vod-hud' }, partialScore: { ours: 8, theirs: 15 } });
    expect(match.scoreVerification).toBeUndefined();
    const { applyVerifiedMatchScore } = await import('../lib/vodScore');
    applyVerifiedMatchScore(match, 9, 15, 'scoreboard');
    expect(match).toMatchObject({ ourScore: 9, theirScore: 15, scoreVerification: { source: 'scoreboard' } });
  });

  it('creates new allied profiles on explicit replay acceptance beside a twenty-profile library', async () => {
    const coach = await login(adminKey); const seeded = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    seeded.rosterPlayers.push(...Array.from({ length: 18 }, (_, index) => ({ id: `extra-${index}`, displayName: `Existing profile ${index}`, retiredAt: null })));
    const result = seeded.replayIntake.parserJobs.job1.result;
    const rawAlpha = result.scoreboard.players.find((player: any) => player.playerId === 'raw-a');
    rawAlpha.firstBloods = { value: null, status: 'unavailable', source: 'synthetic-redacted-fixture', confidence: 0 };
    rawAlpha.plants = { value: null, status: 'unavailable', source: 'synthetic-redacted-fixture', confidence: 0 };
    result.reviewDraft.evidence.rounds[0].events = [
      { kind: 'player-elimination', timestampMs: 1_000, killerPlayerId: 'raw-x', victimPlayerId: 'raw-b' },
      { kind: 'player-elimination', timestampMs: 2_000, killerPlayerId: 'raw-a', victimPlayerId: 'raw-x' },
    ];
    await fs.writeFile(dbPath, JSON.stringify(seeded));
    const unresolved = mappings.map(item => item.parserPlayerId === 'raw-a' || item.parserPlayerId === 'raw-b' ? { ...item, rosterPlayerId: null, displayName: item.parserPlayerId === 'raw-a' ? 'New Replay Alpha' : 'New Replay Bravo' } : item);
    const saved = await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'new-profile-review', matchId: 'm1', teamId: 'team-us', mappings: unresolved });
    expect(saved.status).toBe(200);
    expect(JSON.parse(await fs.readFile(dbPath, 'utf8')).rosterPlayers).toHaveLength(20);
    const accepted = await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, { expectedRevision: 1, requestId: 'new-profile-accept', confirmed: true });
    expect(accepted.status).toBe(200);
    const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    expect(stored.rosterPlayers).toHaveLength(22);
    const created = stored.rosterPlayers.filter((player: any) => ['New Replay Alpha', 'New Replay Bravo'].includes(player.displayName));
    expect(created.every((player: any) => player.rosterStatus === 'standIn')).toBe(true);
    expect(stored.playerStats.filter((row: any) => created.some((player: any) => player.id === row.playerId)).map((row: any) => [row.player, row.kills, row.deaths, row.assists])).toEqual([['New Replay Alpha', 2, 0, 1], ['New Replay Bravo', 1, 1, 2]]);
    expect(stored.playerStats.find((row: any) => row.player === 'New Replay Alpha')).toMatchObject({ fk: 1, plants: 1, trades: 1 });
  });

  it('enforces coach ownership, explicit complete mappings, collision checks and stale revisions', async () => {
    const coach = await login(adminKey); const player = await login(playerKey);
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, player, { expectedRevision: 0, requestId: 'player-attempt', matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(403);
    const playerStatus = await request(`/api/replay-intake/uploads/${sha256}/parser`, player); expect(playerStatus.status).toBe(200); const safeStatus = await playerStatus.json(); expect(safeStatus).not.toHaveProperty('result'); expect(safeStatus).not.toHaveProperty('review'); expect(JSON.stringify(safeStatus)).not.toContain('raw-a');
    const collision = mappings.map(item => item.parserPlayerId === 'raw-b' ? { ...item, rosterPlayerId: 'p1' } : item);
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'collision', matchId: 'm1', teamId: 'team-us', mappings: collision })).status).toBe(409);
    const unknown = mappings.map(item => item.parserPlayerId === 'raw-b' ? { ...item, rosterPlayerId: 'missing' } : item);
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'unknown', matchId: 'm1', teamId: 'team-us', mappings: unknown })).status).toBe(409);
    const saved = await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'save-1', matchId: 'm1', teamId: 'team-us', mappings }); expect(saved.status).toBe(200); expect(await saved.json()).toMatchObject({ revision: 1, status: 'review-required', mappings });
    expect((await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'stale', matchId: 'm1', teamId: 'team-us', mappings })).status).toBe(409);
  });

  it('accepts only an explicit current revision, preserves raw evidence and hands canonical facts to analytics plus review-only ratings', async () => {
    const coach = await login(adminKey); const seeded = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    seeded.matches[0].ourScore = 8; seeded.matches[0].theirScore = 16;
    seeded.matches[0].scoreEvidence = { source: 'vod-hud', basis: 'end-banner', reads: 2 };
    seeded.matches[0].partialScore = { ours: 8, theirs: 15, source: 'vod-hud' };
    seeded.playerStats = [
      { id: 'manual-p1', matchId: 'm1', playerId: 'p1', player: 'Alpha', agent: 'Sova', kills: 99, fk: 7, trades: 9, hs: 44, notes: 'coach player note', corrections: [{ correctedAt: '2026-10-02T00:00:00.000Z', correctedBy: 'Coach', fields: ['kills', 'fk', 'trades'] }] },
      { id: 'manual-standin', matchId: 'm1', playerId: 'p3', player: 'Stand-in', notes: 'keep unmatched annotation', kills: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-02T00:00:00.000Z' } },
    ];
    seeded.rounds = [
      { id: 'manual-r1', matchId: 'm1', roundNo: 1, side: 'Defense', result: 'L', winBy: 'timeout', buy: 'Force', enemyBuy: 'Full', notes: 'review spacing', isThrow: 'TRUE', thrownBy: 'Alpha', throwReason: 'overpeek', corrections: [{ correctedAt: '2026-10-02T00:00:00.000Z', correctedBy: 'Coach', fields: ['side'] }] },
      { id: 'manual-r2', matchId: 'm1', roundNo: 2, side: 'Attack', result: 'L', notes: 'outside partial replay coverage', sourceMetadata: { method: 'manual', capturedAt: '2026-10-02T00:00:00.000Z' } },
    ];
    seeded.replayIntake.parserJobs.job1.result.reviewDraft.coverage = { playedRounds: 2, resolvedRounds: 1, unknownRounds: 1, resolvedPercent: 50, unknownReasons: { 'sequence-incomplete': 1 } };
    seeded.replayIntake.parserJobs.job1.result.scoreboard.players.find((player: any) => player.playerId === 'raw-a').trades = value(4);
    seeded.replayIntake.parserJobs.job1.result.scoreboard.players.find((player: any) => player.playerId === 'raw-b').trades = value(3);
    seeded.replayIntake.parserJobs.job1.result.reviewDraft.rounds.push({ roundNumber: 2, status: 'unknown', firstKillPlayerId: null, firstDeathPlayerId: null, sourceEventId: null, reason: 'sequence-incomplete', excludedEventCount: 0 });
    await fs.writeFile(dbPath, JSON.stringify(seeded)); const rawBefore = seeded.replayIntake.parserJobs.job1.result;
    await request(`/api/replay-intake/uploads/${sha256}/review`, coach, { expectedRevision: 0, requestId: 'save-1', matchId: 'm1', teamId: 'team-us', mappings });
    expect((await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, { expectedRevision: 1, requestId: 'no-confirm', confirmed: false })).status).toBe(400);
    const acceptBody = { expectedRevision: 1, requestId: 'accept-1', confirmed: true }; const accepted = await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, acceptBody); expect(accepted.status).toBe(200); expect(await accepted.json()).toMatchObject({ revision: 2, status: 'accepted', ratingDraftKeys: expect.any(Array) });
    const retry = await request(`/api/replay-intake/uploads/${sha256}/accept`, coach, acceptBody); expect(retry.status).toBe(200); expect((await retry.json()).revision).toBe(2);
    const withSecondReplay = JSON.parse(await fs.readFile(dbPath, 'utf8')); const secondResult = structuredClone(parserResult); secondResult.diagnostics.replaySha256 = secondSha256; secondResult.reviewDraft.provenance.replaySha256 = secondSha256;
    withSecondReplay.matches.push({ id: 'm2', date: '2026-10-04', type: 'Scrim', opponent: 'Redacted Two', map: 'Haven', rosterContext: { kind: 'core' } });
    withSecondReplay.replayIntake.blobs[secondSha256] = { sha256: secondSha256, size: 101, storedAt: '2026-10-04T00:00:00.000Z', parserStatus: 'parsed-review-required', parserJobId: 'job2', reviewStatus: 'review-required', matchId: null };
    withSecondReplay.replayIntake.associations.receipt2 = { id: 'receipt2', sha256: secondSha256, size: 101, originalName: 'second-redacted-fixture.vrf', deviceId: 'd_fixture01', owner: { actorId: 'key:admin', role: 'coach', playerId: null }, receivedAt: '2026-10-04T00:00:00.000Z' };
    withSecondReplay.replayIntake.parserJobs.job2 = { ...withSecondReplay.replayIntake.parserJobs.job1, id: 'job2', sha256: secondSha256, result: secondResult };
    await fs.writeFile(dbPath, JSON.stringify(withSecondReplay));
    expect((await request(`/api/replay-intake/uploads/${secondSha256}/review`, coach, { expectedRevision: 0, requestId: 'save-2', matchId: 'm2', teamId: 'team-us', mappings })).status).toBe(200);
    expect((await request(`/api/replay-intake/uploads/${secondSha256}/accept`, coach, { expectedRevision: 1, requestId: 'accept-2', confirmed: true })).status).toBe(200);
    const { readDB } = await import('../lib/store'); const stored = await readDB(); expect(stored.replayIntake.parserJobs.job1.result).toEqual(rawBefore); expect(stored.replayIntake.reviews[sha256].mappings).toEqual(mappings);
    expect(stored.matches[0]).toMatchObject({ id: 'm1', map: 'Haven', ourScore: 1, theirScore: 0, sourceMetadata: { provider: 'vrfkit', externalId: sha256 } });
    expect(stored.matches[0].scoreEvidence).toBeUndefined(); expect(stored.matches[0].partialScore).toBeUndefined();
    expect(stored.playerStats).toEqual(expect.arrayContaining([expect.objectContaining({ matchId: 'm1', playerId: 'p1', player: 'Reviewed Alpha', displayNameSnapshot: 'Reviewed Alpha', deaths: 0, fk: 7, trades: 9 }), expect.objectContaining({ matchId: 'm1', playerId: 'p2', player: 'Reviewed Bravo', displayNameSnapshot: 'Reviewed Bravo', kills: 1, defuses: 1, trades: 3 })]));
    expect(stored.playerStats.find((row: any) => row.matchId === 'm1' && row.playerId === 'p1')).toMatchObject({ id: 'manual-p1', kills: 99, fk: 7, trades: 9, hs: 44, notes: 'coach player note', corrections: expect.arrayContaining([expect.objectContaining({ fields: ['kills', 'fk', 'trades'] })]) });
    expect(stored.playerStats.find((row: any) => row.id === 'manual-standin')).toMatchObject({ playerId: 'p3', notes: 'keep unmatched annotation', kills: 4, sourceMetadata: { method: 'manual' } });
    expect(stored.rounds.filter((round: any) => round.matchId === 'm1')).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'manual-r1', roundNo: 1, side: 'Defense', result: 'W', winBy: 'elimination', firstKillBy: 'Reviewed Alpha', firstDeathBy: 'Opponent X', buy: 'Force', enemyBuy: 'Full', notes: 'review spacing', isThrow: 'TRUE', thrownBy: 'Alpha', throwReason: 'overpeek', replayEvidence: { tradeOpportunities: 1, successfulTrades: 1, tacticalAssessment: 'unreviewed' } })]));
    expect(stored.rounds.find((round: any) => round.id === 'manual-r2')).toMatchObject({ roundNo: 2, notes: 'outside partial replay coverage', sourceMetadata: { method: 'manual' } });
    expect(stored.engineAdapters.replay.m1).toMatchObject({ status: 'accepted', provenance: { replaySha256: sha256 } });
    expect(stored.engineAdapters.replay.m1.draft.coverage).toMatchObject({ playedRounds: 2, resolvedRounds: 1, unknownRounds: 1, resolvedPercent: 50 });
    const ratingRecords = Object.values(stored.engineAdapters.ratings.records) as any[]; expect(ratingRecords).toHaveLength(4); expect(ratingRecords.every(record => record.status === 'review-required' && record.acceptedAt === null)).toBe(true);
    expect(new Set(ratingRecords.map(record => record.provenance.replaySha256))).toEqual(new Set([sha256, secondSha256])); expect(Object.keys(stored.engineAdapters.replay).sort()).toEqual(['m1', 'm2']);
  });
});
