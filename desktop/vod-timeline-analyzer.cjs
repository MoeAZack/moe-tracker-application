const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { aggregateVideoEvidence, applyVisualTemplates, nameAppears } = require('./vod-timeline-evidence.cjs');
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
  const frameBytes = spec.width * spec.height; const fps = spec.fps; const buckets = new Map(); let previous = null; let pending = Buffer.alloc(0); let index = 0; let burstRemaining = 0; let lastKeptMs = -Infinity;
  const { startSeconds, sampledDuration } = range;
  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameBytes) {
        throwIfAborted(signal);
        const frame = Buffer.from(pending.subarray(0, frameBytes)); pending = pending.subarray(frameBytes); const timestampMs = Math.round(startSeconds * 1000 + index / fps * 1000); index += 1;
        const difference = frameDifference(previous, frame); const changed = difference >= spec.threshold;
        if (changed) burstRemaining = Math.max(burstRemaining, spec.burstFrames || 0);
        // A static HUD (the score between rounds, the last score before a disconnect) still gets a frame every few seconds.
        const heartbeat = spec.everySeconds > 0 && timestampMs - lastKeptMs >= spec.everySeconds * 1000;
        // A spec with rank (the TAB board) keeps the frame that looks most like its target in each bucket,
        // whatever the change gate says: a board up for one second is otherwise lost to the frame that closes it.
        const rank = spec.rank ? spec.rank(frame, spec.width, spec.height) : 0, ranked = spec.rank && rank >= (spec.rankKeep ?? 1);
        if (changed || burstRemaining > 0 || heartbeat || ranked) {
          lastKeptMs = timestampMs;
          const bucket = Math.min(spec.maxCandidates - 1, Math.floor(timestampMs / Math.max(1, durationSeconds * 1000) * spec.maxCandidates)); const existing = buckets.get(bucket);
          if (!existing || rank > existing.rank || (rank === existing.rank && difference > existing.difference)) buckets.set(bucket, { timestampMs, pixels: frame, difference, rank });
          if (!changed) burstRemaining -= 1;
        }
        previous = frame;
        if (progress && index % 100 === 0) progress({ stage: 'sampling', percent: Math.min(99, Math.round((timestampMs / 1000 - startSeconds) / Math.max(1, sampledDuration) * 100)), message: `Sampling ${label} across the selected game…` });
      }
    },
    frames() { return [...buckets.values()].sort((a, b) => a.timestampMs - b.timestampMs).map(({ difference: _difference, rank: _rank, ...frame }) => frame); },
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
function medianGray(pixels, width, height) {
  if (!pixels || pixels.length < width * height) return 255; const histogram = new Uint32Array(256); for (let index = 0; index < width * height; index += 1) histogram[pixels[index]] += 1;
  let seen = 0; for (let value = 0; value < 256; value += 1) { seen += histogram[value]; if (seen >= width * height / 2) return value; } return 255;
}

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

// Where the two scores sit on the custom-game end screen, as fractions of the full frame (measured on
// a 1280x720 coach VOD; the layout scales with the screen). The banner crop spans x 0.15-0.85, y 0.42-0.55.
const KILL_FEED_BOX = { x0: .74, x1: .99, y0: .085, y1: .30 };
const killFeedCrop = (box = KILL_FEED_BOX) => `crop=iw*${+(box.x1 - box.x0).toFixed(3)}:ih*${+(box.y1 - box.y0).toFixed(3)}:iw*${box.x0}:ih*${box.y0}`;
const BANNER_CROP = { x0: .15, x1: .85, y0: .42, y1: .55 };
const SCORE_BOXES = [{ x0: .255, x1: .295, y0: .445, y1: .525 }, { x0: .690, x1: .735, y0: .445, y1: .525 }];

// One score cut from its fixed box: lit pixels (over half the box's brightest; the overlay is ~25) as ink, dark on
// white, trimmed, padded and scaled up 3x (its height). Each glyph's width/height goes with it for the 7/1 check.
function scoreBoxCrop(pixels, width, height, box, scale = 3, light = null, { frameBox = BANNER_CROP, minGlyphHeight = .5 } = {}) {
  if (!pixels || pixels.length < width * height) return null;
  const px = value => Math.round((value - frameBox.x0) / (frameBox.x1 - frameBox.x0) * width), py = value => Math.round((value - frameBox.y0) / (frameBox.y1 - frameBox.y0) * height);
  const left = Math.max(0, px(box.x0)), right = Math.min(width - 1, px(box.x1)), top = Math.max(0, py(box.y0)), bottom = Math.min(height - 1, py(box.y1));
  // The red score is dim in grey (~110, near a fixed cut), so each box is cut at half its own brightest pixel.
  if (light === null) { let brightest = 0; for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) brightest = Math.max(brightest, pixels[y * width + x]); light = Math.max(60, Math.round(brightest * .55)); }
  const lit = (x, y) => pixels[y * width + x] > light; const glyphs = []; const ink = new Map();
  // Glyphs split at any empty column: the 1 and 7 of "17" stand ~1 px apart.
  for (let x = left; x <= right; x += 1) {
    let first = -1, last = -1, count = 0; for (let y = top; y <= bottom; y += 1) if (lit(x, y)) { count += 1; if (first < 0) first = y; last = y; }
    ink.set(x, count); if (count < 2) continue; const run = glyphs.at(-1);
    if (run && x - run.end <= 1) { run.end = x; run.top = Math.min(run.top, first); run.bottom = Math.max(run.bottom, last); } else glyphs.push({ start: x, end: x, top: first, bottom: last });
  }
  // The crop is squeezed (980x182 from a 16:9 band 0.70 wide, 0.13 tall): widths are stretched back
  // so glyph shapes, and the 7/1 width check, are as on screen.
  const aspect = ((frameBox.x1 - frameBox.x0) * 16) / ((frameBox.y1 - frameBox.y0) * 9) / (width / height); const sx = Math.max(1, Math.round(scale * aspect)), sy = scale;
  // Digits fill ~70% of the box height; the words (~25%) and specks do not count.
  let kept = glyphs.filter(run => run.bottom - run.top + 1 >= (bottom - top + 1) * minGlyphHeight); if (!kept.length) return null;
  // One glyph wider than any digit (~0.45) is two touching digits: split it at its thinnest column.
  kept = kept.flatMap(run => {
    if ((run.end - run.start + 1) * aspect / (run.bottom - run.top + 1) <= .62) return [run];
    const from = run.start + Math.floor((run.end - run.start) * .2), to = run.end - Math.floor((run.end - run.start) * .2); let cut = from; for (let x = from; x <= to; x += 1) if (ink.get(x) < ink.get(cut)) cut = x;
    // Both halves must be digit-sized; a sliver means one wide glyph, not two.
    const height = run.bottom - run.top + 1; if ((cut - run.start) * aspect < height * .2 || (run.end - cut) * aspect < height * .2) return [run];
    return [{ ...run, end: cut - 1 }, { ...run, start: cut + 1 }];
  });
  const render = (x0, x1, y0, y1) => {
    const pad = 10, cropWidth = (x1 - x0 + 1 + pad * 2) * sx, cropHeight = (y1 - y0 + 1 + pad * 2) * sy; const out = Buffer.alloc(cropWidth * cropHeight, 255);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (lit(x, y)) for (let dy = 0; dy < sy; dy += 1) { const row = ((y - y0 + pad) * sy + dy) * cropWidth; out.fill(0, row + (x - x0 + pad) * sx, row + (x - x0 + pad + 1) * sx); }
    return { pixels: out, width: cropWidth, height: cropHeight };
  };
  const y0 = Math.min(...kept.map(run => run.top)), y1 = Math.max(...kept.map(run => run.bottom));
  return { ...render(kept[0].start, kept.at(-1).end, y0, y1), glyphs: kept.map(run => ({ width: Math.round((run.end - run.start + 1) * aspect), height: run.bottom - run.top + 1, crop: render(run.start, run.end, y0, y1) })) };
}

// This font's lone 7 reads as "1" to Tesseract. A 1 is narrow (width/height ~0.28), a 7 is not (~0.44).
const narrowGlyph = glyph => glyph.width / glyph.height < .35;
function fixSevens(read, glyphs) {
  const digits = String(read || '').replace(/\D/g, ''); if (!digits || !glyphs || digits.length !== glyphs.length) return digits || null;
  return [...digits].map((digit, index) => digit === '1' && !narrowGlyph(glyphs[index]) ? '7' : digit).join('');
}

// A score read glyph by glyph, so a narrow leading 1 is never dropped ("17" read as "7"): a narrow glyph
// is a 1 (no other digit is that narrow), each other one is read on its own. The whole box is the fallback.
async function readScoreBox(box, text) {
  const raw = {};
  if (box.glyphs.length === 2) {
    const digits = [];
    for (const glyph of box.glyphs) {
      if (narrowGlyph(glyph)) { digits.push('1'); continue; }
      const read = await text(glyph.crop); (raw.glyphs ||= []).push(read.trim()); const digit = fixSevens(read.match(/\d/)?.[0], [glyph]); if (!digit) { digits.length = 0; break; } digits.push(digit);
    }
    if (digits.length === box.glyphs.length) return { value: digits.join(''), raw };
  }
  raw.box = await text(box); return { value: fixSevens(raw.box, box.glyphs)?.slice(0, 2) || null, raw };
}

// The coach-view TAB board (measured on a 1280x720 coach VOD): our five rows on top (teal) at a 0.0316
// pitch, and the K, D and A cells under one "KDA" header. The board sits higher or lower in the frame
// (it moves up when the HUD is hidden), so the region spans most of the height and the rows are found
// at any vertical offset from where they were measured. The coach only taps TAB, so the board is up
// ~1 s; the region is sampled at 4 fps and read here, never by the page OCR.
const TAB_BOX = { x0: .297, x1: .702, y0: .03, y1: .97 };
const TAB_FRAME = { width: 518, height: 676 };
const TAB_OUR_ROWS = [.329, .361, .393, .424, .456];
const TAB_ROW_HALF = .015;
// The enemy five sit under the DEF/ATK strips, ~6.85 pitches below ours; scoring all ten rows keeps
// the strips (lit icons on a dark band) from passing for two of our rows.
const TAB_ENEMY_ROWS = TAB_OUR_ROWS.map(centre => +(centre + .2165).toFixed(4));
// Measured on the 2782 s frame: name 0.333-0.43 (the agent icon ends at 0.316, ULTIMATE starts at 0.439);
// K 0.492-0.502, D 0.513-0.523, A 0.535-0.540, each padded so a two-digit value still fits.
const TAB_CELLS = { name: { x0: .333, x1: .43 }, kills: { x0: .489, x1: .506 }, deaths: { x0: .510, x1: .527 }, assists: { x0: .531, x1: .548 } };

// Cheap test before any OCR: on the board each of our rows has a few K/D/A glyph pixels well above a
// darker row (teal or dark grey); gameplay rarely gives that in five rows at the board's pitch. Per-line
// counts are taken once, then every vertical offset is scored; returns the best { rows, dy }.
function tabBoardFit(pixels, width, height) {
  if (!pixels || pixels.length < width * height) return { rows: 0, dy: 0 };
  const px = value => Math.round((value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * width), py = value => Math.round((value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * height);
  const x0 = Math.max(0, px(TAB_CELLS.kills.x0)), x1 = Math.min(width - 1, px(TAB_CELLS.assists.x1));
  const lit = new Float64Array(height), dim = new Float64Array(height), dimSum = new Float64Array(height);
  // Lit is relative to the line's own mean: on a 720p coach VOD the thin white digits blur to ~150 over a ~60 teal row.
  for (let y = 0; y < height; y += 1) { let sum = 0; for (let x = x0; x <= x1; x += 1) sum += pixels[y * width + x]; const mean = sum / (x1 - x0 + 1); for (let x = x0; x <= x1; x += 1) { const value = pixels[y * width + x]; if (value > Math.max(mean + 40, 90)) lit[y] += 1; else { dim[y] += 1; dimSum[y] += value; } } }
  const rowOk = (top, bottom) => { let l = 0, d = 0, sum = 0; for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y += 1) { l += lit[y]; d += dim[y]; sum += dimSum[y]; } const count = l + d; return count > 0 && l / count >= .02 && l / count <= .4 && d > 0 && sum / d < 140; };
  const lineHeight = (TAB_BOX.y1 - TAB_BOX.y0) / height, scored = [];
  const low = TAB_BOX.y0 + TAB_ROW_HALF - TAB_OUR_ROWS[0], high = TAB_BOX.y1 - TAB_ROW_HALF - TAB_OUR_ROWS.at(-1);
  const ok = (centre, dy) => rowOk(py(centre + dy - TAB_ROW_HALF), py(centre + dy + TAB_ROW_HALF));
  for (let dy = low; dy <= high; dy += lineHeight) { const rows = TAB_OUR_ROWS.filter(centre => ok(centre, dy)).length; scored.push({ rows, total: rows + TAB_ENEMY_ROWS.filter(centre => centre + dy + TAB_ROW_HALF <= TAB_BOX.y1 && ok(centre, dy)).length, dy }); }
  // A window still passes when it only half covers the digits, so the best offset is the middle of the longest run at the top count.
  const top = Math.max(0, ...scored.map(item => item.total)); if (!top) return { rows: 0, dy: 0 };
  let run = [], longest = [];
  for (const item of scored) { if (item.total === top) run.push(item); else run = []; if (run.length > longest.length) longest = [...run]; }
  const best = longest[Math.floor(longest.length / 2)]; return { rows: best.rows, dy: best.dy };
}
function tabBoardRows(pixels, width, height) { return tabBoardFit(pixels, width, height).rows; }

// A TAB cell as Paddle and Tesseract like it: the grey crop contrast-stretched from the cell's median
// (the row) to its brightest pixel (the digits), bilinear-upscaled, dark on white. Also returns the
// glyph runs: a cell whose every glyph is narrow is all 1s, which PP-OCR tends to drop when alone.
function tabCellImage(pixels, width, height, box, scale = 6) {
  if (!pixels || pixels.length < width * height) return null;
  const px = value => (value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * width, py = value => (value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * height;
  const x0 = Math.max(0, px(box.x0)), x1 = Math.min(width - 2, px(box.x1)), y0 = Math.max(0, py(box.y0)), y1 = Math.min(height - 2, py(box.y1)); if (x1 <= x0 || y1 <= y0) return null;
  const values = []; for (let y = Math.floor(y0); y <= Math.ceil(y1); y += 1) for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) values.push(pixels[y * width + x]);
  values.sort((a, b) => a - b); const background = values[values.length >> 1], ink = values.at(-1); if (ink - background < 25) return null;
  const w = Math.round((x1 - x0) * scale), h = Math.round((y1 - y0) * scale), out = Buffer.alloc(w * h, 255), dark = new Uint8Array(w * h);
  for (let j = 0; j < h; j += 1) for (let i = 0; i < w; i += 1) {
    const sx = x0 + i / scale, sy = y0 + j / scale, ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy, at = (x, y) => pixels[y * width + x];
    const value = at(ix, iy) * (1 - fx) * (1 - fy) + at(ix + 1, iy) * fx * (1 - fy) + at(ix, iy + 1) * (1 - fx) * fy + at(ix + 1, iy + 1) * fx * fy;
    const t = Math.max(0, Math.min(1, (value - background) / (ink - background))); out[j * w + i] = Math.round(255 * (1 - t)); if (t > .5) dark[j * w + i] = 1;
  }
  const runs = []; for (let i = 0; i < w; i += 1) { let top = -1, bottom = -1; for (let j = 0; j < h; j += 1) if (dark[j * w + i]) { if (top < 0) top = j; bottom = j; } if (top < 0) continue; const run = runs.at(-1); if (run && i - run.end <= 1) { run.end = i; run.top = Math.min(run.top, top); run.bottom = Math.max(run.bottom, bottom); } else runs.push({ start: i, end: i, top, bottom }); }
  const tallest = Math.max(0, ...runs.map(run => run.bottom - run.top + 1)), glyphs = runs.filter(run => run.bottom - run.top + 1 >= tallest * .6);
  const image = { pixels: out, width: w, height: h, glyphs: glyphs.map(run => ({ width: run.end - run.start + 1, height: run.bottom - run.top + 1 })) };
  if (!glyphs.length) return image;
  // PP-OCR reads a lone digit only when the crop hugs it: a margin of a quarter glyph height around the runs.
  const margin = Math.round(tallest * .25), left = Math.max(0, glyphs[0].start - margin), right = Math.min(w - 1, glyphs.at(-1).end + margin), top = Math.max(0, Math.min(...glyphs.map(run => run.top)) - margin), bottom = Math.min(h - 1, Math.max(...glyphs.map(run => run.bottom)) + margin);
  const tightWidth = right - left + 1, tightHeight = bottom - top + 1, tight = Buffer.alloc(tightWidth * tightHeight);
  for (let j = 0; j < tightHeight; j += 1) out.copy(tight, j * tightWidth, (top + j) * w + left, (top + j) * w + right + 1);
  return { ...image, tight: { pixels: tight, width: tightWidth, height: tightHeight } };
}

// Where the digits of one of our rows actually sit: the weighted centre of the bright lines over the
// K/D/A columns near the expected row (the fitted offset is only good to a few pixels).
function tabRowCentre(pixels, width, height, centre) {
  const px = value => Math.round((value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * width), py = value => Math.round((value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * height);
  const x0 = Math.max(0, px(TAB_CELLS.kills.x0)), x1 = Math.min(width - 1, px(TAB_CELLS.assists.x1)); let weight = 0, sum = 0;
  for (let y = Math.max(0, py(centre - TAB_ROW_HALF)); y <= Math.min(height - 1, py(centre + TAB_ROW_HALF)); y += 1) {
    let total = 0; for (let x = x0; x <= x1; x += 1) total += pixels[y * width + x]; const mean = total / (x1 - x0 + 1);
    let count = 0; for (let x = x0; x <= x1; x += 1) if (pixels[y * width + x] > Math.max(mean + 40, 90)) count += 1; weight += count; sum += count * y;
  }
  return weight ? TAB_BOX.y0 + sum / weight / height * (TAB_BOX.y1 - TAB_BOX.y0) : centre;
}

// PP-OCRv4 digit reader for the TAB cells, loaded once from the build's own staged assets (the same
// ONNX Runtime WebAssembly and model the Settings "Number reader" uses). No network. Null when the
// assets are missing; the cells then fall back to Tesseract.
let paddleReaderPromise = null;
function paddleAssetsDir() {
  for (const candidate of [path.join(__dirname, '..', 'dist', 'ocr-assets'), path.join(__dirname, '..', 'public', 'ocr-assets')]) { const dir = unpackedExecutable(candidate); if (fs.existsSync(path.join(dir, 'onnx', 'ort.wasm.bundle.min.mjs')) && fs.existsSync(path.join(dir, 'paddle', 'ch_PP-OCRv4_rec_infer.onnx'))) return dir; }
  return null;
}
function paddleTensor(image, inputHeight = 48, padFraction = .25) {
  const pad = Math.max(1, Math.round(image.height * padFraction)), sourceWidth = image.width + pad * 2, sourceHeight = image.height + pad * 2;
  const sample = (x, y) => { const ix = x - pad, iy = y - pad; return ix < 0 || iy < 0 || ix >= image.width || iy >= image.height ? 255 : image.pixels[iy * image.width + ix]; };
  const height = inputHeight, width = Math.max(16, Math.round(sourceWidth * height / sourceHeight)), plane = width * height, tensor = new Float32Array(3 * plane);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y + .5) * sourceHeight / height - .5)), y0 = Math.floor(sy), y1 = Math.min(sourceHeight - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x + .5) * sourceWidth / width - .5)), x0 = Math.floor(sx), x1 = Math.min(sourceWidth - 1, x0 + 1), fx = sx - x0;
      const value = ((sample(x0, y0) * (1 - fx) + sample(x1, y0) * fx) * (1 - fy) + (sample(x0, y1) * (1 - fx) + sample(x1, y1) * fx) * fy) / 255 * 2 - 1;
      tensor[y * width + x] = value; tensor[plane + y * width + x] = value; tensor[2 * plane + y * width + x] = value;
    }
  }
  return { tensor, width, height };
}
// Greedy CTC over the blank and the ten digits only; confidence is the weakest emitted digit, mapped
// like lib/ocrEngines.ts (probability 0.75 -> 70, the K/D/A floor). A cell holds only digits, so each
// step's probability is taken among the blank and the digits, the letter o counting for 0: a lone 0
// otherwise loses most of its mass to it and never reaches the floor. A digit spread over several steps counts at its best step.
function decodePaddleDigits(data, steps, classes, characters) {
  const digits = characters.map((character, index) => /^[0-9]$/.test(character) ? index : -1).filter(index => index > 0), zero = characters.indexOf('0'), rounds = ['o', 'O'].map(character => characters.indexOf(character)).filter(index => index > 0); let text = '', previous = -1, low = Infinity, run = null;
  for (let step = 0; step < steps; step += 1) { const offset = step * classes; let best = 0, probability = Number(data[offset]), total = probability; for (const index of digits) { const value = Number(data[offset + index]) + (index === zero ? rounds.reduce((sum, round) => sum + Number(data[offset + round]), 0) : 0); total += value; if (value > probability) { probability = value; best = index; } } const share = total > 0 ? probability / total : 0; if (best !== 0 && best !== previous) { if (run !== null) low = Math.min(low, run); text += characters[best]; run = share; } else if (best !== 0) run = Math.max(run, share); previous = best; }
  if (run !== null) low = Math.min(low, run);
  if (!text) return { text, confidence: null }; const value = Math.max(0, Math.min(1, low));
  return { text, confidence: value <= .75 ? value / .75 * 70 : 70 + (value - .75) / .25 * 30 };
}
function loadPaddleDigitReader(log = line => void line) {
  paddleReaderPromise ||= (async () => {
    const dir = paddleAssetsDir(); if (!dir) { log('tab-board: PaddleOCR assets not found, cells read by Tesseract'); return null; }
    const imported = await import(require('node:url').pathToFileURL(path.join(dir, 'onnx', 'ort.wasm.bundle.min.mjs')).href); const ort = imported.default?.InferenceSession ? imported.default : imported;
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    const lines = fs.readFileSync(path.join(dir, 'paddle', 'ppocr_keys_v1.txt'), 'utf8').split(/\r?\n/); if (lines.at(-1) === '') lines.pop(); const characters = ['', ...lines, ' '];
    const session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(dir, 'paddle', 'ch_PP-OCRv4_rec_infer.onnx'))));
    return { async read(image) { const { tensor, width, height } = paddleTensor(image); const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, height, width]) }); const output = outputs[session.outputNames[0]]; return decodePaddleDigits(output.data, output.dims[1], output.dims[2], characters); } };
  })().catch(error => { log(`tab-board: PaddleOCR did not start (${String(error?.message || error).slice(0, 400)}), cells read by Tesseract`); return null; });
  return paddleReaderPromise;
}

/**
 * Read our five rows of each TAB board the coach opened: K, D and A each from its own cell (PP-OCR,
 * digits only on a crop hugging the glyphs, kept at confidence 70 or more or when Tesseract agrees; a cell
 * of narrow glyphs only is 1s), then the name cell
 * as text. A board counts when three of the five rows read all three numbers.
 * Returns [{ timestampMs, rows: [{ row, name, kills, deaths, assists }] }], oldest first.
 */
async function readCoachTabBoards(frames, worker, log = line => void line, limit = 12, digitReader = undefined) {
  const counts = { frames: (frames || []).length, looked: 0, tried: 0, boards: 0, cells: 0, cellsRead: 0, ones: 0 }; const boards = [];
  const chosen = [];
  for (const frame of frames || []) { const { rows, dy } = tabBoardFit(frame.pixels, frame.width, frame.height); if (rows >= 4) { counts.looked += 1; chosen.push({ frame, rows, dy }); } }
  // Best-looking frames first, at least 5 s apart (one tap gives several frames at 4 fps).
  const picked = []; for (const item of chosen.sort((a, b) => b.rows - a.rows)) { if (picked.length >= limit) break; if (picked.every(other => Math.abs(other.frame.timestampMs - item.frame.timestampMs) >= 5000)) picked.push(item); }
  const text = async image => String((await worker.recognize(pgm(image.pixels, image.width, image.height)))?.data?.text || '');
  const reader = digitReader === undefined ? (picked.length ? await loadPaddleDigitReader(log) : null) : digitReader;
  const readNumber = async image => {
    if (!image) return null; counts.cells += 1;
    if (image.glyphs.length && image.glyphs.length <= 2 && image.glyphs.every(glyph => glyph.width / glyph.height < .42)) { counts.ones += 1; counts.cellsRead += 1; return Number('1'.repeat(image.glyphs.length)); }
    let read = null;
    const crop = image.tight || image;
    if (reader) {
      const result = await reader.read(crop);
      // An unsure Paddle read stands only when Tesseract reads the same number; a blank one stays blank.
      if (/^\d{1,2}$/.test(result.text) && ((result.confidence ?? 0) >= 70 || (worker && (await text(crop)).trim() === result.text))) read = Number(result.text);
    } else if (worker) { const value = (await text(crop)).trim(); if (/^\d{1,2}$/.test(value)) read = Number(value); }
    if (read !== null && read <= 80) { counts.cellsRead += 1; return read; } return null;
  };
  try {
    if (picked.length && worker) {
      counts.tried = picked.length;
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
      for (const item of picked) {
        item.read = []; item.centres = [];
        for (const [row, measured] of TAB_OUR_ROWS.entries()) {
          const centre = tabRowCentre(item.frame.pixels, item.frame.width, item.frame.height, measured + item.dy); item.centres.push(centre); const values = {};
          for (const field of ['kills', 'deaths', 'assists']) values[field] = await readNumber(tabCellImage(item.frame.pixels, item.frame.width, item.frame.height, { x0: TAB_CELLS[field].x0, x1: TAB_CELLS[field].x1, y0: centre - .0105, y1: centre + .0105 }));
          item.read.push({ row, name: null, ...values });
        }
      }
      await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' });
      for (const item of picked) {
        if (item.read.filter(row => [row.kills, row.deaths, row.assists].every(Number.isInteger)).length < 3) continue;
        for (const row of item.read) { const crop = tabCellImage(item.frame.pixels, item.frame.width, item.frame.height, { ...TAB_CELLS.name, y0: item.centres[row.row] - .0105, y1: item.centres[row.row] + .0105 }, 4); row.name = crop ? (await text(crop)).trim().replace(/\s+/g, ' ') || null : null; }
        counts.boards += 1; boards.push({ timestampMs: item.frame.timestampMs, rows: item.read });
      }
    }
  } finally {
    if (picked.length && worker) await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '11' }).catch(() => {});
    log(`tab-board: frames ${counts.frames}, looked like a board ${counts.looked}, tried ${counts.tried}, boards read ${counts.boards}${boards.length ? `, last at ${Math.round(boards.at(-1).timestampMs / 1000)}s` : ''}; cells ${counts.cells}, numbers read ${counts.cellsRead} (${counts.ones} as 1s), reader ${reader ? 'paddle' : 'tesseract'}`);
  }
  return boards.sort((a, b) => a.timestampMs - b.timestampMs);
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
    const word = /allies|enemies|victory|defeat/i.test(snapshot?.text || ''); if (word) counts.anchorWord += 1;
    const crop = bannerDigitCrop(frame.pixels, frame.width, frame.height);
    // The end screen is a dark full-screen overlay; the words may have run into the scores, so the split is not required.
    const dark = (crop ? crop.background : medianGray(frame.pixels, frame.width, frame.height)) < 70; if (dark) counts.darkSplit += 1;
    if (word || dark) chosen.push({ frame, crop, snapshot, word });
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
          const read = await text(stretched); item.raw = { ...item.raw, [`line${mode}`]: read }; if (/allies|enemies|victory|defeat/i.test(read)) { item.word = true; item.line = BANNER_LINE.test(read) ? read : item.line; if (!item.anchored) { item.anchored = true; counts.anchorRead += 1; } }
        }
      }
      // The scores: each from its own crop, digits only; the whole middle only when it will not split.
      await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
      const reads = [];
      for (const item of tried) {
        // The page read already gave "n DEFEAT m" with the word agreeing: keep it, the score boxes belong to the other layout.
        if (/\d{1,2}\D{0,24}?\b(?:victory|defeat|draw)\b\D{0,24}?\d{1,2}/i.test(item.snapshot?.text || '')) continue;
        let left = null, right = null; const halves = item.crop ? splitDigitCrop(item.crop) : null; const raw = item.raw || {};
        const boxes = SCORE_BOXES.map(box => scoreBoxCrop(item.frame.pixels, item.frame.width, item.frame.height, box));
        if (boxes.every(Boolean)) { const reads = [await readScoreBox(boxes[0], text), await readScoreBox(boxes[1], text)]; raw.boxLeft = JSON.stringify(reads[0].raw); raw.boxRight = JSON.stringify(reads[1].raw); left = reads[0].value; right = reads[1].value; }
        if ((!left || !right) && halves) { raw.left = await text(halves[0]); raw.right = await text(halves[1]); left = raw.left.match(/\d{1,2}/)?.[0]; right = raw.right.match(/\d{1,2}/)?.[0]; }
        if ((!left || !right) && item.crop) { raw.middle = await text(item.crop); const match = raw.middle.match(/(\d{1,2})\D+(\d{1,2})/); if (match) [left, right] = [match[1], match[2]]; }
        // Every attempt's raw OCR text, so a miss shows which crop read what.
        log(`end-banner attempt ${Math.round(item.frame.timestampMs / 1000)}s: crop ${item.crop ? `${item.crop.width}x${item.crop.height}` : 'none'}, split ${halves ? halves.map(half => half.width).join('+') : 'none'}, boxes ${boxes.map(box => box ? box.glyphs.map(glyph => `${glyph.width}x${glyph.height}`).join('/') : 'empty').join(' + ')}, ${['line7', 'line6', 'boxLeft', 'boxRight', 'left', 'right', 'middle'].filter(key => key in raw).map(key => `${key} ${JSON.stringify(String(raw[key]).trim().slice(0, 60))}`).join(', ')}`);
        if ((!left || !right) && item.line) { const match = item.line.match(BANNER_LINE); [left, right] = [match[1], match[2]]; }
        // The result word, when one was read, must agree with the digits (a lone 7 read as 1 can still pass; a swapped side cannot).
        const outcome = /victory/i.test(`${item.snapshot?.text || ''} ${raw.line7 || ''} ${raw.line6 || ''}`) ? 1 : /defeat/i.test(`${item.snapshot?.text || ''} ${raw.line7 || ''} ${raw.line6 || ''}`) ? -1 : 0;
        if (left && right && outcome && Math.sign(Number(left) - Number(right)) !== outcome) continue;
        if (left && right) reads.push({ ...item, banner: `ALLIES ${Number(left)} - ${Number(right)} ENEMIES` });
      }
      // A frame that names a side stands alone. A dark split without a word could be any dark
      // scene, so it counts only when another frame read the same score: the end screen stays up.
      // A dark split also needs the words seen on some frame of this game: a lobby or loading screen is dark too.
      const named = tried.some(item => item.word);
      for (const item of reads) {
        if (!item.word && (!named || reads.filter(other => other.banner === item.banner).length < 2)) continue;
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

// Why a kill feed gave few kills: rows read, rows with two name-like words (a killer and a victim),
// rows naming one of our players, and what was credited. Counts only, never the names.
function killFeedSummary(snapshots, players, evidence) {
  const rows = (snapshots || []).flatMap(snapshot => String(snapshot.text || '').split(/[\r\n]+/).map(line => line.trim()).filter(Boolean));
  const twoNames = rows.filter(line => line.split(/\s+/).filter(word => /[a-z]{3,}/i.test(word)).length >= 2).length;
  const ours = players.filter(player => player.team === 'ours'); const naming = rows.filter(line => ours.some(player => nameAppears(line, player.name))).length;
  const eliminations = (evidence?.observations || []).filter(item => item.kind === 'elimination').length; const metrics = (evidence?.playerMetrics || []).filter(metric => metric.team === 'ours');
  return `kill-feed: frames ${(snapshots || []).length}, rows ${rows.length}, rows with two names ${twoNames}, rows naming ours ${naming}, eliminations ${eliminations}, our kills ${metrics.reduce((sum, metric) => sum + (metric.kills || 0), 0)}, our deaths ${metrics.reduce((sum, metric) => sum + (metric.deaths || 0), 0)}`;
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
      // Only the feed's own box (x 0.74-0.99, y 0.085-0.30; rows ~0.033 of the height apart), scaled ~3x at
      // 720p: in the old wide crop a 720p row's names were ~13 px tall, too small for Tesseract to read.
      { key: 'killFeedSnapshots', label: 'kill feed', fps: 2, crop: killFeedCrop(), width: 960, height: 464, threshold: .15, burstFrames: 3, maxCandidates: 3600, rows: true },
      { key: 'objectiveSnapshots', label: 'round and objective notices', fps: 1, crop: 'crop=iw*0.62:ih*0.34:iw*0.19:ih*0.02', width: 720, height: 222, threshold: .15, burstFrames: 2, maxCandidates: 1800 },
      { key: 'roundStateSnapshots', label: 'round state and score', fps: 1, crop: 'crop=iw*0.46:ih*0.20:iw*0.27:0', width: 700, height: 240, threshold: .10, burstFrames: 2, maxCandidates: 1800, everySeconds: 10 },
      { key: 'ultimateSnapshots', label: 'ultimate state', fps: 1, crop: 'crop=iw*0.28:ih*0.25:iw*0.36:ih*0.72', width: 520, height: 260, threshold: .12, burstFrames: 2, maxCandidates: 1800 },
      { key: 'povSnapshots', label: 'POV identity', fps: .25, crop: 'crop=iw*0.34:ih*0.28:0:ih*0.67', width: 560, height: 280, threshold: .08, burstFrames: 1, maxCandidates: 600 },
      { key: 'scoreboardSnapshots', label: 'scoreboard totals', fps: .2, crop: 'crop=iw*0.78:ih*0.72:iw*0.11:ih*0.14', width: 1100, height: 680, threshold: .12, burstFrames: 1, maxCandidates: 480 },
      // The custom-game end screen: one centred line "ALLIES n - m ENEMIES" that stays up for minutes.
      // It is static, so a change gate skips it: every 5 s is a candidate, one kept per time bucket.
      { key: 'tabBoardSnapshots', label: 'TAB board', fps: 4, rank: tabBoardRows, rankKeep: 4, crop: `crop=iw*${+(TAB_BOX.x1 - TAB_BOX.x0).toFixed(3)}:ih*${+(TAB_BOX.y1 - TAB_BOX.y0).toFixed(3)}:iw*${TAB_BOX.x0}:ih*${TAB_BOX.y0}`, width: TAB_FRAME.width, height: TAB_FRAME.height, threshold: .2, burstFrames: 1, maxCandidates: 240, ocr: false },
      { key: 'endBannerSnapshots', label: 'end screen', fps: .2, crop: 'crop=iw*0.70:ih*0.13:iw*0.15:ih*0.42', width: 980, height: 182, threshold: 0, burstFrames: 0, maxCandidates: 240 },
    ];
    const checkpointKey = crypto.createHash('sha256').update(JSON.stringify({ source: input.sourceSha256 || path.resolve(file), startMs: Number(input.startMs) || 0, endMs: Number(input.endMs) || null, players: input.players || [], observerMode: !!input.observerMode, povPlayerName: input.povPlayerName || null })).digest('hex');
    const saved = await readCheckpoint(options.checkpointFile); const checkpoint = saved?.schema === 'moetracker.vod-checkpoint/v1' && saved.key === checkpointKey ? saved : { schema: 'moetracker.vod-checkpoint/v1', key: checkpointKey, specs: {}, updatedAt: null };
    const performance = { ...normalizeVodPerformance(options.performance), singleDecode: options.performance?.singleDecode !== false }; const log = options.log || (() => {});
    const candidates = await sampleRegions(file, specs, probe.durationSeconds, progress, signal, { startMs: input.startMs, endMs: input.endMs }, performance, log);
    const total = specs.reduce((sum, spec) => sum + (spec.ocr === false ? 0 : candidates[spec.key].length), 0);
    const frameBytes = specs.reduce((sum, spec) => sum + candidates[spec.key].length * spec.width * spec.height, 0);
    const workerCount = resolveOcrWorkers(performance.ocrWorkers, { cpus: os.availableParallelism?.() || os.cpus().length, freeBytes: os.freemem(), frameBytes });
    progress?.({ stage: 'ocr', percent: 0, message: `Reading ${total} changed HUD frames locally${workerCount > 1 ? ` on ${workerCount} threads` : ''}…` }); log(`ocr: ${workerCount} worker${workerCount === 1 ? '' : 's'} (setting ${performance.ocrWorkers})`);
    const pool = await createOcrPool(workerCount, log);
    let offset = 0; const snapshots = {};
    try {
      for (const spec of specs) { if (spec.ocr === false) { snapshots[spec.key] = []; continue; } snapshots[spec.key] = await recognizeFrames(candidates[spec.key], spec, pool, progress, offset, total, signal, checkpoint.specs[spec.key], async state => { checkpoint.specs[spec.key] = state; checkpoint.updatedAt = new Date().toISOString(); await writeCheckpoint(options.checkpointFile, checkpoint); }); offset += candidates[spec.key].length; }
      const bannerSpec = specs.find(spec => spec.key === 'endBannerSnapshots');
      snapshots.endBannerSnapshots = await readBannerDigits(candidates.endBannerSnapshots.map(frame => ({ ...frame, width: bannerSpec.width, height: bannerSpec.height })), snapshots.endBannerSnapshots, pool.workers[0], log);
      const tabSpec = specs.find(spec => spec.key === 'tabBoardSnapshots');
      snapshots.tabBoards = tabSpec ? await readCoachTabBoards((candidates.tabBoardSnapshots || []).map(frame => ({ ...frame, width: tabSpec.width, height: tabSpec.height })), pool.workers[0], log) : [];
    }
    finally { await pool.terminate(); }
    // Comparison runs (scripts/vod-speed-compare.cjs) hash exactly what was sampled and read.
    options.inspect?.({ candidates, snapshots: structuredClone(snapshots), ocrWorkers: workerCount });
    if (Array.isArray(input.visualTemplates) && input.visualTemplates.length) for (const spec of specs) snapshots[spec.key] = applyVisualTemplates(snapshots[spec.key], input.visualTemplates);
    const rangeDurationMs = Number(input.endMs) > Number(input.startMs || 0) ? Number(input.endMs) - Number(input.startMs || 0) : probe.durationMs;
    const inferredPov = input.observerMode ? null : (input.povPlayerName || inferPovPlayer(snapshots.povSnapshots || [], input.players || []));
    const evidence = aggregateVideoEvidence({ players: input.players || [], povPlayerName: inferredPov || null, observerMode: !!input.observerMode, durationMs: rangeDurationMs, killFeedSnapshots: snapshots.killFeedSnapshots, objectiveSnapshots: snapshots.objectiveSnapshots, roundStateSnapshots: snapshots.roundStateSnapshots, ultimateSnapshots: snapshots.ultimateSnapshots, povSnapshots: snapshots.povSnapshots, scoreboardSnapshots: snapshots.scoreboardSnapshots, endBannerSnapshots: snapshots.endBannerSnapshots, tabBoards: snapshots.tabBoards || [] });
    log(killFeedSummary(snapshots.killFeedSnapshots, input.players || [], evidence));
    // Where the HUD reads stop: the last few top-centre reads that held any digit (score and timer text only).
    const hudTail = (snapshots.roundStateSnapshots || []).filter(item => /\d/.test(item.text || '')).slice(-6);
    log(`hud-tail: ${(snapshots.roundStateSnapshots || []).length} reads; ${hudTail.map(item => `${Math.round(item.timestampMs / 1000)}s ${JSON.stringify(String(item.text).replace(/[^0-9:\s\-]/g, '*').replace(/\s+/g, ' ').trim().slice(0, 24))}`).join(', ') || 'none with digits'}`);
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

module.exports = { tabBoardRows, tabBoardFit, tabCellImage, loadPaddleDigitReader, readCoachTabBoards, TAB_BOX, TAB_FRAME, TAB_OUR_ROWS, TAB_CELLS, killFeedSummary, createChangeCollector, readScoreBox, KILL_FEED_BOX, killFeedCrop, scoreBoxCrop, fixSevens, SCORE_BOXES, rowText, stretchedBanner, splitDigitCrop, bannerDigitCrop, readBannerDigits, sweepOrphanedVodDirectories, readOwnedVodFrame, readVodFrame, normalizeYoutubeUrl, youtubeVideoId, probeVideo, analyzeVodTimeline, normalizeTimelinePlayers, discoverVodGames, releaseVodSource, createReviewClips, changedFrames, changedFramesTogether, sampleRegions, recognizeFrames, createOcrPool, frameDifference, visualSignature, ensureDiskSpace, scoreboardGeometryScore, agentSelectGeometryScore, chooseGameBoundaries, inferPovPlayer };
