const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const TYPES = new Map([['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp']]);

function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function recordId(file, stat) {
  return crypto.createHash('sha256').update(`${path.resolve(file).toLowerCase()}\n${stat.size}\n${stat.mtimeMs}`).digest('hex');
}

async function readManifest(file) {
  return JSON.parse((await fsp.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

// Rounds the manifest asked for but does not list. Older captures could stop
// before an overtime tail and still be marked complete.
function missingRoundCount(manifest) {
  const requested = manifest.requestedRounds;
  if (!Number.isInteger(requested) || requested <= 0) return 0;
  const rounds = new Set((manifest.captures || []).filter(item => item?.kind === 'round' && Number.isInteger(item.round)).map(item => item.round));
  return Array.from({ length: requested }, (_, index) => index + 1).filter(round => !rounds.has(round)).length;
}

async function rootCandidates(folder) {
  const candidates = [];
  let entries = [];
  try { entries = await fsp.readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return candidates; throw error; }
  for (const entry of entries) {
    if (entry.isFile()) candidates.push({ file: path.resolve(folder, entry.name), name: entry.name, capture: null });
    if (entry.isDirectory() && /^Scrim-/.test(entry.name)) {
      const captureFolder = path.resolve(folder, entry.name); const manifestFile = path.join(captureFolder, 'capture-manifest.json');
      try {
        const manifest = await readManifest(manifestFile);
        if (manifest.status !== 'complete' || !Array.isArray(manifest.captures)) continue;
        const scoreboard = manifest.captures.find(item => item.kind === 'scoreboard');
        if (!scoreboard || typeof scoreboard.file !== 'string' || path.basename(scoreboard.file) !== scoreboard.file) continue;
        candidates.push({ file: path.join(captureFolder, scoreboard.file), name: `${entry.name}/${scoreboard.file}`, capture: { captureId: String(manifest.captureId || entry.name), template: manifest.template, requestedRounds: manifest.requestedRounds, missingRounds: missingRoundCount(manifest), folder: captureFolder } });
      } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    }
  }
  return candidates;
}

async function scoreboardInventory(folder, processedIds = [], processedHashes = []) {
  const processed = new Set(processedIds);
  const hashes = new Set(processedHashes);
  const records = [];
  for (const candidate of await rootCandidates(folder)) {
    const mediaType = TYPES.get(path.extname(candidate.file).toLowerCase());
    if (!mediaType) continue;
    const file = candidate.file; const stat = await fsp.stat(file).catch(() => null);
    if (!stat) continue;
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) continue;
    const id = recordId(file, stat); if (processed.has(id)) continue;
    let imageSha256 = null;
    if (hashes.size) {
      const bytes = await fsp.readFile(file); imageSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      if (hashes.has(imageSha256)) continue;
    }
    records.push({ id, imageSha256, name: candidate.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mediaType, file, capture: candidate.capture });
  }
  return records.sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt));
}

async function readScoreboardRecord(record) {
  const bytes = await fsp.readFile(record.file);
  if (bytes.length !== record.size || imageType(bytes) !== record.mediaType) throw new Error('The scoreboard image changed or its contents do not match its file type.');
  const imageSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (record.imageSha256 && record.imageSha256 !== imageSha256) throw new Error('The scoreboard image changed after it entered the inbox.');
  return { id: record.id, imageSha256, name: record.name, mediaType: record.mediaType, bytes };
}

async function readCaptureSession(record) {
  if (!record?.capture?.folder) throw new Error('This scoreboard does not belong to a capture session.');
  const folder = path.resolve(record.capture.folder);
  if (path.dirname(path.resolve(record.file)) !== folder) throw new Error('The scoreboard is outside its capture session.');
  const manifest = await readManifest(path.join(folder, 'capture-manifest.json'));
  if (manifest.status !== 'complete' || !Array.isArray(manifest.captures)) throw new Error('The capture session is not complete.');
  if (String(manifest.captureId || path.basename(folder)) !== String(record.capture.captureId)) throw new Error('The capture session identity changed.');
  const captures = [];
  const seen = new Set();
  const allowedKinds = new Set(['scoreboard', 'performance', 'head-to-head', 'round']);
  for (const item of manifest.captures) {
    const name = typeof item?.file === 'string' ? item.file : '';
    if (!name || path.basename(name) !== name || seen.has(name.toLocaleLowerCase())) throw new Error('The capture manifest contains an unsafe or duplicate filename.');
    if (!allowedKinds.has(item.kind) || (item.kind === 'round' && (!Number.isInteger(item.round) || item.round < 1))) throw new Error('The capture manifest contains an invalid capture entry.');
    seen.add(name.toLocaleLowerCase());
    const mediaType = TYPES.get(path.extname(name).toLowerCase());
    if (!mediaType) throw new Error(`The capture manifest references an unsupported image: ${name}`);
    const file = path.resolve(folder, name);
    if (path.dirname(file) !== folder) throw new Error('A capture image is outside its session folder.');
    const stat = await fsp.lstat(file).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) throw new Error(`A capture image is missing or too large: ${name}`);
    const bytes = await fsp.readFile(file);
    if (bytes.length !== stat.size || imageType(bytes) !== mediaType) throw new Error(`A capture image changed or does not match its file type: ${name}`);
    captures.push({ kind: String(item.kind || ''), ...(Number.isInteger(item.round) ? { round: item.round } : {}), file: name, mediaType, bytes });
  }
  if (!captures.some(item => item.kind === 'scoreboard' && path.resolve(folder, item.file) === path.resolve(record.file))) throw new Error('The session no longer contains its scoreboard.');
  if (Number.isInteger(manifest.requestedRounds) && manifest.requestedRounds > 0) {
    const rounds = new Set(captures.filter(item => item.kind === 'round').map(item => item.round));
    if (rounds.size !== manifest.requestedRounds || !Array.from({ length: manifest.requestedRounds }, (_, index) => index + 1).every(round => rounds.has(round))) throw new Error('The capture session does not contain every requested round.');
  }
  return { manifest, captures };
}

module.exports = { MAX_IMAGE_BYTES, imageType, missingRoundCount, scoreboardInventory, readScoreboardRecord, readCaptureSession };
