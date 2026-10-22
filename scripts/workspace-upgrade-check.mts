// Upgrade check on a COPY of a real workspace. The source folder is only read.
//
//   npx tsx scripts/workspace-upgrade-check.mts --source "<data folder holding db.json>" --work <empty folder>
//
// It copies the data folder, starts this checkout's built server (build/server.cjs)
// on the copy the way the desktop app does, reads /api/data, forces one save
// through the store (the write path every change takes), restarts the server
// and reads again. Counts, ids and a content hash of matches, rounds and
// player stats must not change, and the source files must be byte-identical
// afterwards. Only counts, hashes and field names are printed: no row contents.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { readOfflineSnapshot } from '../lib/offlineSnapshot';
import { buildAcceptedMatchAggregatePlan, PLAYER_SCREENSHOT_BUILDER } from '../lib/aggregateVersioning';

const COLLECTIONS = ['matches', 'rounds', 'playerStats'] as const;
// Annotations 0.2.0 may add while upgrading; reported, but kept out of the content hash.
const UPGRADE_ANNOTATIONS = new Set(['duplicateReview']);
// Aggregates the server derives from source evidence on every read (lib/publicData.ts):
// rebuilt by the current builder, or withheld when they cannot be rebuilt. Stored
// copies are compared exactly; server reads are compared on source fields only and
// must agree with each other, derived fields included.
export const DERIVED_FIELDS: Record<string, ReadonlySet<string>> = { matches: new Set(['roundAnalytics']), rounds: new Set(), playerStats: new Set(['screenshotMetrics']) };

const option = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const sha256 = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

export function contentSummary(state: any) {
  const summary: Record<string, any> = {};
  for (const name of COLLECTIONS) {
    const rows = [...(Array.isArray(state?.[name]) ? state[name] : [])].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
    const strip = (row: any, derived = false) => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !UPGRADE_ANNOTATIONS.has(key) && !(derived && DERIVED_FIELDS[name].has(key))));
    const fields = [...new Set(rows.flatMap(row => Object.keys(row || {})))].sort();
    summary[name] = {
      count: rows.length,
      idsSha256: sha256(JSON.stringify(rows.map(row => String(row?.id)))),
      contentSha256: sha256(JSON.stringify(rows.map(row => stable(strip(row))))),
      sourceContentSha256: sha256(JSON.stringify(rows.map(row => stable(strip(row, true))))),
      fields,
      // One hash per field across all rows, so a failure names the field without printing values.
      fieldSha256: Object.fromEntries(fields.map(field => [field, sha256(JSON.stringify(rows.map(row => [String(row?.id), stable(row?.[field]) ?? null])))])),
    };
  }
  summary.quarantinedMatches = (state?.matches || []).filter((match: any) => match?.duplicateReview?.status === 'quarantined').length;
  return summary;
}

async function fileHashes(directory: string) {
  const out: Record<string, string> = {};
  async function walk(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full); else out[path.relative(directory, full)] = sha256(await fs.readFile(full));
    }
  }
  await walk(directory);
  return out;
}

async function freePort() {
  const server = net.createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port; await new Promise(resolve => server.close(resolve)); return port;
}

async function readThroughServer(dbPath: string) {
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  const adminPassword = crypto.randomBytes(24).toString('hex');
  const child = spawn(process.execPath, ['build/server.cjs'], { env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DB_PATH: dbPath, APP_DESKTOP: 'true', ADMIN_PASSWORD: adminPassword, JWT_SECRET: crypto.randomBytes(24).toString('hex'), PRIVATE_BACKUP_DIR: path.join(path.dirname(dbPath), '..', 'backups') }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr!.on('data', chunk => { errors = (errors + chunk).slice(-2000); });
  try {
    for (let attempt = 0; attempt < 200; attempt++) { try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
    const login = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: adminPassword }) });
    if (!login.ok) throw new Error(`Login on the copy failed (HTTP ${login.status}).`);
    const { key } = await login.json();
    const data = await fetch(`${origin}/api/data`, { headers: { authorization: `Bearer ${key}` } });
    if (!data.ok) throw new Error(`/api/data on the copy failed (HTTP ${data.status}). Server log: ${errors.slice(-600)}`);
    return await data.json();
  } finally { child.kill(); }
}

/** Why derived aggregates are rebuilt or withheld, as counts only: build status per match, and per player row. */
export function aggregateBuildSummary(state: any) {
  const count = (into: Record<string, number>, key: string) => { into[key] = (into[key] || 0) + 1; };
  const matchBuilds: Record<string, number> = {}; const screenshotMetrics: Record<string, number> = {};
  for (const match of state?.matches || []) {
    const plan = buildAcceptedMatchAggregatePlan(state, match.id);
    count(matchBuilds, plan.build.unknownReason ? `${plan.build.status}:${plan.build.unknownReason}` : plan.build.status);
    for (const stat of (state.playerStats || []).filter((row: any) => row.matchId === match.id)) {
      const planned = plan.playerStats.find((row: any) => row.id === stat.id)?.screenshotMetrics;
      count(screenshotMetrics, plan.build.status !== 'recomputed' ? `withheld:match-${plan.build.status}`
        : !stat.playerId ? 'withheld:no-stable-player-link'
          : planned?.calculationVersion === PLAYER_SCREENSHOT_BUILDER ? 'rebuilt' : 'withheld:no-round-evidence-for-player');
    }
  }
  return { matchBuilds, screenshotMetrics, storedScreenshotMetrics: (state?.playerStats || []).filter((row: any) => row.screenshotMetrics).length };
}

const changedFields = (a: any, b: any) => [...new Set([...Object.keys(a.fieldSha256), ...Object.keys(b.fieldSha256)])].filter(field => a.fieldSha256[field] !== b.fieldSha256[field] && !UPGRADE_ANNOTATIONS.has(field)).sort();

/** Every way the upgraded reads or the migrated file can disagree with the original workspace. */
export function upgradeFailures({ stored, before, firstRead, secondRead, afterRead, afterFile }: Record<'stored' | 'before' | 'firstRead' | 'secondRead' | 'afterRead' | 'afterFile', any>) {
  const failures: string[] = [];
  const compare = (label: string, summary: any, reference: any, fields: readonly string[]) => {
    for (const name of COLLECTIONS) for (const field of fields) if (summary[name][field] !== reference[name][field]) {
      const named = field.endsWith('ContentSha256') || field === 'contentSha256' ? changedFields(summary[name], reference[name]).filter(item => field === 'contentSha256' || !DERIVED_FIELDS[name].has(item)) : [];
      failures.push(`${label}: ${name}.${field} changed${named.length ? ` (fields: ${named.join(', ')})` : ''}`);
    }
  };
  compare('migrated file', afterFile, before, ['count', 'idsSha256', 'contentSha256']);
  for (const [label, summary] of [['first 0.2.0 read', firstRead], ['second 0.2.0 read', secondRead], ['read after save', afterRead]] as const) compare(label, summary, before, ['count', 'idsSha256', 'sourceContentSha256']);
  // Derived aggregates must come out the same on every read, before and after the save.
  compare('second 0.2.0 read vs first', secondRead, firstRead, ['contentSha256']);
  compare('read after save vs first', afterRead, firstRead, ['contentSha256']);
  for (const name of COLLECTIONS) for (const field of ['count', 'idsSha256'] as const) if (stored[name][field] !== before[name][field]) failures.push(`hydrated source: ${name}.${field} differs from the stored file`);
  return failures;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('workspace-upgrade-check.mts');
if (isMain) {
  const source = path.resolve(option('--source') || '');
  const work = path.resolve(option('--work') || '');
  if (!option('--source') || !option('--work')) throw new Error('Pass --source <data folder> and --work <empty folder>.');
  if (work.startsWith(source + path.sep) || work === source) throw new Error('The work folder must be outside the source folder.');
  await fs.mkdir(work, { recursive: true });
  if ((await fs.readdir(work)).length) throw new Error('The work folder must be empty.');
  const sourceBefore = await fileHashes(source);
  const copy = path.join(work, 'data'); await fs.cp(source, copy, { recursive: true });
  const dbPath = path.join(copy, 'db.json');

  const original = await readOfflineSnapshot(path.join(source, 'db.json'));
  // The file exactly as stored (artifact stubs and all) must carry the same rows as the hydrated read.
  const stored = contentSummary(original.index);
  const before = contentSummary(original.state);
  const firstRead = contentSummary(await readThroughServer(dbPath));
  const secondRead = contentSummary(await readThroughServer(dbPath));
  // One save through the store: the write path every change takes in 0.2.0.
  const save = spawnSync(process.execPath, ['--import', 'tsx', '-e', "const { readDB, saveDB } = await import('./lib/store.ts'); await saveDB(await readDB());"], { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8' });
  if (save.status !== 0) throw new Error(`Saving the copy failed: ${save.stderr.slice(-400)}`);
  const afterRead = contentSummary(await readThroughServer(dbPath));
  const migrated = await readOfflineSnapshot(dbPath);
  const afterFile = contentSummary(migrated.state);
  const sourceAfter = await fileHashes(source);

  const failures: string[] = [];
  failures.push(...upgradeFailures({ stored, before, firstRead, secondRead, afterRead, afterFile }));
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) failures.push('the source folder changed');
  const report = {
    schema: 'moetracker.workspace-upgrade-check/v1', generatedAt: new Date().toISOString(),
    storage: { sourceSchemaVersion: Number(original.index?._storage?.schemaVersion || 1), migratedSchemaVersion: Number(migrated.index?._storage?.schemaVersion || 1) },
    sourceDbSha256: sourceBefore['db.json'] || null, sourceFiles: Object.keys(sourceBefore).length, sourceUnchanged: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
    aggregates: aggregateBuildSummary(original.state),
    stored, before, firstRead, secondRead, afterRead, afterFile, passed: failures.length === 0, failures,
  };
  await fs.writeFile(path.join(work, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
}
