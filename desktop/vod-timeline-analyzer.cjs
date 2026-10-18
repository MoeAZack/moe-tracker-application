const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { aggregateVideoEvidence } = require('./vod-timeline-evidence.cjs');

const MAX_DURATION_SECONDS = 4 * 60 * 60;
const MAX_LOCAL_BYTES = 30 * 1024 * 1024 * 1024;

function unpackedExecutable(candidate) {
  const value = String(candidate || '');
  const unpacked = value.replace('app.asar', 'app.asar.unpacked');
  return unpacked !== value && fs.existsSync(unpacked) ? unpacked : value;
}

function ffmpegPath() { return unpackedExecutable(require('ffmpeg-static')); }
function ffprobePath() { return unpackedExecutable(require('ffprobe-static').path); }
function ytDlpPath() { return unpackedExecutable(path.join(path.dirname(require.resolve('youtube-dl-exec/package.json')), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')); }

function youtubeVideoId(input) {
  try {
    const url = new URL(String(input || '').trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{6,20}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (!['youtube.com', 'm.youtube.com'].includes(host)) return null;
    if (url.pathname === '/watch') return /^[A-Za-z0-9_-]{6,20}$/.test(url.searchParams.get('v') || '') ? url.searchParams.get('v') : null;
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,20})/); return match?.[1] || null;
  } catch { return null; }
}

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options }); let stdout = ''; let stderr = '';
    child.stdout?.on('data', chunk => { stdout += String(chunk); }); child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}.`)));
  });
}

async function probeVideo(file) {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,codec_type', '-of', 'json', file]);
  const parsed = JSON.parse(stdout); const video = (parsed.streams || []).find(stream => stream.codec_type === 'video');
  const durationSeconds = Number(parsed.format?.duration); const size = Number(parsed.format?.size || 0);
  if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('The selected source does not contain a readable video stream.');
  if (durationSeconds > MAX_DURATION_SECONDS) throw new Error('VOD analysis is limited to four hours per submission.');
  if (size > MAX_LOCAL_BYTES) throw new Error('VOD analysis is limited to 30 GB per local file.');
  return { durationSeconds, durationMs: Math.round(durationSeconds * 1000), width: Number(video.width), height: Number(video.height), size };
}

async function downloadYoutube(url, directory, progress) {
  const id = youtubeVideoId(url); if (!id) throw new Error('Only standard YouTube, Shorts, Live, and youtu.be links can be scanned automatically.');
  progress?.({ stage: 'download', percent: 1, message: 'Preparing the YouTube VOD locally…' });
  const target = path.join(directory, `${id}.mp4`); const executable = ytDlpPath();
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--no-playlist', '--newline', '--no-warnings', '--max-filesize', '30G', '--match-filter', 'duration <= 14400', '-f', 'bestvideo[height<=1080]/best[height<=1080]/best', '-o', target, url], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; const update = chunk => { const text = String(chunk); output += text; const matches = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)]; const percent = matches.length ? Math.min(100, Math.round(Number(matches.at(-1)[1]))) : null; progress?.({ stage: 'download', percent, message: percent === null ? 'Downloading the YouTube VOD locally…' : `Downloading the YouTube VOD locally · ${percent}%` }); };
    child.stdout.on('data', update); child.stderr.on('data', update); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(output.trim().slice(-1000) || 'YouTube could not provide this VOD. Try the original video file.')));
  });
  if (!fs.existsSync(target)) throw new Error('YouTube did not produce a readable local VOD. Try the original video file.');
  progress?.({ stage: 'download', percent: 100, message: 'YouTube VOD is ready for local analysis.' }); return target;
}

function frameDifference(left, right) {
  if (!left || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let total = 0; let count = 0;
  for (let index = 0; index < left.length; index += 24) { total += Math.abs(left[index] - right[index]); count += 1; }
  return count ? total / count : 0;
}

async function changedFrames(file, spec, durationSeconds, progress) {
  const frameBytes = spec.width * spec.height; const fps = spec.fps; const buckets = new Map(); let previous = null; let pending = Buffer.alloc(0); let index = 0;
  const filter = `fps=${fps},${spec.crop},scale=${spec.width}:${spec.height}:flags=fast_bilinear,format=gray`;
  const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-vf', filter, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      const frame = Buffer.from(pending.subarray(0, frameBytes)); pending = pending.subarray(frameBytes); const timestampMs = Math.round(index / fps * 1000); index += 1;
      const difference = frameDifference(previous, frame); const changed = difference >= spec.threshold;
      if (changed) {
        const bucket = Math.min(spec.maxCandidates - 1, Math.floor(timestampMs / Math.max(1, durationSeconds * 1000) * spec.maxCandidates)); const existing = buckets.get(bucket);
        if (!existing || difference > existing.difference) buckets.set(bucket, { timestampMs, pixels: frame, difference });
      }
      previous = frame;
      if (index % 100 === 0) progress?.({ stage: 'sampling', percent: Math.min(99, Math.round(timestampMs / 1000 / durationSeconds * 100)), message: `Sampling ${spec.label} across the timeline…` });
    }
  }
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (code !== 0) throw new Error(stderr.trim() || 'FFmpeg could not sample the VOD.');
  return [...buckets.values()].sort((a, b) => a.timestampMs - b.timestampMs).map(({ difference: _difference, ...frame }) => frame);
}

function pgm(frame, width, height) { return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), frame]); }

async function recognizeFrames(frames, spec, worker, progress, offset, total) {
  const snapshots = [];
  for (let index = 0; index < frames.length; index += 1) {
    const result = await worker.recognize(pgm(frames[index].pixels, spec.width, spec.height)); const text = String(result.data?.text || '').trim(); const confidence = Number(result.data?.confidence);
    if (text) snapshots.push({ timestampMs: frames[index].timestampMs, text, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence / 100)) : null });
    progress?.({ stage: 'ocr', percent: Math.round((offset + index + 1) / Math.max(1, total) * 100), message: `Reading timeline evidence · ${offset + index + 1}/${total}` });
  }
  return snapshots;
}

async function analyzeVodTimeline(input, options = {}) {
  const progress = options.progress; const workRoot = options.workRoot || path.join(require('node:os').tmpdir(), 'moetracker-vod');
  const jobDirectory = path.join(workRoot, crypto.randomUUID()); await fsp.mkdir(jobDirectory, { recursive: true }); let downloaded = false; let file;
  try {
    if (input.localPath) { file = path.resolve(String(input.localPath)); if (!fs.existsSync(file)) throw new Error('The selected local VOD no longer exists.'); }
    else { file = await downloadYoutube(input.vodUrl, jobDirectory, progress); downloaded = true; }
    const probe = await probeVideo(file); progress?.({ stage: 'probe', percent: 100, message: `${Math.ceil(probe.durationSeconds / 60)} minute VOD detected · ${probe.width}×${probe.height}` });
    const specs = [
      { key: 'killFeedSnapshots', label: 'kill feed', fps: .5, crop: 'crop=iw*0.42:ih*0.38:iw*0.58:0', width: 720, height: 366, threshold: .15, maxCandidates: 2400 },
      { key: 'objectiveSnapshots', label: 'round and objective notices', fps: .4, crop: 'crop=iw*0.62:ih*0.34:iw*0.19:ih*0.02', width: 720, height: 222, threshold: .15, maxCandidates: 1200 },
      { key: 'ultimateSnapshots', label: 'ultimate state', fps: .5, crop: 'crop=iw*0.28:ih*0.25:iw*0.36:ih*0.72', width: 520, height: 260, threshold: .15, maxCandidates: 1200 },
    ];
    const candidates = {};
    for (const spec of specs) candidates[spec.key] = await changedFrames(file, spec, probe.durationSeconds, progress);
    const total = specs.reduce((sum, spec) => sum + candidates[spec.key].length, 0); progress?.({ stage: 'ocr', percent: 0, message: `Reading ${total} changed HUD frames locally…` });
    const { createWorker, PSM } = require('tesseract.js');
    const langPath = path.dirname(unpackedExecutable(require.resolve('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz')));
    const worker = await createWorker('eng', undefined, { langPath }); await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    let offset = 0; const snapshots = {};
    try { for (const spec of specs) { snapshots[spec.key] = await recognizeFrames(candidates[spec.key], spec, worker, progress, offset, total); offset += candidates[spec.key].length; } }
    finally { await worker.terminate(); }
    const evidence = aggregateVideoEvidence({ players: input.players || [], povPlayerName: input.povPlayerName || null, durationMs: probe.durationMs, ...snapshots });
    evidence.source = { kind: downloaded ? 'youtube' : 'local-file', videoId: youtubeVideoId(input.vodUrl), sha256: await new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(file); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex'))); }), width: probe.width, height: probe.height, durationMs: probe.durationMs, analyzedAt: new Date().toISOString() };
    progress?.({ stage: 'complete', percent: 100, message: `Timeline scan complete · ${evidence.observations.length} supported observations.` }); return evidence;
  } finally { if (downloaded || options.removeLocalCopy) await fsp.rm(jobDirectory, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { youtubeVideoId, probeVideo, analyzeVodTimeline, changedFrames, frameDifference };
