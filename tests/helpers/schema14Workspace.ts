import fs from 'fs/promises';
import path from 'path';
import { gzipSync } from 'zlib';
import { createSeed } from '../../lib/seed';
import { externalizeEvidenceArtifacts } from '../../lib/evidenceArtifacts';
import { archiveAndResetSeason } from '../../lib/roster';
import { buildCalibratedPlayerRatings } from '../../lib/calibratedPlayerRatings';
import { withCurrentScreenshotMetrics } from '../../lib/aggregateVersioning';

/** Fields big enough (over 1 KiB) that the store keeps them as evidence artifacts. */
const bulk = (tag: string) => tag.padEnd(1100, '.');

function addMatches(db: any, prefix: string, count: number) {
  for (let m = 1; m <= count; m += 1) {
    const id = `${prefix}m${m}`;
    db.matches.push({
      id, date: `2026-10-${String(10 + m).padStart(2, '0')}`, map: 'Ascent', opponent: `OpponentA${m}`, type: 'Scrim',
      ourScore: 13, theirScore: 9, attW: 7, attL: 5, defW: 6, defL: 4, source: 'manual', sourceMetadata: { method: 'manual' },
      roundAnalytics: { note: bulk(`analytics-${id}`) },
    });
    for (let p = 1; p <= 5; p += 1) db.playerStats.push({
      id: `${id}-s${p}`, matchId: id, player: `Player${p}`, agent: 'Jett', kills: 10 + p, deaths: 10, assists: p, acs: 200 + p,
      sourceMetadata: { method: 'manual' }, screenshotMetrics: { note: bulk(`metrics-${id}-${p}`) },
    });
    for (let r = 1; r <= 22; r += 1) db.rounds.push({
      id: `${id}-r${r}`, matchId: id, roundNo: r, result: r % 2 ? 'W' : 'L',
      screenshotEvidence: { reviewStatus: 'pending', players: [], events: [], note: bulk(`round-${id}-${r}`) },
    });
    db.coachingSignals.push({ id: `${id}-sig`, matchIds: [id], kind: 'note', evidence: { matchIds: [id] } });
    db.analyticsBuilds[id] = { version: 1, intelligence: { note: bulk(`intelligence-${id}`) } };
  }
}

export type WorkspaceCounts = { matches: number; playerStats: number; rounds: number; coachingSignals: number; calibratedPlayerRatings: number; seasonArchives: number; schedule: number; artifactsOnDisk: number };

/**
 * A synthetic, populated workspace stored as storage schema 14 (the schema of
 * 0.1.x installs before 0.2.0): 8 matches with stats, rounds, coaching
 * signals, ratings and externalized evidence, optionally with a season archive.
 * No real team data.
 */
export async function writeSchema14Workspace(dir: string, options: { withArchive?: boolean } = {}) {
  const db: any = createSeed();
  Object.assign(db, { matches: [], playerStats: [], rounds: [], coachingSignals: [], calibratedPlayerRatings: [], analyticsBuilds: {} });
  if (options.withArchive) {
    addMatches(db, 'old-', 3);
    archiveAndResetSeason(db, 'Season one', 'Season two');
    Object.assign(db, { matches: [], playerStats: [], rounds: [], coachingSignals: [], calibratedPlayerRatings: [], analyticsBuilds: {} });
  }
  addMatches(db, '', 8);
  db.calibratedPlayerRatings = buildCalibratedPlayerRatings(withCurrentScreenshotMetrics(db));
  db.schedule = Array.from({ length: 7 }, (_, index) => ({ id: `sch${index}`, date: `2026-10-2${index}`, title: `Practice ${index}` }));
  const planned = externalizeEvidenceArtifacts(db);
  planned.state._storage = { ...planned.state._storage, schemaVersion: 14, migratedAt: '2026-10-01T00:00:00.000Z', migrationLedger: [] };
  const dbPath = path.join(dir, 'db.json');
  const evidenceDir = `${dbPath}.evidence`;
  await fs.mkdir(evidenceDir, { recursive: true });
  for (const item of planned.artifacts) await fs.writeFile(path.join(evidenceDir, `${item.sha256}.json.gz`), gzipSync(Buffer.from(item.json, 'utf8')));
  await fs.writeFile(dbPath, JSON.stringify(planned.state, null, 2));
  return { dbPath, evidenceDir, artifactCount: planned.artifacts.length };
}

/** Counts read straight from the stored index and evidence folder. */
export async function workspaceCounts(dbPath: string): Promise<WorkspaceCounts> {
  const stored = JSON.parse(await fs.readFile(dbPath, 'utf8'));
  const files = await fs.readdir(`${dbPath}.evidence`).catch(() => [] as string[]);
  const length = (key: string) => Array.isArray(stored[key]) ? stored[key].length : 0;
  return {
    matches: length('matches'), playerStats: length('playerStats'), rounds: length('rounds'), coachingSignals: length('coachingSignals'),
    calibratedPlayerRatings: length('calibratedPlayerRatings'), seasonArchives: length('seasonArchives'), schedule: length('schedule'),
    artifactsOnDisk: files.filter(name => name.endsWith('.json.gz')).length,
  };
}
