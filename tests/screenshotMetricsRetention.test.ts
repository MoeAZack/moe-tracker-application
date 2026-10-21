import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recomputeAcceptedMatchAggregates } from '../lib/aggregateVersioning';
import { toPublicTrackerData } from '../lib/publicData';
import { correctObservedIdentity } from '../lib/roster';

// A 0.1.x row: stored screenshot metrics, a name-only scoreboard identity, and
// round evidence that names the player but carries no stable roster id.
const workspace = () => ({
  rosterPlayers: [{ id: 'p1', displayName: 'Synthetic One' }], coreMemberships: [{ playerId: 'p1' }],
  matches: [{ id: 'm1', date: '2026-10-14', type: 'Scrim', opponent: 'Synthetic B', map: 'Ascent', attW: 1, attL: 0, defW: 0, defL: 0, source: 'manual' }],
  playerStats: [{ id: 's1', matchId: 'm1', player: 'Synthetic One', displayNameSnapshot: 'Synthetic One', kills: 1, deaths: 0, assists: 0, screenshotMetrics: { schemaVersion: 1, coveredRounds: 1, trades: 0, multikills: { two: 0, three: 0, four: 0, ace: 0 } } }],
  rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W', screenshotEvidence: { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'confirmed', players: [{ displayName: 'Synthetic One', team: 'ours', assists: 0, survived: true }], eventsComplete: true, events: [] } }],
});

describe('stored screenshot metrics that cannot be rebuilt', () => {
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

  it('survive a relink, a rebuild and a save byte for byte, and stay withheld from coaches', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metric-retention-'));
    vi.stubEnv('DB_PATH', path.join(dir, 'db.json')); vi.stubEnv('USE_FIRESTORE', 'false');
    const { readDB, replaceDB, saveDB } = await import('../lib/store');
    await replaceDB(workspace());
    const stored = JSON.stringify((await readDB()).playerStats[0].screenshotMetrics);

    const db: any = await readDB();
    correctObservedIdentity(db, { sourceIdentity: 'unlinked-name:synthetic one', targetPlayerId: 'p1', reason: 'same player' });
    // Any later round edit, evidence resolution, replay accept or VOD link rebuilds the match.
    expect(recomputeAcceptedMatchAggregates(db, 'm1').status).toBe('recomputed');
    await saveDB(db);

    const reread: any = await readDB();
    expect(reread.playerStats[0].playerId).toBe('p1');
    expect(JSON.stringify(reread.playerStats[0].screenshotMetrics)).toBe(stored);
    expect(toPublicTrackerData(reread, 'coach').playerStats[0]).not.toHaveProperty('screenshotMetrics');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
