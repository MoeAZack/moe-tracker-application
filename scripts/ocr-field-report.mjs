// Per-field OCR accuracy and false-accept rate for a backtest run, and the
// cell diff against a baseline run.
//   node scripts/ocr-field-report.mjs <backtest-out-dir> [--baseline <dir>] [--labels <ground-truth.json>]
// Output dirs come from scripts/backtest-capture-browser.mjs (one <captureId>.json per session).
// With --baseline, compares every value the run reports (all scalar leaves and array lengths, except the
// run folder, its duration and read timestamps) and exits 1 when any differs, so "zero cell diffs" is one command.
// Prints counts and capture ids only; read values appear for wrong cells, which are OCR output, not labels.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { diffRuns, fieldReport } from './ocrFieldReport.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args.splice(index, 2)[1] : undefined; };
const baselineDir = option('--baseline');
const labels = option('--labels') || 'tests/fixtures/capture-ground-truth.json';
const [outDir] = args;
if (!outDir) throw new Error('Usage: node scripts/ocr-field-report.mjs <backtest-out-dir> [--baseline <dir>] [--labels <ground-truth.json>]');

async function loadRun(dir) {
  const run = {};
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.json')).sort()) run[path.basename(name, '.json')] = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
  return run;
}

const candidate = await loadRun(outDir);
const corpus = JSON.parse(await readFile(path.resolve(labels), 'utf8'));
const report = { run: path.basename(path.resolve(outDir)), outputs: Object.keys(candidate).length, accuracy: fieldReport(corpus, candidate) };
if (baselineDir) {
  const diffs = diffRuns(await loadRun(baselineDir), candidate);
  report.baseline = { run: path.basename(path.resolve(baselineDir)), cellDiffs: diffs.length, diffs };
  if (diffs.length) process.exitCode = 1;
}
console.log(JSON.stringify(report, null, 2));
