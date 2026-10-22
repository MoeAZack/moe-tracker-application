#!/usr/bin/env node
// Runs the VOD timeline scan twice on one video and proves the fast path is
// equivalent: the baseline is today's behaviour (one decode per HUD region,
// software decode, one OCR worker); the candidate uses the speed settings.
// Prints counts, timings and SHA-256 digests only, never text read from the
// video, so the output is safe to relay.
//
//   node scripts/vod-speed-compare.cjs <video> [--start-ms N --end-ms N]
//     [--workers auto|1-8] [--hardware-decode] [--players players.json]
//     [--mode both|baseline|candidate] [--out result.json]
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyzeVodTimeline } = require('../desktop/vod-timeline-analyzer.cjs');

function parse(argv) {
  const options = { mode: 'both', workers: 'auto', hardwareDecode: false };
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--start-ms') options.startMs = Number(argv[++index]);
    else if (arg === '--end-ms') options.endMs = Number(argv[++index]);
    else if (arg === '--workers') options.workers = argv[++index] === 'auto' ? 'auto' : Number(argv[index]);
    else if (arg === '--hardware-decode') options.hardwareDecode = true;
    else if (arg === '--players') options.players = JSON.parse(fs.readFileSync(argv[++index], 'utf8'));
    else if (arg === '--mode') options.mode = argv[++index];
    else if (arg === '--out') options.out = argv[++index];
    else rest.push(arg);
  }
  if (rest.length !== 1) throw new Error('Usage: node scripts/vod-speed-compare.cjs <video> [options]');
  options.video = path.resolve(rest[0]);
  return options;
}

const sha = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

async function scan(options, performance) {
  let inspected = null; const log = [];
  const started = Date.now();
  const evidence = await analyzeVodTimeline({ localPath: options.video, players: options.players || [], startMs: options.startMs || 0, endMs: options.endMs || null, sourceSha256: 'comparison' }, {
    workRoot: path.join(os.tmpdir(), 'moetracker-vod-compare'), performance, log: line => log.push(line), inspect: value => { inspected = value; },
  });
  const elapsedMs = Date.now() - started;
  const candidates = Object.fromEntries(Object.entries(inspected.candidates).map(([key, frames]) => [key, frames.map(frame => [frame.timestampMs, sha(frame.pixels)])]));
  const { source: _source, ...stableEvidence } = evidence;
  return {
    elapsedMs, ocrWorkers: inspected.ocrWorkers, log,
    counts: Object.fromEntries(Object.entries(inspected.candidates).map(([key, frames]) => [key, { candidates: frames.length, snapshots: inspected.snapshots[key]?.length || 0 }])),
    observations: evidence.observations.length,
    sha256: { candidates: sha(candidates), snapshots: sha(inspected.snapshots), observations: sha(evidence.observations), evidence: sha(stableEvidence) },
  };
}

(async () => {
  const options = parse(process.argv.slice(2));
  const result = { video: sha(path.basename(options.video)).slice(0, 12), range: { startMs: options.startMs || 0, endMs: options.endMs || null }, cpus: os.availableParallelism?.() || os.cpus().length, freeMemoryGb: +(os.freemem() / 1024 ** 3).toFixed(1) };
  if (options.mode !== 'candidate') result.baseline = await scan(options, { singleDecode: false, ocrWorkers: 1, hardwareDecode: false });
  if (options.mode !== 'baseline') result.candidate = await scan(options, { singleDecode: true, ocrWorkers: options.workers, hardwareDecode: options.hardwareDecode });
  if (result.baseline && result.candidate) {
    result.identical = Object.fromEntries(Object.keys(result.baseline.sha256).map(key => [key, result.baseline.sha256[key] === result.candidate.sha256[key]]));
    result.speedup = +(result.baseline.elapsedMs / Math.max(1, result.candidate.elapsedMs)).toFixed(2);
    result.pass = Object.values(result.identical).every(Boolean);
  }
  const text = JSON.stringify(result, null, 2);
  if (options.out) fs.writeFileSync(options.out, text);
  console.log(text);
  if (result.pass === false) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 2; });
