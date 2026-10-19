const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { aggregateVideoEvidence } = require('./vod-timeline-evidence.cjs');

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

async function recognizeBoundaryMaps(boundaries, mapNames, progress, signal) {
  if (!boundaries.length) return [];
  const known = [...new Set((mapNames || []).map(name => String(name || '').trim()).filter(Boolean))];
  if (!known.length) return boundaries.map(item => ({ ...item, map: null }));
  const sharp = require('sharp'); const { createWorker, PSM } = require('tesseract.js');
  const langPath = path.dirname(unpackedExecutable(require.resolve('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz'))); const worker = await createWorker('eng', undefined, { langPath });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT }); const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); const output = [];
  try {
    for (let index = 0; index < boundaries.length; index += 1) {
      const item = boundaries[index];
      throwIfAborted(signal); const crop = await sharp(item.path).extract({ left: 0, top: 0, width: 760, height: 760 }).resize({ width: 1520 }).grayscale().normalize().png().toBuffer(); const result = await worker.recognize(crop); const text = normalized(result.data?.text); const map = known.find(name => text.includes(normalized(name))) || null; output.push({ ...item, map });
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
  const signal = options.signal; throwIfAborted(signal); const cacheId = crypto.randomUUID(); const directory = path.join(workRoot, `source-${cacheId}`); await fsp.mkdir(directory, { recursive: true });
  try {
    const downloaded = !input.localPath; const file = input.localPath ? path.resolve(String(input.localPath)) : await downloadYoutube(input.vodUrl, directory, progress, signal);
    const probe = await probeVideo(file, signal); const candidates = await sampleScoreboardCandidates(file, probe.durationSeconds, progress, signal, input.expectedGames); const games = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const target = path.join(directory, `scoreboard-${String(index + 1).padStart(2, '0')}.png`); await extractFrame(file, candidates[index].timestampMs, target, signal);
      games.push({ timestampMs: candidates[index].timestampMs, score: candidates[index].score, agentSelectScore: candidates[index].agentSelectScore, path: target, mediaType: 'image/png', base64: (await fsp.readFile(target)).toString('base64') });
      progress?.({ stage: 'discover', percent: Math.round((index + 1) / Math.max(1, candidates.length) * 100), message: `Preparing scoreboard candidates · ${index + 1}/${candidates.length}` });
    }
    let uploadDate = null; let uploader = null; if (downloaded) { const infoPath = path.join(directory, `${youtubeVideoId(input.vodUrl)}.info.json`); const info = JSON.parse(await fsp.readFile(infoPath, 'utf8').catch(() => '{}')); if (/^\d{8}$/.test(String(info.upload_date || ''))) uploadDate = `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`; uploader = String(info.uploader || info.channel || '').trim().slice(0, 100) || null; }
    const boundaryCandidates = chooseGameBoundaries(games, probe.durationMs, input.expectedGames); const requestedBoundaryCount = Math.max(1, Math.min(12, Number(input.expectedGames) || 1));
    if (boundaryCandidates.length === requestedBoundaryCount - 1 && boundaryCandidates[0]?.timestampMs > 10 * 60_000) {
      const target = path.join(directory, 'game-start-00.png'); await extractFrame(file, 0, target, signal); boundaryCandidates.unshift({ timestampMs: 0, score: 0, agentSelectScore: 0, path: target, mediaType: 'image/png', base64: (await fsp.readFile(target)).toString('base64') });
    }
    const recognizedBoundaries = await recognizeBoundaryMaps(boundaryCandidates, input.mapNames, progress, signal);
    const boundaries = recognizedBoundaries.map(({ path: _path, ...item }) => item); const publicGames = games.map(({ path: _path, ...item }) => item);
    const sourceSha256 = await sha256File(file); const vodUrl = input.vodUrl ? normalizeYoutubeUrl(input.vodUrl) : `moetracker-local://sha256/${sourceSha256}`;
    return { cacheId, directory, file, downloaded, uploadDate, uploader, vodUrl, videoId: youtubeVideoId(input.vodUrl), sourceSha256, durationMs: probe.durationMs, width: probe.width, height: probe.height, games: publicGames, boundaries };
  } catch (error) { await fsp.rm(directory, { recursive: true, force: true }).catch(() => {}); throw error; }
}

function frameDifference(left, right) {
  if (!left || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let total = 0; let count = 0;
  for (let index = 0; index < left.length; index += 24) { total += Math.abs(left[index] - right[index]); count += 1; }
  return count ? total / count : 0;
}

async function changedFrames(file, spec, durationSeconds, progress, signal, range = {}) {
  throwIfAborted(signal);
  const frameBytes = spec.width * spec.height; const fps = spec.fps; const buckets = new Map(); let previous = null; let pending = Buffer.alloc(0); let index = 0;
  const filter = `fps=${fps},${spec.crop},scale=${spec.width}:${spec.height}:flags=fast_bilinear,format=gray`;
  const startSeconds = Math.max(0, Number(range.startMs || 0) / 1000); const endSeconds = Number(range.endMs) > Number(range.startMs || 0) ? Number(range.endMs) / 1000 : null; const sampledDuration = endSeconds ? endSeconds - startSeconds : durationSeconds;
  const args = ['-hide_banner', '-loglevel', 'error', ...(startSeconds ? ['-ss', String(startSeconds)] : []), '-i', file, ...(endSeconds ? ['-t', String(sampledDuration)] : []), '-an', '-vf', filter, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'];
  const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const onAbort = () => child.kill(); signal?.addEventListener('abort', onAbort, { once: true });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= frameBytes) {
      throwIfAborted(signal);
      const frame = Buffer.from(pending.subarray(0, frameBytes)); pending = pending.subarray(frameBytes); const timestampMs = Math.round(startSeconds * 1000 + index / fps * 1000); index += 1;
      const difference = frameDifference(previous, frame); const changed = difference >= spec.threshold;
      if (changed) {
        const bucket = Math.min(spec.maxCandidates - 1, Math.floor(timestampMs / Math.max(1, durationSeconds * 1000) * spec.maxCandidates)); const existing = buckets.get(bucket);
        if (!existing || difference > existing.difference) buckets.set(bucket, { timestampMs, pixels: frame, difference });
      }
      previous = frame;
      if (index % 100 === 0) progress?.({ stage: 'sampling', percent: Math.min(99, Math.round((timestampMs / 1000 - startSeconds) / Math.max(1, sampledDuration) * 100)), message: `Sampling ${spec.label} across the selected game…` });
    }
  }
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); signal?.removeEventListener('abort', onAbort); throwIfAborted(signal);
  if (code !== 0) throw new Error(stderr.trim() || 'FFmpeg could not sample the VOD.');
  return [...buckets.values()].sort((a, b) => a.timestampMs - b.timestampMs).map(({ difference: _difference, ...frame }) => frame);
}

function pgm(frame, width, height) { return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), frame]); }

async function recognizeFrames(frames, spec, worker, progress, offset, total, signal) {
  const snapshots = [];
  for (let index = 0; index < frames.length; index += 1) {
    throwIfAborted(signal);
    const result = await worker.recognize(pgm(frames[index].pixels, spec.width, spec.height)); const text = String(result.data?.text || '').trim(); const confidence = Number(result.data?.confidence);
    if (text) snapshots.push({ timestampMs: frames[index].timestampMs, text, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence / 100)) : null });
    progress?.({ stage: 'ocr', percent: Math.round((offset + index + 1) / Math.max(1, total) * 100), message: `Reading timeline evidence · ${offset + index + 1}/${total}` });
  }
  return snapshots;
}

function inferPovPlayer(snapshots, players) {
  const counts = players.map(player => ({ name: player.name, count: snapshots.filter(snapshot => {
    const normalized = String(snapshot.text || '').toLowerCase().replace(/[^a-z0-9]/g, ''); const needle = String(player.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return needle.length >= 3 && normalized.includes(needle);
  }).length })).sort((a, b) => b.count - a.count);
  if (!counts[0] || counts[0].count < 3 || (counts[1] && counts[0].count < counts[1].count * 2)) return null;
  return counts[0].name;
}

async function analyzeVodTimeline(input, options = {}) {
  const progress = options.progress; const workRoot = options.workRoot || path.join(require('node:os').tmpdir(), 'moetracker-vod');
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
      { key: 'killFeedSnapshots', label: 'kill feed', fps: .5, crop: 'crop=iw*0.42:ih*0.38:iw*0.58:0', width: 720, height: 366, threshold: .15, maxCandidates: 2400 },
      { key: 'objectiveSnapshots', label: 'round and objective notices', fps: .4, crop: 'crop=iw*0.62:ih*0.34:iw*0.19:ih*0.02', width: 720, height: 222, threshold: .15, maxCandidates: 1200 },
      { key: 'ultimateSnapshots', label: 'ultimate state', fps: .5, crop: 'crop=iw*0.28:ih*0.25:iw*0.36:ih*0.72', width: 520, height: 260, threshold: .15, maxCandidates: 1200 },
      { key: 'povSnapshots', label: 'POV identity', fps: .1, crop: 'crop=iw*0.34:ih*0.28:0:ih*0.67', width: 560, height: 280, threshold: .08, maxCandidates: 240 },
    ];
    const candidates = {};
    for (const spec of specs) candidates[spec.key] = await changedFrames(file, spec, probe.durationSeconds, progress, signal, { startMs: input.startMs, endMs: input.endMs });
    const total = specs.reduce((sum, spec) => sum + candidates[spec.key].length, 0); progress?.({ stage: 'ocr', percent: 0, message: `Reading ${total} changed HUD frames locally…` });
    const { createWorker, PSM } = require('tesseract.js');
    const langPath = path.dirname(unpackedExecutable(require.resolve('@tesseract.js-data/eng/4.0.0/eng.traineddata.gz')));
    const worker = await createWorker('eng', undefined, { langPath }); await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    let offset = 0; const snapshots = {};
    try { for (const spec of specs) { snapshots[spec.key] = await recognizeFrames(candidates[spec.key], spec, worker, progress, offset, total, signal); offset += candidates[spec.key].length; } }
    finally { await worker.terminate(); }
    const rangeDurationMs = Number(input.endMs) > Number(input.startMs || 0) ? Number(input.endMs) - Number(input.startMs || 0) : probe.durationMs;
    const inferredPov = input.observerMode ? null : (input.povPlayerName || inferPovPlayer(snapshots.povSnapshots || [], input.players || []));
    const evidence = aggregateVideoEvidence({ players: input.players || [], povPlayerName: inferredPov || null, durationMs: rangeDurationMs, killFeedSnapshots: snapshots.killFeedSnapshots, objectiveSnapshots: snapshots.objectiveSnapshots, ultimateSnapshots: snapshots.ultimateSnapshots });
    evidence.limitations.push(inferredPov ? `POV identity used for personal orb and ultimate evidence: ${inferredPov}.` : 'No single player POV identity was proven; personal orb and ultimate totals remain unknown.');
    evidence.source = { kind: input.sourceKind || (downloaded ? 'youtube' : 'local-file'), videoId: input.videoId || youtubeVideoId(input.vodUrl), sha256: input.sourceSha256 || await sha256File(file), width: probe.width, height: probe.height, durationMs: probe.durationMs, analyzedAt: new Date().toISOString() };
    progress?.({ stage: 'complete', percent: 100, message: `Timeline scan complete · ${evidence.observations.length} supported observations.` }); return evidence;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', externalAbort); await fsp.rm(jobDirectory, { recursive: true, force: true }).catch(() => {}); }
}

module.exports = { normalizeYoutubeUrl, youtubeVideoId, probeVideo, analyzeVodTimeline, discoverVodGames, changedFrames, frameDifference, ensureDiskSpace, scoreboardGeometryScore, agentSelectGeometryScore, chooseGameBoundaries, inferPovPlayer };
