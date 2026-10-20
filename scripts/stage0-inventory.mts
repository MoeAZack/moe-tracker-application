import fs from 'fs/promises';
import path from 'path';
import { readOfflineSnapshot } from '../lib/offlineSnapshot';

const option = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const root = path.resolve(option('--root') || '.');
const dbPath = path.resolve(option('--db') || process.env.DB_PATH || 'data/db.json');
const output = option('--output') ? path.resolve(option('--output')!) : null;
const relative = (file: string) => path.relative(root, file).replaceAll('\\', '/');

async function filesUnder(folder: string, extensions: string[]) {
  const result: string[] = [];
  async function visit(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name === 'release') continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (extensions.some(extension => entry.name.endsWith(extension))) result.push(file);
    }
  }
  await visit(folder);
  return result.sort();
}

// Field inventory covers hydrated evidence, not the artifact stubs in the stored index.
const { state: db } = await readOfflineSnapshot(dbPath, { artifactDir: option('--evidence') });
const fields = new Map<string, { types: Set<string>; occurrences: number }>();
function typeOf(value: unknown) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value; }
const dynamicContainers = /\.(riotIds|analyticsBuilds|blobs|associations|parserJobs|reviews|screenshots|rawReceipts|rawSessions|devices|pairingCodes|records)$/;
function safeFieldSegment(parent: string, key: string) {
  if (dynamicContainers.test(parent) || /^[a-f0-9]{16,}$/i.test(key) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(key)) return '{key}';
  return key.replaceAll('.', '\\u002e');
}
function collect(value: unknown, location = '$') {
  const existing = fields.get(location) || { types: new Set<string>(), occurrences: 0 };
  existing.types.add(typeOf(value)); existing.occurrences += 1; fields.set(location, existing);
  if (Array.isArray(value)) value.forEach(item => collect(item, `${location}[*]`));
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value as Record<string, unknown>)) collect(child, `${location}.${safeFieldSegment(location, key)}`);
}
collect(db);

const sourceFiles = await filesUnder(root, ['.ts', '.tsx']);
const routes: Array<{ method: string; path: string; file: string; line: number }> = [];
const exportedSymbols: Array<{ symbol: string; kind: string; file: string; line: number }> = [];
for (const file of sourceFiles) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) routes.push({ method: match[1].toUpperCase(), path: match[2], file: relative(file), line: index + 1 });
    for (const match of line.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*\[([^\]]+)\]/g)) for (const route of match[2].matchAll(/['"]([^'"]+)['"]/g)) routes.push({ method: match[1].toUpperCase(), path: route[1], file: relative(file), line: index + 1 });
    for (const match of line.matchAll(/^\s*export\s+(?:async\s+)?(function|class|const)\s+([A-Za-z0-9_]+)/g)) exportedSymbols.push({ kind: match[1], symbol: match[2], file: relative(file), line: index + 1 });
  });
}

const componentFiles = await Promise.all((await filesUnder(path.join(root, 'src', 'components'), ['.tsx'])).map(async file => ({
  component: path.basename(file, '.tsx'), file: relative(file), lines: (await fs.readFile(file, 'utf8')).split(/\r?\n/).length,
})));
const calculationSymbols = exportedSymbols.filter(entry => entry.file.startsWith('lib/') || entry.file.startsWith('src/utils/'));
const report = {
  schema: 'moetracker.stage0-code-inventory/v1', generatedAt: new Date().toISOString(),
  database: { fieldCount: fields.size, fields: [...fields.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([field, details]) => ({ field, types: [...details.types].sort(), occurrences: details.occurrences })) },
  api: { routeCount: routes.length, routes: routes.sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method)) },
  ui: { componentCount: componentFiles.length, components: componentFiles },
  calculations: { exportedSymbolCount: calculationSymbols.length, symbols: calculationSymbols.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line) },
};
const rendered = `${JSON.stringify(report, null, 2)}\n`;
if (output) { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, rendered, 'utf8'); }
process.stdout.write(JSON.stringify({ databaseFields: fields.size, apiRoutes: routes.length, components: componentFiles.length, calculationSymbols: calculationSymbols.length, output }, null, 2));
