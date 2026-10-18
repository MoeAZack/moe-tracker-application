import { readFile } from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve(process.argv[2] || 'tests/fixtures/capture-ground-truth.json');
const corpus = JSON.parse(await readFile(file, 'utf8'));
if (corpus.schemaVersion !== 2 || !Array.isArray(corpus.sessions) || !corpus.sessions.length) throw new Error('OCR corpus must use schemaVersion 2 and contain labelled sessions.');
const dimensions = ['resolution', 'layout', 'clientLanguage', 'windowsScalePercent', 'gpuColorProfile', 'map', 'overtime', 'labelStatus'];
for (const session of corpus.sessions) {
  for (const field of dimensions) if (session[field] === undefined || session[field] === null || session[field] === '') throw new Error(`${session.captureId || 'unknown session'} is missing ${field}.`);
  if (!Array.isArray(session.players) || session.players.length !== 5 || session.score[0] + session.score[1] !== session.roundCount) throw new Error(`${session.captureId} has inconsistent human labels.`);
}
const unique = field => [...new Set(corpus.sessions.map(session => String(session[field])))].sort();
const report = Object.fromEntries(dimensions.map(field => [field, unique(field)]));
const requirements = corpus.acceptanceTargets || {};
const gaps = [];
for (const [field, required] of Object.entries(requirements)) for (const value of required) if (!report[field]?.includes(String(value))) gaps.push(`${field}:${value}`);
console.log(JSON.stringify({ schemaVersion: corpus.schemaVersion, sessions: corpus.sessions.length, coverage: report, gaps }, null, 2));
if (process.argv.includes('--require-complete') && gaps.length) process.exitCode = 2;
