// Check backtest output against the labelled scoreboard row cells.
//   node scripts/ocr-row-label-check.mjs <backtest-out-dir> [ground-truth.json]
// Exits 1 when an extracted cell is outside a row's acceptable set; a
// missing session output is reported but does not fail.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const [outDir, fixture = 'tests/fixtures/capture-ground-truth.json'] = process.argv.slice(2);
if (!outDir) throw new Error('Usage: node scripts/ocr-row-label-check.mjs <backtest-out-dir> [ground-truth.json]');
const corpus = JSON.parse(await readFile(path.resolve(fixture), 'utf8'));
const results = [];
for (const label of corpus.rowLabels || []) {
  const file = path.join(outDir, `${label.captureId}.json`);
  if (!existsSync(file)) { results.push({ captureId: label.captureId, row: label.row, field: label.field, value: null, status: 'missing-output' }); continue; }
  const value = JSON.parse(await readFile(file, 'utf8')).players?.[label.row]?.[label.field] ?? null;
  results.push({ captureId: label.captureId, row: label.row, field: label.field, value, status: label.acceptable.includes(value) ? 'ok' : 'wrong' });
}
console.log(JSON.stringify(results, null, 2));
if (results.some(result => result.status === 'wrong')) process.exitCode = 1;
