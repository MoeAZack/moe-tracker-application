import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { validateTrackerState } from '../lib/storageSchema';
import { readOfflineSnapshot } from '../lib/offlineSnapshot';
import { auditStage0Integrity, stage0BaselineSummary } from '../lib/stage0Integrity';
import { DEFAULT_MOE_02_FEATURE_FLAGS } from '../lib/featureFlags';

const option = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const dbPath = path.resolve(option('--db') || process.env.DB_PATH || 'data/db.json');
const outputPath = option('--output') ? path.resolve(option('--output')!) : null;
// Audit the hydrated state: the stored index alone carries artifact stubs.
const { raw, index: parsed, state: migrated } = await readOfflineSnapshot(dbPath, { artifactDir: option('--evidence'), now: '2026-10-20T00:00:00.000Z' });
validateTrackerState(migrated, { jsonFile: true });
const integrity = auditStage0Integrity(migrated);
const report = {
  schema: 'moetracker.stage0-baseline/v1',
  generatedAt: new Date().toISOString(),
  source: option('--source') || 'local-workspace',
  sourceBytes: Buffer.byteLength(raw),
  sourceFileSha256: crypto.createHash('sha256').update(raw).digest('hex'),
  migrationPreview: { from: Number(parsed?._storage?.schemaVersion || 1), to: Number(migrated?._storage?.schemaVersion), writeApplied: false },
  baseline: stage0BaselineSummary(migrated),
  integrity,
  featureFlags: DEFAULT_MOE_02_FEATURE_FLAGS,
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) { await fs.mkdir(path.dirname(outputPath), { recursive: true }); await fs.writeFile(outputPath, rendered, 'utf8'); }
process.stdout.write(rendered);
if (!integrity.ok) process.exitCode = 1;
