const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { aggregateVideoEvidence, applyVisualTemplates } = require('./vod-timeline-evidence.cjs');
const { gameProgressReporter, regionProgress } = require('./vod-progress.cjs');
const { resolveBoundaryMap } = require('./vod-map-reads.cjs');
const { normalizeVodPerformance, resolveOcrWorkers, sampledRange, regionDecodeArgs, combinedDecodeArgs } = require('./vod-performance.cjs');

const MAX_DURATION_SECONDS = 4 * 60 * 60;
const MAX_LOCAL_BYTES = 30 * 1024 * 1024 * 1024;
const MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_JOB_TIMEOUT_MS = 6 * 60 * 60 * 1000;

function abortError(signal, fallback = 'VOD analysis was cancelled.') {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : fallback);
}

function throwIfAborted(signal) { if (signal?.aborted) throw abortError(signal); }

async function ensureDiskSpace(directory, minimumBytes = MIN_FREE_BYTES) {
  if (typeof fsp.statfs !== 'function') return null;
  const stats = await fsp.statfs(directory); const availableBytes = Number(stats.bavail) * Number(stats.bsize);
  if (Number.isFinite(availableBytes) && availableBytes < minimumBytes) throw new Error(`VOD analysis needs at least ${Math.ceil(minimumBytes / 1024 ** 3)} GB of free temporary disk space.`);
  return availableBytes;
}

function unpackedExecutable(candidate) {
  const value = String(candidate || '');
  const unpacked = value.replace('app.asar', 'app.asar.unpacked');
  return unpacked !== value && fs.existsSync(unpacked) ? unpacked : value;
}

function ffmpegPath() { return unpackedExecutable(require('ffmpeg-static')); }
function ffprobePath() { return unpackedExecutable(require('ffprobe-static').path); }
function ytDlpPath() { return unpackedExecutable(path.join(path.dirname(require.resolve('youtube-dl-exec/package.json')), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')); }

function normalizeYoutubeUrl(input) {
  let value = String(input || '').trim().replace(/&amp;/gi, '&').replace(/\\([_?&=#-])/g, '$1');
  const markdown = value.match(/\]\(\s*(https?:\/\/[^)\s]+)\s*\)/i); if (markdown) value = markdown[1];
  else { const plain = value.match(/https?:\/\/[^\s<>\])]+/i); if (plain) value = plain[0]; else { const bare = value.match(/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>\])]+/i); if (bare) value = `https://${bare[0]}`; } }
  return value.replace(/^[<({\[]+|[>)}\],.;]+$/g, '');
}

function youtubeVideoId(input) {
  try {
    const url = new URL(normalizeYoutubeUrl(input));
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{6,20}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (!['youtube.com', 'm.youtube.com'].includes(host)) return null;
    if (url.pathname === '/watch') return /^[A-Za-z0-9_-]{6,20}$/.test(url.searchParams.get('v') || '') ? url.searchParams.get('v') : null;
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,20})/); return match?.[1] || null;
  } catch { return null; }
}

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { signal, ...spawnOptions } = options; throwIfAborted(signal);
    const child = spawn(command, args, { windowsHide: true, ...spawnOptions }); let stdout = ''; let stderr = ''; let settled = false;
    const finish = (callback, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); callback(value); };
    const onAbort = () => { child.kill(); finish(reject, abortError(signal)); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', chunk => { stdout += String(chunk); }); child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.on('error', error => finish(reject, error)); child.on('exit', code => code === 0 ? finish(resolve, { stdout, stderr }) : finish(reject, new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}.`)));
  });
}

async function probeVideo(file, signal) {
  const { stdout } = await run(ffprobePath(), ['-v', 'error', '-show_entries', 'format=duration,size:stream=width,height,codec_type', '-of', 'json', file], { signal });
  const parsed = JSON.parse(stdout); const video = (parsed.streams || []).find(stream => stream.codec_type === 'video');
  const durationSeconds = Number(parsed.format?.duration); const size = Number(parsed.format?.size || 0);
  if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('The selected source does not contain a readable video stream.');
  if (durationSeconds > MAX_DURATION_SECONDS) throw new Error('VOD analysis is limited to four hours per submission.');
  if (size > MAX_LOCAL_BYTES) throw new Error('VOD analysis is limited to 30 GB per local file.');
  return { durationSeconds, durationMs: Math.round(durationSeconds * 1000), width: Number(video.width), height: Number(video.height), size };
}

async function downloadYoutube(url, directory, progress, signal) {
  const normalizedUrl = normalizeYoutubeUrl(url); const id = youtubeVideoId(normalizedUrl); if (!id) throw new Error('Only standard YouTube, Shorts, Live, and youtu.be links can be scanned automatically.');
  progress?.({ stage: 'download', percent: 1, message: 'Preparing the YouTube VOD locally…' });
  const target = path.join(directory, `${id}.mp4`); const executable = ytDlpPath();
  await new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const child = spawn(executable, ['--no-playlist', '--newline', '--no-warnings', '--extractor-args', 'youtube:player_client=web,android', '--write-info-json', '--max-filesize', '30G', '--match-filter', 'duration <= 14400', '-f', 'bestvideo[height<=1080]/best[height<=1080]/best', '-o', target, '--', normalizedUrl], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false; const finish = (callback, value) => { if (settled) return; settled = true; signal?.removeEventListener('abort', onAbort); callback(value); }; const onAbort = () => { child.kill(); finish(reject, abortError(signal)); }; signal?.addEventListener('abort', onAbort, { once: true });
    let output = ''; const update = chunk => { const text = String(chunk); output += text; const matches = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)]; const percent = matches.length ? Math.min(100, Math.round(Number(matches.at(-1)[1]))) : null; progress?.({ stage: 'download', percent, message: percent === null ? 'Downloading the YouTube VOD locally…' : `Downloading the YouTube VOD locally · ${percent}%` }); };
    child.stdout.on('data', update); child.stderr.on('data', update); child.on('error', error => finish(reject, error)); child.on('close', code => code === 0 ? finish(resolve) : finish(reject, new Error(output.trim().slice(-1000) || 'YouTube could not provide this VOD. Try the original video file.')));
  });
  if (!fs.existsSync(target)) throw new Error('YouTube did not produce a readable local VOD. Try the original video file.');
  progress?.({ stage: 'download', percent: 100, message: 'YouTube VOD is ready for local analysis.' }); return target;
}

function scoreboardGeometryScore(frame, width, height) {
  const luminance = (x, y) => { const index = (y * width + x) * 3; return (77 * frame[index] + 150 * frame[index + 1] + 29 * frame[index + 2]) >> 8; };
  let best = 0;
  for (let offset = -8; offset <= 8; offset += 2) {
    let edges = 0; let samples = 0;
    for (let row = 0; row <= 10; row += 1) {
      const y = Math.round((321 + offset + row * 48) * height / 1080);
      if (y < 2 || y + 2 >= height) continue;
      for (let referenceX = 430; referenceX <= 1740; referenceX += 24) {
        const x = Math.round(referenceX * width / 1920);
        edges += Math.abs(luminance(x, y - 1) - luminance(x, y + 1)); samples += 1;
      }
    }
    best = Math.max(best, samples ? edges / samples : 0);
  }
  let saturated = 0; let headerSamples = 0;
  for (let referenceY = 150; referenceY <= 215; referenceY += 8) for (let referenceX = 25; referenceX <= 335; referenceX += 12) {
    const x = Math.round(referenceX * width / 1920); const y = Math.round(referenceY * height / 1080); const index = (y * width + x) * 3;
    const high = Math.max(frame[index], frame[index + 1], frame[index + 2]); const low = Math.min(frame[index], frame[index + 1], frame[index + 2]);
    if (high - low > 70) saturated += 1; headerSamples += 1;
  }
  return best + (headerSamples ? saturated / headerSamples * 35 : 0);
}

function agentSelectGeometryScore(frame, width, height) {
  let blue = 0; let samples = 0;
  for (let y = Math.round(height * .06); y < Math.round(height * .68); y += 3) for (let x = Math.round(width * .04); x < Math.round(width * .96); x += 3) {
    const index = (y * width + x) * 3; const red = frame[index]; const green = frame[index + 1]; const value = frame[index + 2];
    if (value > 115 && green > 90 && value > red * 1.18 && green > red * 1.12) blue += 1;
    samples += 1;
  }
  return samples ? blue / samples * 100 : 0;
}

async function sampleScoreboardCandidates(file, durationSeconds, progress, signal, expectedGames = null) {
  const width = 480; const height = 270; const fps = 1 / 8; const frameBytes = width * height * 3;
  const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-an', '-vf', `fps=${fps},scale=${width}:${height}:flags=fast_bilinear,format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const onAbort = () => child.kill(); signal?.addEventListener('abort', onAbort, { once: true }); let stderr = ''; let pending = Buffer.alloc(0); let index = 0; const ranked = [];
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      throwIfAborted(signal); const frame = Buffer.from(pending.subarray(0, frameBytes)); pending = pending.subarray(frameBytes);
      const timestampMs = Math.round(index / fps * 1000); const score = scoreboardGeometryScore(frame, width, height); const agentSelectScore = agentSelectGeometryScore(frame, width, height); ranked.push({ timestampMs, score, agentSelectScore, rankScore: Math.max(score, agentSelectScore * 1.25) }); index += 1;
      if (index % 30 === 0) progress?.({ stage: 'discover', percent: Math.min(98, Math.round(timestampMs / 1000 / durationSeconds * 100)), message: 'Finding completed match scoreboards…' });
    }
  }
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); signal?.removeEventListener('abort', onAbort); throwIfAborted(signal);
  if (code !== 0) throw new Error(stderr.trim() || 'FFmpeg could not inspect the VOD for match boundaries.');
  const requestedGames = Number.isInteger(Number(expectedGames)) ? Math.max(1, Math.min(12, Number(expectedGames))) : null;
  const candidateLimit = requestedGames ? Math.min(48, Math.max(12, requestedGames * 8)) : 12;
  ranked.sort((a, b) => b.rankScore - a.rankScore); const chosen = [];
  for (const candidate of ranked) {
    if (chosen.every(item => Math.abs(item.timestampMs - candidate.timestampMs) >= 30_000)) chosen.push(candidate);
    if (chosen.length >= candidateLimit) break;
  }
  return chosen.sort((a, b) => a.timestampMs - b.timestampMs);
}

function chooseGameBoundaries(candidates, durationMs, expectedGames) {
  const count = Math.max(1, Math.min(12, Number(expectedGames) || 1)); const minimumGap = Math.max(10 * 60_000, durationMs / Math.max(2, count * 2.5)); const selected = [];
  for (const candidate of [...candidates].sort((a, b) => b.agentSelectScore - a.agentSelectScore)) {
    // Agent select has both the bright cyan lobby field and the repeated card-row
    // geometry. Requiring both avoids blue walls/smokes during ordinary gameplay.
    if (candidate.agentSelectScore < 12 || candidate.score < 25 || selected.some(item => Math.abs(item.timestampMs - candidate.timestampMs) < minimumGap)) continue;
    selected.push(candidate); if (selected.length >= count) break;
  }
  return selected.sort((a, b) => a.timestampMs - b.timestampMs);
}

async function recognizeBoundaryMaps(boundaries, mapNames, progress, signal, mapHints = []) {
  if (!boundaries.length) return [];
  const known = [...new Set((mapNames || []).map(name => String(name || '').trim()).filter(Boolean))];
  if (!known.length) return boundaries.map(item => ({ ...item, map: null }));
  const sharp = require('sharp'); const { createWorker, PSM } = require('tesseract.js');
  const langPath = path.dirname(unpackedExecutable(require.resolve('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'))); const worker = await createWorker('eng', undefined, { langPath });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }); const output = [];
  try {
    for (let index = 0; index < boundaries.length; index += 1) {
      const item = boundaries[index];
      throwIfAborted(signal); const crop = await sharp(item.path).extract({ left: 0, top: 0, width: 760, height: 760 }).resize({ width: 1520 }).grayscale().normalize().png().toBuffer(); const result = await worker.recognize(crop); output.push({ ...item, ...resolveBoundaryMap(result.data?.text, known, mapHints) });
      progress?.({ stage: 'discover', percent: Math.round((index + 1) / boundaries.length * 100), message: `Reading map names · ${index + 1}/${boundaries.length}` });
    }
  } finally { await worker.terminate(); }
  return output;
}

async function extractFrame(file, timestampMs, target, signal) {
  await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, timestampMs / 1000)), '-i', file, '-frames:v', '1', '-vf', 'scale=1920:1080:flags=lanczos', '-y', target], { signal });
}

async function sha256File(file) {
  return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(file); stream.on('data', chunk => hash.update(chunk)); stream.on('error', reject); stream.on('end', () => resolve(hash.digest('hex'))); });
}

async function discoverVodGames(input, options = {}) {
  const progress = options.progress; const workRoot = options.workRoot || path.join(require('node:os').tmpdir(), 'moetracker-vod'); await fsp.mkdir(workRoot, { recursive: true }); await ensureDiskSpace(workRoot, options.minimumFreeBytes || MIN_FREE_BYTES);
  // A resumed job reopens its original working directory, so frame checkpoints
  // are reused and a retained download is still deleted once it completes.
  const resume = options.resume?.directory ? options.resume : null;
  const signal = options.signal; throwIfAborted(signal); const cacheId = resume?.cacheId || crypto.randomUUID(); const directory = resume ? path.resolve(resume.directory) : path.join(workRoot, `source-${cacheId}`); await fsp.mkdir(directory, { recursive: true });
  try {
    const downloaded = resume ? resume.downloaded === true : !input.localPath; const file = input.localPath ? path.resolve(String(input.localPath)) : await downloadYoutube(input.vodUrl, directory, progress, signal);
    const probe = await probeVideo(file, signal); const candidates = await sampleScoreboardCandidates(file, probe.durationSeconds, progress, signal, input.expectedGames); const games = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const target = path.join(directory, `scoreboard-${String(index + 1).padStart(2, '0')}.png`); await extractFrame(file, candidates[index].timestampMs, target, signal);
      games.push({ timestampMs: candidates[index].timestampMs, score: candidates[index].score, agentSelectScore: candidates[index].agentSelectScore, path: target, mediaType: 'image/png' });
      progress?.({ stage: 'discover', percent: Math.round((index + 1) / Math.max(1, candidates.length) * 100), message: `Preparing scoreboard candidates · ${index + 1}/${candidates.length}` });
    }
    let uploadDate = null; let uploader = null; if (downloaded) { const infoPath = path.join(directory, `${youtubeVideoId(input.vodUrl)}.info.json`); const info = JSON.parse(await fsp.readFile(infoPath, 'utf8').catch(() => '{}')); if (/^\d{8}$/.test(String(info.upload_date || ''))) uploadDate = `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`; uploader = String(info.uploader || info.channel || '').trim().slice(0, 100) || null; }
    const boundaryCandidates = chooseGameBoundaries(games, probe.durationMs, input.expectedGames); const requestedBoundaryCount = Math.max(1, Math.min(12, Number(input.expectedGames) || 1));
    if (boundaryCandidates.length === requestedBoundaryCount - 1 && boundaryCandidates[0]?.timestampMs > 10 * 60_000) {
      const target = path.join(directory, 'game-start-00.png'); await extractFrame(file, 0, target, signal); boundaryCandidates.unshift({ timestampMs: 0, score: 0, agentSelectScore: 0, path: target, mediaType: 'image/png' });
    }
    const recognizedBoundaries = await recognizeBoundaryMaps(boundaryCandidates, input.mapNames, progress, signal, input.mapHints);
    // Frames stay on disk and are named, not inlined: dozens of 1080p PNGs in one
    // IPC reply stalled the renderer. desktop:read-vod-frame serves them one at a time.
    const boundaries = recognizedBoundaries.map(({ path: framePath, ...item }) => ({ ...item, frame: path.basename(framePath) })); const publicGames = games.map(({ path: framePath, ...item }) => ({ ...item, frame: path.basename(framePath) }));
    const sourceSha256 = await sha256File(file); const vodUrl = input.vodUrl ? normalizeYoutubeUrl(input.vodUrl) : `moetracker-local://sha256/${sourceSha256}`;
    return { cacheId, directory, file, downloaded, uploadDate, uploader, vodUrl, videoId: youtubeVideoId(input.vodUrl), sourceSha256, durationMs: probe.durationMs, width: probe.width, height: probe.height, games: publicGames, boundaries };
  } catch (error) { if (!resume) await fsp.rm(directory, { recursive: true, force: true }).catch(() => {}); throw error; }
}

function frameDifference(left, right) {
  if (!left || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let total = 0; let count = 0;
  for (let index = 0; index < left.length; index += 24) { total += Math.abs(left[index] - right[index]); count += 1; }
  // Thresholds are expressed as a 0..1 fraction. Returning raw 0..255 values
  // made nearly every sampled frame look changed and caused enormous OCR jobs.
  return count ? total / count / 255 : 0;
}

/** Serve a discovered frame only to the window that ran the discovery. */
async function readOwnedVodFrame(sources, senderId, input) {
  const cached = sources.get(String(input?.cacheId || ''));
  if (!cached || cached.owner !== senderId) throw new Error('The detected VOD session expired. Detect the games again.');
  return readVodFrame(cached.directory, input?.frame);
}

const insideDirectory = (directory, target) => { const relative = path.relative(directory, target); return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative)); };

async function releaseVodSource(cached, completed) {
  if (completed && cached?.directory) {
    const directory = path.resolve(cached.directory);
    // A completed job's work directory holds its download and candidate frames.
    // A coach's own local VOD is never deleted, even if it lives inside it.
    if (cached.downloaded || !cached.file || !insideDirectory(directory, path.resolve(cached.file))) await fsp.rm(directory, { recursive: true, force: true });
  }
  return Boolean(cached?.file && fs.existsSync(path.resolve(cached.file)));
}

/**
 * Remove `source-*` work directories that no restartable job references: frame
 * folders from finished local-VOD jobs before cleanup existed, and partial
 * downloads left by a crash, whose job recovery marks failed.
 */
async function sweepOrphanedVodDirectories(workRoot, jobs) {
  const root = path.resolve(workRoot); const keep = new Set();
  for (const job of jobs || []) {
    if (!(job?.resumable === true || ['running', 'paused', 'ready', 'queued'].includes(job?.status))) continue;
    for (const cacheId of [job.cacheId, job.checkpoint?.cacheId]) if (/^[0-9a-f-]{36}$/i.test(String(cacheId || ''))) keep.add(path.join(root, `source-${cacheId}`));
    if (job.sourcePath) { const parent = path.dirname(path.resolve(String(job.sourcePath))); if (path.dirname(parent) === root) keep.add(parent); }
  }
  const removed = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^source-[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const directory = path.join(root, entry.name); if (keep.has(directory)) continue;
    await fsp.rm(directory, { recursive: true, force: true }); removed.push(entry.name);
  }
  return removed;
}

function visualSignature(frame) {
  if (!frame?.length) return null;
  const samples = 64; const stride = Math.max(1, Math.floor(frame.length / (samples + 1))); let previous = frame[0]; let bits = '';
  for (let index = 1; index <= samples; index += 1) { const value = frame[Math.min(frame.length - 1, index * stride)]; bits += value >= previous ? '1' : '0'; previous = value; }
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

// Keeps the most-changed frame per time bucket for one HUD region. Fed raw gray
// frames in decode order, from either decode path.
function createChangeCollector(spec, durationSeconds, range, progress, signal, label = spec.label) {
  const frameBytes = spec.width * spec.height; const fps = spec.fps; const buckets = new Map(); let previous = null; let pending = Buffer.alloc(0); let index = 0; let burstRemaining = 0;
  const { startSeconds, sampledDuration } = range;
  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameBytes) {
        throwIfAborted(signal);
        const frame = Buffer.from(pending.subarray(0, frameBytes)); pending = pending.subarray(frameBytes); const timestampMs = Math.round(startSeconds * 1000 + index / fps * 1000); index += 1;
        const difference = frameDifference(previous, frame); const changed = difference >= spec.threshold;
        if (changed) burstRemaining = Math.max(burstRemaining, spec.burstFrames || 0);
        if (changed || burstRemaining > 0) {
          const bucket = Math.min(spec.maxCandidates - 1, Math.floor(timestampMs / Math.max(1, durationSeconds * 1000) * spec.maxCandidates)); const existing = buckets.get(bucket);
          if (!existing || difference > existing.difference) buckets.set(bucket, { timestampMs, pixels: frame, difference });
          if (!changed) burstRemaining -= 1;
        }
        previous = frame;
        if (progress && index % 100 === 0) progress({ stage: 'sampling', percent: Math.min(99, Math.round((timestampMs / 1000 - startSeconds) / Math.max(1, sampledDuration) * 100)), message: `Sampling ${label} across the selected game…` });
      }
    },
    frames() { return [...buckets.values()].sort((a, b) => a.timestampMs - b.timestampMs).map(({ difference: _difference, ...frame }) => frame); },
  };
}

async function runDecode(args, outputs, signal) {
  const highest = Math.max(2, ...outputs.map(output => output.fd)); const stdio = Array.from({ length: highest + 1 }, (_, fd) => fd === 2 || outputs.some(output => output.fd === fd) ? 'pipe' : 'ignore');
  const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio });
  const onAbort = () => child.kill(); signal?.addEventListener('abort', onAbort, { once: true });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
  const closed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  try {
    // Every pipe is drained at the same time so ffmpeg never blocks on a full one.
    await Promise.all(outputs.map(async output => { for await (const chunk of child.stdio[output.fd]) output.collector.push(chunk); }));
    const code = await closed; throwIfAborted(signal);
    if (code !== 0) throw new Error(stderr.trim() || 'FFmpeg could not sample the VOD.');
  } catch (error) { child.kill(); await closed.catch(() => {}); throw error; } finally { signal?.removeEventListener('abort', onAbort); }
}

async function changedFrames(file, spec, durationSeconds, progress, signal, range = {}) {
  throwIfAborted(signal);
  const sampled = sampledRange(range, durationSeconds); const collector = createChangeCollector(spec, durationSeconds, sampled, progress, signal);
  await runDecode(regionDecodeArgs(file, spec, sampled), [{ fd: 1, collector }], signal);
  return collector.frames();
}

async function changedFramesTogether(file, specs, durationSeconds, progress, signal, range = {}, { hardwareDecode = false } = {}) {
  throwIfAborted(signal);
  const sampled = sampledRange(range, durationSeconds);
  const collectors = specs.map((spec, index) => createChangeCollector(spec, durationSeconds, sampled, index === 0 ? progress : null, signal, 'HUD regions'));
  await runDecode(combinedDecodeArgs(file, specs, sampled, { hardwareDecode }), collectors.map((collector, index) => ({ fd: 3 + index, collector })), signal);
  return Object.fromEntries(specs.map((spec, index) => [spec.key, collectors[index].frames()]));
}

// Candidate frames for every region. Tries one decode for all regions (with
// hardware decode when switched on), then one software decode, then the
// original one-decode-per-region path. All three produce the same frames.
async function sampleRegions(file, specs, durationSeconds, progress, signal, range = {}, performance = {}, log = () => {}, decoders = { together: changedFramesTogether, single: changedFrames }) {
  const attempts = [...(performance.hardwareDecode ? [{ hardwareDecode: true }] : []), ...(performance.singleDecode === false ? [] : [{ hardwareDecode: false }])];
  for (const attempt of attempts) {
    try { const frames = await decoders.together(file, specs, durationSeconds, progress, signal, range, attempt); log(`decode: single${attempt.hardwareDecode ? ' hardware' : ' software'}`); return frames; }
    catch (error) { throwIfAborted(signal); log(`decode: ${attempt.hardwareDecode ? 'hardware' : 'single software'} decode failed (${String(error?.message || error).split('\n')[0]}); falling back`); progress?.({ stage: 'sampling', percent: null, message: attempt.hardwareDecode ? 'Hardware decode failed; continuing with software decode…' : 'Combined decode failed; sampling one HUD region at a time…' }); }
  }
  const frames = {};
  for (const [index, spec] of specs.entries()) frames[spec.key] = await decoders.single(file, spec, durationSeconds, regionProgress(progress, index, specs.length), signal, range);
  log('decode: per-region software'); return frames;
}

/**
 * The end screen's stylised score digits read as junk in a sparse page read ("ALLIES | 1 ENEMIES"
 * for 7-17). Find the two words by column ink (the widest two runs are ALLIES and ENEMIES) and
 * cut out what lies between them: the two scores, binarized dark-on-light so the red digit
 * survives as well as the teal one. Returns null when the line does not split that way.
 */
function bannerDigitCrop(pixels, width, height) {
  if (!pixels || pixels.length < width * height) return null;
  const histogram = new Uint32Array(256); let max = 0; for (let index = 0; index < width * height; index += 1) { histogram[pixels[index]] += 1; if (pixels[index] > max) max = pixels[index]; }
  let seen = 0, median = 0; for (let value = 0; value < 256; value += 1) { seen += histogram[value]; if (seen >= width * height / 2) { median = value; break; } }
  const threshold = median + Math.max(30, Math.round((max - median) * 0.3)); if (threshold >= 255) return null;
  const ink = column => { let count = 0; for (let y = 0; y < height; y += 1) if (pixels[y * width + column] >= threshold) count += 1; return count >= 2; };
  const gap = Math.max(6, Math.round(height * 0.12)); const segments = [];
  for (let x = 0; x < width; x += 1) if (ink(x)) { const last = segments.at(-1); if (last && x - last.end <= gap) last.end = x; else segments.push({ start: x, end: x }); }
  const glyphs = segments.filter(item => item.end - item.start >= 2); if (glyphs.length < 3) return null;
  const words = [...glyphs].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 2).sort((a, b) => a.start - b.start);
  const left = words[0].end + 1, right = words[1].start - 1; if (right - left < 6 || !glyphs.some(item => item.start > words[0].end && item.end < words[1].start)) return null;
  let top = height, bottom = -1; for (let y = 0; y < height; y += 1) for (let x = left; x <= right; x += 1) if (pixels[y * width + x] >= threshold) { if (y < top) top = y; if (y > bottom) bottom = y; break; }
  if (bottom < top) return null;
  const pad = 10, cropWidth = right - left + 1 + pad * 2, cropHeight = bottom - top + 1 + pad * 2; const crop = Buffer.alloc(cropWidth * cropHeight, 255);
  for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) if (pixels[y * width + x] >= threshold) crop[(y - top + pad) * cropWidth + (x - left + pad)] = 0;
  return { pixels: crop, width: cropWidth, height: cropHeight, background: median };
}

// The stylised words are teal and red on a dark overlay: in grey they are dim. Stretching the
// crop's own range to full black-to-white and inverting it gives page OCR dark text on white.
function stretchedBanner(pixels, width, height) {
  if (!pixels || pixels.length < width * height) return null;
  const values = Uint8Array.from(pixels.subarray(0, width * height)).sort(); const low = values[Math.floor(values.length * .02)], high = values[Math.min(values.length - 1, Math.floor(values.length * .995))];
  if (high - low < 20) return null;
  const out = Buffer.alloc(width * height); for (let index = 0; index < width * height; index += 1) out[index] = 255 - Math.max(0, Math.min(255, Math.round((pixels[index] - low) * 255 / (high - low))));
  return { pixels: out, width, height };
}

// One crop per score: the glyphs between the words split at the dash (the short glyph), or at the
// widest gap, so "7" and "17" are read on their own and never run together as "717".
function splitDigitCrop(crop) {
  if (!crop) return null; const { pixels, width, height } = crop; const runs = [];
  const span = x => { let top = -1, bottom = -1; for (let y = 0; y < height; y += 1) if (pixels[y * width + x] === 0) { if (top < 0) top = y; bottom = y; } return top < 0 ? null : [top, bottom]; };
  for (let x = 0; x < width; x += 1) { const ink = span(x); if (!ink) continue; const last = runs.at(-1); if (last && x - last.end <= 2) { last.end = x; last.top = Math.min(last.top, ink[0]); last.bottom = Math.max(last.bottom, ink[1]); } else runs.push({ start: x, end: x, top: ink[0], bottom: ink[1] }); }
  if (runs.length < 2) return null;
  const tallest = Math.max(...runs.map(run => run.bottom - run.top + 1)); const dash = runs.findIndex((run, index) => index > 0 && index < runs.length - 1 && run.bottom - run.top + 1 < tallest * .45);
  let left, right;
  if (dash > 0) { left = runs.slice(0, dash); right = runs.slice(dash + 1); }
  else { let widest = 0; for (let index = 1; index < runs.length; index += 1) if (runs[index].start - runs[index - 1].end > runs[widest + 1].start - runs[widest].end) widest = index - 1; left = runs.slice(0, widest + 1); right = runs.slice(widest + 1); }
  if (!left.length || !right.length) return null;
  const cut = (from, to) => { const pad = 10, cropWidth = to - from + 1 + pad * 2; const out = Buffer.alloc(cropWidth * height, 255); for (let y = 0; y < height; y += 1) for (let x = from; x <= to; x += 1) out[y * cropWidth + x - from + pad] = pixels[y * width + x]; return { pixels: out, width: cropWidth, height }; };
  return [cut(left[0].start, left.at(-1).end), cut(right[0].start, right.at(-1).end)];
}

const BANNER_LINE = /\ballies\b[^\d]{0,24}?(\d{1,2})[^\d]{1,24}?(\d{1,2})[^\d]{0,24}?\benemies\b/i;

/**
 * Re-read the end screen. The page read often drops the stylised words, so a frame qualifies when
 * its text names either side, or when it splits like the banner (two wide words around narrower
 * glyphs) over a dark full-screen overlay. Each one is read again as one line on a contrast-stretched
 * crop (the words), then each score digits-only from its own crop. Left is Allies (ours).
 */
async function readBannerDigits(frames, snapshots, worker, log = line => void line, limit = 40) {
  const out = [...(snapshots || [])]; const counts = { frames: (frames || []).length, withText: 0, anchorWord: 0, darkSplit: 0, tried: 0, anchorRead: 0, read: 0 };
  const textAt = new Map(out.map(item => [item.timestampMs, item]));
  const chosen = [];
  for (const frame of frames || []) {
    const snapshot = textAt.get(frame.timestampMs); if (snapshot) counts.withText += 1;
    const word = /allies|enemies/i.test(snapshot?.text || ''); if (word) counts.anchorWord += 1;
    const crop = bannerDigitCrop(frame.pixels, frame.width, frame.height);
    const dark = !!crop && crop.background < 70; if (dark) counts.darkSplit += 1;
    if (crop && (word || dark)) chosen.push({ frame, crop, snapshot, word });
  }
  const text = async image => String((await worker.recognize(pgm(image.pixels, image.width, image.height)))?.data?.text || '');
  try {
    if (chosen.length && worker) {
      const tried = chosen.slice(-limit); counts.tried = tried.length;
      // The words: one line, then one block, on the stretched crop.
      for (const mode of ['7', '6']) {
        await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: mode });
        for (const item of tried) {
          if (item.line) continue; const stretched = stretchedBanner(item.frame.pixels, item.frame.width, item.frame.height); if (!stretched) continue;
          const read = await text(stretched); if (/allies|enemies/i.test(read)) { item.word = true; item.line = BANNER_LINE.test(read) ? read : item.line; if (!item.anchored) { item.anchored = true; counts.anchorRead += 1; } }
        }
      }
      // The scores: each from its own crop, digits only; the whole middle only when it will not split.
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
      const reads = [];
      for (const item of tried) {
        let left = null, right = null; const halves = splitDigitCrop(item.crop);
        if (halves) { left = (await text(halves[0])).match(/\d{1,2}/)?.[0]; right = (await text(halves[1])).match(/\d{1,2}/)?.[0]; }
        if (!left || !right) { const match = (await text(item.crop)).match(/(\d{1,2})\D+(\d{1,2})/); if (match) [left, right] = [match[1], match[2]]; }
        if ((!left || !right) && item.line) { const match = item.line.match(BANNER_LINE); [left, right] = [match[1], match[2]]; }
        if (left && right) reads.push({ ...item, banner: `ALLIES ${Number(left)} - ${Number(right)} ENEMIES` });
      }
      // A frame that names a side stands alone. A dark split without a word could be any dark
      // scene, so it counts only when another frame read the same score: the end screen stays up.
      for (const item of reads) {
        if (!item.word && reads.filter(other => other.banner === item.banner).length < 2) continue;
        counts.read += 1;
        if (item.snapshot) item.snapshot.text = item.banner; else out.push({ timestampMs: item.frame.timestampMs, text: item.banner, confidence: null });
      }
    }
  } finally {
    if (chosen.length && worker) await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '11' }).catch(() => {});
    log(`end-banner: frames ${counts.frames}, with text ${counts.withText}, anchor word ${counts.anchorWord}, dark split ${counts.darkSplit}, tried ${counts.tried}, anchor read ${counts.anchorRead}, digits read ${counts.read}`);
  }
  return out.sort((a, b) => a.timestampMs - b.timestampMs);
}

// Sparse-text OCR puts each word of a kill-feed row on its own line, so "killer [gun] victim" never
// shares a line. Words are put back into rows by their vertical centre, left to right.
function rowText(data) {
  const words = (data?.blocks || []).flatMap(block => (block.paragraphs || []).flatMap(paragraph => (paragraph.lines || []).flatMap(line => line.words || []))).filter(word => String(word.text || '').trim() && word.bbox);
  if (!words.length) return '';
  const heights = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b); const tolerance = Math.max(4, heights[Math.floor(heights.length / 2)] * .6);
  const rows = [];
  for (const word of [...words].sort((a, b) => (a.bbox.y0 + a.bbox.y1) - (b.bbox.y0 + b.bbox.y1))) {
    const centre = (word.bbox.y0 + word.bbox.y1) / 2; const row = rows.find(item => Math.abs(item.centre - centre) <= tolerance);
    if (row) { row.words.push(word); row.centre = (row.centre * (row.words.length - 1) + centre) / row.words.length; } else rows.push({ centre, words: [word] });
  }
  return rows.sort((a, b) => a.centre - b.centre).map(row => row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => String(word.text).trim()).join(' ')).join('\n');
}

function pgm(frame, width, height) { return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), frame]); }

// OCR workers for one analysis. degrade() drops to a single fresh worker after
// a failure so the import keeps going.
async function createOcrPool(count, log = () => {}, tesseract = require('tesseract.js')) {
  const { createWorker, PSM } = tesseract;
  const langPath = path.dirname(unpackedExecutable(require.resolve('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz')));
  const start = async () => { const worker = await createWorker('eng', undefined, { langPath }); await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }); return worker; };
  const pool = { workers: [] };
  for (let index = 0; index < count; index += 1) {
    try { pool.workers.push(await start()); }
    catch (error) { if (!pool.workers.length) throw error; log(`ocr: started ${pool.workers.length} of ${count} workers (${String(error?.message || error)})`); break; }
  }
  pool.terminate = async () => { await Promise.allSettled(pool.workers.map(worker => worker.terminate())); pool.workers = []; };
  pool.degrade = async error => { log(`ocr: worker failed (${String(error?.message || error)}); continuing with 1 worker`); await pool.terminate(); pool.workers = [await start()]; pool.degrade = null; };
  return pool;
}

// Reads frames on every pool worker at once but commits results in frame
// order, so snapshots and checkpoints match a single worker exactly.
async function recognizeFrames(frames, spec, pool, progress, offset, total, signal, resume = null, saveCheckpoint = null) {
  const keys = frames.map(frame => `${frame.timestampMs}:${visualSignature(frame.pixels)}`); const compatible = resume && Array.isArray(resume.keys) && JSON.stringify(resume.keys) === JSON.stringify(keys);
  let committed = compatible ? Math.max(0, Math.min(frames.length, Number(resume.processed) || 0)) : 0; const snapshots = compatible && Array.isArray(resume.snapshots) ? structuredClone(resume.snapshots) : [];
  const commit = async (index, result) => {
    const text = String((spec.rows && rowText(result.data)) || result.data?.text || '').trim(); const confidence = Number(result.data?.confidence);
    if (text) snapshots.push({ timestampMs: frames[index].timestampMs, text, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence / 100)) : null, visualSignature: visualSignature(frames[index].pixels) });
    if (saveCheckpoint && ((index + 1) % 10 === 0 || index + 1 === frames.length)) await saveCheckpoint({ keys, processed: index + 1, snapshots });
    progress?.({ stage: 'ocr', percent: Math.round((offset + index + 1) / Math.max(1, total) * 100), message: `Reading timeline evidence · ${offset + index + 1}/${total}` });
  };
  while (committed < frames.length) {
    const idle = [...pool.workers]; const done = new Map(); const running = new Set(); let next = committed; let failure = null;
    const dispatch = () => {
      while (!failure && idle.length && next < frames.length) {
        const worker = idle.shift(); const index = next; next += 1;
        const job = worker.recognize(pgm(frames[index].pixels, spec.width, spec.height), undefined, spec.rows ? { text: true, blocks: true } : undefined).then(result => { done.set(index, result); idle.push(worker); }, error => { failure = failure || error; }).finally(() => running.delete(job));
        running.add(job);
      }
    };
    try {
      dispatch();
      while (committed < frames.length && !failure) {
        throwIfAborted(signal);
        if (!done.has(committed)) { await Promise.race(running); continue; }
        const result = done.get(committed); done.delete(committed); await commit(committed, result); committed += 1; dispatch();
      }
    } finally { if (running.size) await Promise.allSettled([...running]); }
    if (failure) { throwIfAborted(signal); if (!pool.degrade) throw failure; await pool.degrade(failure); }
  }
  return snapshots;
}

async function readCheckpoint(file) { if (!file) return null; try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; } }
async function writeCheckpoint(file, value) { if (!file) return; await fsp.mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await fsp.writeFile(temporary, JSON.stringify(value), { mode: 0o600 }); await fsp.rename(temporary, file); }

// Up to ten named identities from the renderer. An empty list is valid: the
// first import on a fresh workspace knows no names yet.
function normalizeTimelinePlayers(raw) {
  if (!Array.isArray(raw)) return [];
  const count = value => Number.isInteger(value) && value >= 0 ? value : null;
  return raw.slice(0, 10).map(item => ({ name: String(item?.name || '').trim().slice(0, 100), team: item?.team === 'theirs' ? 'theirs' : 'ours', expectedKills: count(item?.expectedKills), expectedDeaths: count(item?.expectedDeaths) })).filter(item => item.name);
}

function inferPovPlayer(snapshots, players) {
  const counts = players.map(player => ({ name: player.name, count: snapshots.filter(snapshot => {
    const normalized = String(snapshot.text || '').toLowerCase().replace(/[^a-z0-9]/g, ''); const needle = String(player.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return needle.length >= 3 && normalized.includes(needle);
  }).length })).sort((a, b) => b.count - a.count);
  if (!counts[0] || counts[0].count < 3 || (counts[1] && counts[0].count < counts[1].count * 2)) return null;
  return counts[0].name;
}

async function analyzeVodTimeline(input, options = {}) {
  const progress = gameProgressReporter(options.progress); const workRoot = options.workRoot || path.join(require('node:os').tmpdir(), 'moetracker-vod');
  await fsp.mkdir(workRoot, { recursive: true }); await ensureDiskSpace(workRoot, options.minimumFreeBytes || MIN_FREE_BYTES);
  const controller = new AbortController(); const externalAbort = () => controller.abort(options.signal?.reason || new Error('VOD analysis was cancelled.'));
  if (options.signal?.aborted) externalAbort(); else options.signal?.addEventListener('abort', externalAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('VOD analysis exceeded its safe processing time. Retry with the original local video or a shorter recording.')), options.timeoutMs || DEFAULT_JOB_TIMEOUT_MS);
  const signal = controller.signal; const jobDirectory = path.join(workRoot, crypto.randomUUID()); await fsp.mkdir(jobDirectory, { recursive: true }); let file; const downloaded = !input.localPath;
  try {
    throwIfAborted(signal);
    if (input.localPath) { file = path.resolve(String(input.localPath)); if (!fs.existsSync(file)) throw new Error('The selected local VOD no longer exists.'); }
    else file = await downloadYoutube(input.vodUrl, jobDirectory, progress, signal);
    const probe = await probeVideo(file, signal); progress?.({ stage: 'probe', percent: 100, message: `${Math.ceil(probe.durationSeconds / 60)} minute VOD detected · ${probe.width}×${probe.height}` });
    const specs = [
      { key: 'killFeedSnapshots', label: 'kill feed', fps: 2, crop: 'crop=iw*0.42:ih*0.38:iw*0.58:0', width: 720, height: 366, threshold: .15, burstFrames: 3, maxCandidates: 3600, rows: true },
      { key: 'objectiveSnapshots', label: 'round and objective notices', fps: 1, crop: 'crop=iw*0.62:ih*0.34:iw*0.19:ih*0.02', width: 720, height: 222, threshold: .15, burstFrames: 2, maxCandidates: 1800 },
      { key: 'roundStateSnapshots', label: 'round state and score', fps: 1, crop: 'crop=iw*0.46:ih*0.20:iw*0.27:0', width: 700, height: 240, threshold: .10, burstFrames: 2, maxCandidates: 1800 },
      { key: 'ultimateSnapshots', label: 'ultimate state', fps: 1, crop: 'crop=iw*0.28:ih*0.25:iw*0.36:ih*0.72', width: 520, height: 260, threshold: .12, burstFrames: 2, maxCandidates: 1800 },
      { key: 'povSnapshots', label: 'POV identity', fps: .25, crop: 'crop=iw*0.34:ih*0.28:0:ih*0.67', width: 560, height: 280, threshold: .08, burstFrames: 1, maxCandidates: 600 },
      { key: 'scoreboardSnapshots', label: 'scoreboard totals', fps: .2, crop: 'crop=iw*0.78:ih*0.72:iw*0.11:ih*0.14', width: 1100, height: 680, threshold: .12, burstFrames: 1, maxCandidates: 480 },
      // The custom-game end screen: one centred line "ALLIES n - m ENEMIES" that stays up for minutes.
      // It is static, so a change gate skips it: every 5 s is a candidate, one kept per time bucket.
      { key: 'endBannerSnapshots', label: 'end screen', fps: .2, crop: 'crop=iw*0.70:ih*0.13:iw*0.15:ih*0.42', width: 980, height: 182, threshold: 0, burstFrames: 0, maxCandidates: 240 },
    ];
    const checkpointKey = crypto.createHash('sha256').update(JSON.stringify({ source: input.sourceSha256 || path.resolve(file), startMs: Number(input.startMs) || 0, endMs: Number(input.endMs) || null, players: input.players || [], observerMode: !!input.observerMode, povPlayerName: input.povPlayerName || null })).digest('hex');
    const saved = await readCheckpoint(options.checkpointFile); const checkpoint = saved?.schema === 'moetracker.vod-checkpoint/v1' && saved.key === checkpointKey ? saved : { schema: 'moetracker.vod-checkpoint/v1', key: checkpointKey, specs: {}, updatedAt: null };
    const performance = { ...normalizeVodPerformance(options.performance), singleDecode: options.performance?.singleDecode !== false }; const log = options.log || (() => {});
    const candidates = await sampleRegions(file, specs, probe.durationSeconds, progress, signal, { startMs: input.startMs, endMs: input.endMs }, performance, log);
    const total = specs.reduce((sum, spec) => sum + candidates[spec.key].length, 0);
    const frameBytes = specs.reduce((sum, spec) => sum + candidates[spec.key].length * spec.width * spec.height, 0);
    const workerCount = resolveOcrWorkers(performance.ocrWorkers, { cpus: os.availableParallelism?.() || os.cpus().length, freeBytes: os.freemem(), frameBytes });
    progress?.({ stage: 'ocr', percent: 0, message: `Reading ${total} changed HUD frames locally${workerCount > 1 ? ` on ${workerCount} threads` : ''}…` }); log(`ocr: ${workerCount} worker${workerCount === 1 ? '' : 's'} (setting ${performance.ocrWorkers})`);
    const pool = await createOcrPool(workerCount, log);
    let offset = 0; const snapshots = {};
    try {
      for (const spec of specs) { snapshots[spec.key] = await recognizeFrames(candidates[spec.key], spec, pool, progress, offset, total, signal, checkpoint.specs[spec.key], async state => { checkpoint.specs[spec.key] = state; checkpoint.updatedAt = new Date().toISOString(); await writeCheckpoint(options.checkpointFile, checkpoint); }); offset += candidates[spec.key].length; }
      const bannerSpec = specs.find(spec => spec.key === 'endBannerSnapshots');
      snapshots.endBannerSnapshots = await readBannerDigits(candidates.endBannerSnapshots.map(frame => ({ ...frame, width: bannerSpec.width, height: bannerSpec.height })), snapshots.endBannerSnapshots, pool.workers[0], log);
    }
    finally { await pool.terminate(); }
    // Comparison runs (scripts/vod-speed-compare.cjs) hash exactly what was sampled and read.
    options.inspect?.({ candidates, snapshots: structuredClone(snapshots), ocrWorkers: workerCount });
    if (Array.isArray(input.visualTemplates) && input.visualTemplates.length) for (const spec of specs) snapshots[spec.key] = applyVisualTemplates(snapshots[spec.key], input.visualTemplates);
    const rangeDurationMs = Number(input.endMs) > Number(input.startMs || 0) ? Number(input.endMs) - Number(input.startMs || 0) : probe.durationMs;
    const inferredPov = input.observerMode ? null : (input.povPlayerName || inferPovPlayer(snapshots.povSnapshots || [], input.players || []));
    const evidence = aggregateVideoEvidence({ players: input.players || [], povPlayerName: inferredPov || null, observerMode: !!input.observerMode, durationMs: rangeDurationMs, killFeedSnapshots: snapshots.killFeedSnapshots, objectiveSnapshots: snapshots.objectiveSnapshots, roundStateSnapshots: snapshots.roundStateSnapshots, ultimateSnapshots: snapshots.ultimateSnapshots, povSnapshots: snapshots.povSnapshots, scoreboardSnapshots: snapshots.scoreboardSnapshots, endBannerSnapshots: snapshots.endBannerSnapshots });
    evidence.limitations.push(inferredPov ? `POV identity used for personal orb and ultimate evidence: ${inferredPov}.` : 'No single player POV identity was proven; personal orb and ultimate totals remain unknown.');
    evidence.source = { kind: input.sourceKind || (downloaded ? 'youtube' : 'local-file'), videoId: input.videoId || youtubeVideoId(input.vodUrl), sha256: input.sourceSha256 || await sha256File(file), width: probe.width, height: probe.height, durationMs: probe.durationMs, analyzedAt: new Date().toISOString() };
    checkpoint.completedAt = new Date().toISOString(); await writeCheckpoint(options.checkpointFile, checkpoint); progress?.({ stage: 'complete', percent: 100, message: `Timeline scan complete · ${evidence.observations.length} supported observations.` }); return evidence;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', externalAbort); await fsp.rm(jobDirectory, { recursive: true, force: true }).catch(() => {}); }
}

function safeClipName(value) { return String(value || 'review').normalize('NFKD').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'review'; }

async function createReviewClips(input, options = {}) {
  const moments = Array.isArray(input.moments) ? input.moments.slice(0, 20) : [];
  if (!moments.length) throw new Error('Choose at least one supported review moment.');
  const outputRoot = path.resolve(options.outputRoot || path.join(require('node:os').tmpdir(), 'moetracker-review-clips'));
  const workRoot = path.resolve(options.workRoot || path.join(require('node:os').tmpdir(), 'moetracker-vod'));
  await fsp.mkdir(outputRoot, { recursive: true }); await fsp.mkdir(workRoot, { recursive: true });
  const jobDirectory = path.join(workRoot, `clips-${crypto.randomUUID()}`); await fsp.mkdir(jobDirectory, { recursive: true });
  let sourceFile = input.localPath ? path.resolve(String(input.localPath)) : null;
  try {
    if (sourceFile) { if (!fs.existsSync(sourceFile)) throw new Error('The selected local VOD no longer exists.'); }
    else sourceFile = await downloadYoutube(input.vodUrl, jobDirectory, options.progress, options.signal);
    const probe = await probeVideo(sourceFile, options.signal); const output = [];
    for (let index = 0; index < moments.length; index += 1) {
      throwIfAborted(options.signal); const moment = moments[index] || {};
      const center = Math.max(0, Math.min(probe.durationMs, Number(moment.timestampMs) || 0));
      const startMs = Math.max(0, Number.isFinite(Number(moment.startMs)) ? Number(moment.startMs) : center - 8_000);
      const endMs = Math.min(probe.durationMs, Number.isFinite(Number(moment.endMs)) ? Number(moment.endMs) : center + 8_000);
      if (endMs - startMs < 2_000 || endMs - startMs > 90_000) throw new Error('Review clips must be between 2 and 90 seconds.');
      const id = crypto.randomUUID(); const fileName = `${safeClipName(moment.label)}-${String(Math.round(center / 1000)).padStart(5, '0')}-${id.slice(0, 8)}.mp4`; const target = path.join(outputRoot, fileName);
      await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-ss', String(startMs / 1000), '-i', sourceFile, '-t', String((endMs - startMs) / 1000), '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', '-y', target], { signal: options.signal });
      output.push({ id, fileName, path: target, label: String(moment.label || 'Review moment').slice(0, 200), startMs: Math.round(startMs), endMs: Math.round(endMs) });
      options.progress?.({ stage: 'clips', percent: Math.round((index + 1) / moments.length * 100), message: `Creating review clips · ${index + 1}/${moments.length}` });
    }
    return output;
  } finally { await fsp.rm(jobDirectory, { recursive: true, force: true }).catch(() => {}); }
}

const VOD_FRAME_NAME = /^(?:scoreboard-\d{2}|game-start-00)\.png$/;

/** Reads one named candidate frame from a discovery directory. */
async function readVodFrame(directory, frame) {
  const name = String(frame || ''); if (!VOD_FRAME_NAME.test(name)) throw new Error('Unknown VOD frame.');
  return { mediaType: 'image/png', base64: (await fsp.readFile(path.join(path.resolve(directory), name))).toString('base64') };
}

module.exports = { rowText, stretchedBanner, splitDigitCrop, bannerDigitCrop, readBannerDigits, sweepOrphanedVodDirectories, readOwnedVodFrame, readVodFrame, normalizeYoutubeUrl, youtubeVideoId, probeVideo, analyzeVodTimeline, normalizeTimelinePlayers, discoverVodGames, releaseVodSource, createReviewClips, changedFrames, changedFramesTogether, sampleRegions, recognizeFrames, createOcrPool, frameDifference, visualSignature, ensureDiskSpace, scoreboardGeometryScore, agentSelectGeometryScore, chooseGameBoundaries, inferPovPlayer };
