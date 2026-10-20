import fs from 'fs/promises';
import path from 'path';
import { buildResourceCatalog } from '../lib/resourceCatalog';
import { validateTrackerState } from '../lib/storageSchema';
import { readOfflineSnapshot } from '../lib/offlineSnapshot';

const option = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const dbPath = path.resolve(option('--db') || process.env.DB_PATH || 'data/db.json');
const { state: data } = await readOfflineSnapshot(dbPath, { artifactDir: option('--evidence') });
validateTrackerState(data, { jsonFile: true });

const catalogs = Object.fromEntries((['map', 'agent', 'weapon'] as const).map(kind => {
  const entries = buildResourceCatalog(data, kind);
  return [kind, {
    total: entries.length,
    active: entries.filter(row => row.active).length,
    inactive: entries.filter(row => !row.active).length,
    observed: entries.filter(row => row.observed).length,
    observedButUnknown: entries.filter(row => row.observed && !row.configured).map(row => row.name),
  }];
}));
const report = {
  schema: 'moetracker.stage2-catalog-audit/v1',
  generatedAt: new Date().toISOString(),
  source: dbPath,
  catalogs,
  warden: buildResourceCatalog(data, 'weapon').find(row => row.key === 'warden') || null,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

