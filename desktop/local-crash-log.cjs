const fsp = require('node:fs/promises');
const path = require('node:path');

const LOG_FILE = 'crash-events.ndjson';
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 3;
let writeQueue = Promise.resolve();

function text(value, limit) {
  return String(value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit);
}

function serializeError(error) {
  if (error instanceof Error) return { name: text(error.name, 100), message: text(error.message, 4_000), stack: text(error.stack, 12_000) };
  return { name: 'Error', message: text(error, 4_000), stack: '' };
}

async function rotate(file, maxBytes, maxFiles) {
  const stat = await fsp.stat(file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!stat || stat.size < maxBytes) return;
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = index === 1 ? file : `${file}.${index}`;
    const target = `${file}.${index + 1}`;
    await fsp.rm(target, { force: true });
    await fsp.rename(source, target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function appendLocalCrashEvent(logDirectory, type, error, details = {}, options = {}) {
  const task = async () => {
    await fsp.mkdir(logDirectory, { recursive: true });
    const file = path.join(logDirectory, LOG_FILE);
    await rotate(file, options.maxBytes || DEFAULT_MAX_BYTES, options.maxFiles || DEFAULT_MAX_FILES);
    const event = { timestamp: new Date().toISOString(), type: text(type, 100), error: serializeError(error), details };
    await fsp.appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    return file;
  };
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

module.exports = { LOG_FILE, appendLocalCrashEvent, serializeError };
