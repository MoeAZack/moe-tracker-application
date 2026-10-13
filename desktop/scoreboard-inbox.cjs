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

async function scoreboardInventory(folder, processedIds = []) {
  const processed = new Set(processedIds);
  const records = [];
  let entries = [];
  try { entries = await fsp.readdir(folder, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  for (const entry of entries) {
    const mediaType = TYPES.get(path.extname(entry.name).toLowerCase());
    if (!entry.isFile() || !mediaType) continue;
    const file = path.resolve(folder, entry.name); const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_IMAGE_BYTES) continue;
    const id = recordId(file, stat); if (processed.has(id)) continue;
    records.push({ id, name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), mediaType, file });
  }
  return records.sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt));
}

async function readScoreboardRecord(record) {
  const bytes = await fsp.readFile(record.file);
  if (bytes.length !== record.size || imageType(bytes) !== record.mediaType) throw new Error('The scoreboard image changed or its contents do not match its file type.');
  return { id: record.id, name: record.name, mediaType: record.mediaType, bytes };
}

module.exports = { MAX_IMAGE_BYTES, imageType, scoreboardInventory, readScoreboardRecord };
