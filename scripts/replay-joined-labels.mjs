// Writes OCR labels from every captured match that also has an accepted replay.
//   node scripts/replay-joined-labels.mjs <db.json> <out-labels.json>
// Then: node scripts/ocr-field-report.mjs <backtest-out-dir> --labels <out-labels.json>
// The labels come from the team's own database, so the output must be outside this repository.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayJoinedLabels } from './replayJoinedLabels.mjs';

const [dbPath, outPath] = process.argv.slice(2);
if (!dbPath || !outPath) throw new Error('Usage: node scripts/replay-joined-labels.mjs <db.json> <out-labels.json>');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(outPath); const inside = path.relative(repo, target);
if (!inside.startsWith('..') && !path.isAbsolute(inside)) throw new Error('Write the labels outside the repository: they hold data from the team database and must never be committed.');
const labels = replayJoinedLabels(JSON.parse(await readFile(path.resolve(dbPath), 'utf8')));
await writeFile(target, JSON.stringify(labels, null, 2));
console.log(JSON.stringify({ written: target, sessions: labels.sessions.length, skipped: labels.skipped.reduce((counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] || 0) + 1 }), {}) }, null, 2));
