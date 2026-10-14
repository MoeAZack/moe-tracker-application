const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const table = Array.from({ length: 256 }, (_, value) => {
  let crc = value; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1); return crc >>> 0;
});
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function dosDateTime(date = new Date()) { const year = Math.max(1980, date.getFullYear()); return { date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(), time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2) }; }

function zip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8'); const raw = Buffer.from(entry.bytes); const compressed = zlib.deflateRawSync(raw, { level: 6 }); const crc = crc32(raw); const stamp = dosDateTime(entry.modifiedAt);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(stamp.time, 10); header.writeUInt16LE(stamp.date, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    local.push(header, name, compressed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x0800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(stamp.time, 12); directory.writeUInt16LE(stamp.date, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42); central.push(directory, name); offset += header.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...local, centralBytes, end]);
}

async function filesIn(directory, prefix, filter = () => true) {
  const result = []; let items = [];
  try { items = await fsp.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return result; throw error; }
  for (const item of items) if (item.isFile() && filter(item.name)) { const file = path.join(directory, item.name); const stat = await fsp.stat(file); result.push({ name: `${prefix}/${item.name}`, bytes: await fsp.readFile(file), modifiedAt: stat.mtime }); }
  return result;
}

async function newestCaptureFolder(roots, preferredCaptureId) {
  const candidates = [];
  for (const root of roots) {
    let items = []; try { items = await fsp.readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const item of items) if (item.isDirectory() && /^Scrim-/.test(item.name)) { const folder = path.join(root, item.name); const stat = await fsp.stat(folder); candidates.push({ folder, name: item.name, modifiedAt: stat.mtimeMs }); }
  }
  if (preferredCaptureId) {
    const expectedName = String(preferredCaptureId).startsWith('Scrim-') ? String(preferredCaptureId) : `Scrim-${preferredCaptureId}`;
    const preferred = candidates.find(item => item.name === expectedName);
    if (preferred) return preferred.folder;
  }
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.folder || null;
}

async function captureDiagnosticLogs(options) {
  const files = new Set();
  if (options.scrimCaptureLog) files.add(path.resolve(options.scrimCaptureLog));
  for (const root of options.captureRoots || []) files.add(path.join(path.dirname(path.resolve(root)), 'scrim-capture-last-run.log'));
  const entries = []; let preferredCaptureId = options.captureId || null;
  for (const file of files) {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    const bytes = await fsp.readFile(file);
    entries.push({ name: 'logs/scrim-capture-last-run.log', bytes, modifiedAt: stat.mtime });
    if (!preferredCaptureId) {
      const matches = bytes.toString('utf8').match(/Scrim-(\d{8}-\d{6})/g);
      if (matches?.length) preferredCaptureId = matches[matches.length - 1].slice('Scrim-'.length);
    }
    break;
  }
  return { entries, preferredCaptureId };
}

async function createSupportBundle(options) {
  const entries = [{ name: 'support-summary.json', bytes: Buffer.from(JSON.stringify(options.summary, null, 2)), modifiedAt: new Date() }];
  entries.push(...await filesIn(options.logs, 'logs', name => /^crash-events\.ndjson(?:\.\d+)?$/.test(name)));
  const diagnostic = await captureDiagnosticLogs(options); entries.push(...diagnostic.entries);
  const capture = await newestCaptureFolder(options.captureRoots || [], diagnostic.preferredCaptureId);
  if (capture) entries.push(...await filesIn(capture, 'latest-capture', name => /^(capture-manifest\.json|scoreboard\.png|performance\.png|head-to-head\.png|round-\d+\.png)$/i.test(name)));
  await fsp.mkdir(path.dirname(options.target), { recursive: true }); await fsp.writeFile(options.target, zip(entries));
  return { path: options.target, fileCount: entries.length, includedCapture: !!capture };
}

module.exports = { createSupportBundle, zip };
