const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

// The window loads http://127.0.0.1:<port>. IndexedDB and localStorage belong to
// that origin, so the port must stay the same between launches or the page
// starts with empty browser storage (OCR learning, caches, switches) each time.
// The default sits below the Windows dynamic port range (49152+), which random
// ports come from.
const DEFAULT_LOCAL_PORT = 47615;

function isPortFree(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * The saved port first, then the default, then any free port. The caller saves
 * the result, so a fallback port becomes the stable one for later launches.
 */
async function chooseLocalPort({ saved, isFree = isPortFree, freePort }) {
  for (const candidate of [validPort(saved), DEFAULT_LOCAL_PORT]) {
    if (candidate && await isFree(candidate)) return candidate;
  }
  return freePort();
}

const ORIGIN_FOLDER = /^http_127\.0\.0\.1_(\d+)\.indexeddb\.leveldb$/;

/** Ports of earlier launches that left IndexedDB data behind and were not recovered yet. */
function strandedOriginPorts(folderNames, { currentPort, recovered = [] }) {
  const done = new Set(recovered.map(Number));
  const ports = [];
  for (const name of folderNames) {
    const port = validPort(ORIGIN_FOLDER.exec(String(name))?.[1]);
    if (port && port !== currentPort && !done.has(port) && !ports.includes(port)) ports.push(port);
  }
  return ports.sort((left, right) => left - right);
}

// Runs inside a hidden window at an old origin. It only reads: a database that
// does not exist is never opened, because opening would create it.
function strandedLearningPage(postPath) {
  return `<!doctype html><meta charset="utf-8"><script>
(async () => {
  const result = { learningEnabled: true, corrections: [], outcomes: [] };
  try { result.learningEnabled = localStorage.getItem('moetracker-ocr-learning-enabled') !== 'false'; } catch {}
  try {
    const names = (await indexedDB.databases()).map(entry => entry.name);
    if (names.includes('moetracker-ocr-learning')) {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('moetracker-ocr-learning'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      for (const store of ['corrections', 'outcomes']) {
        if (!db.objectStoreNames.contains(store)) continue;
        result[store] = await new Promise(resolve => { const request = db.transaction(store, 'readonly').objectStore(store).getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => resolve([]); });
      }
      db.close();
    }
  } catch (error) { result.error = String(error && error.message || error); }
  await fetch(${JSON.stringify(postPath)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(result) });
})();
</script>`;
}

const MAX_RECOVERY_BYTES = 64 * 1024 * 1024;

/**
 * Serves the read-only page on an old port and resolves with what the page
 * posts back. Requests without the one-time token are refused.
 */
function startStrandedOriginServer(port, { host = '127.0.0.1', token = crypto.randomBytes(16).toString('hex'), maxBytes = MAX_RECOVERY_BYTES } = {}) {
  const pagePath = `/__moe-recover-${token}`;
  const postPath = `${pagePath}/rows`;
  let settle;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === pagePath) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return response.end(strandedLearningPage(postPath));
    }
    if (request.method === 'POST' && request.url === postPath) {
      const chunks = []; let size = 0;
      request.on('data', chunk => { size += chunk.length; if (size > maxBytes) { request.destroy(); settle.reject(new Error('Recovered learning data is too large.')); } else chunks.push(chunk); });
      request.on('end', () => {
        response.writeHead(204).end();
        try { settle.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { settle.reject(error); }
      });
      return;
    }
    response.writeHead(404).end();
  });
  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ url: `http://${host}:${port}${pagePath}`, result, close: () => new Promise(done => server.close(() => done())) }));
  });
  return listening;
}

function rowsWithIds(rows) {
  return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && typeof row.id === 'string' && row.id) : [];
}

/**
 * One list from every old origin. Corrections from an origin where the coach
 * had switched learning off stay out; outcomes are kept, as the app records
 * them either way.
 */
function combineStrandedLearning(results) {
  const corrections = new Map(); const outcomes = new Map();
  // Results come newest origin first; the newest origin's switch is the
  // coach's latest choice.
  let learningEnabled = null;
  for (const result of results) {
    if (!result) continue;
    if (learningEnabled === null && typeof result.learningEnabled === 'boolean') learningEnabled = result.learningEnabled;
    if (result.learningEnabled !== false) for (const row of rowsWithIds(result.corrections)) if (!corrections.has(row.id)) corrections.set(row.id, row);
    for (const row of rowsWithIds(result.outcomes)) if (!outcomes.has(row.id)) outcomes.set(row.id, row);
  }
  return { learningEnabled, corrections: [...corrections.values()], outcomes: [...outcomes.values()] };
}

const NOTHING_RECOVERED = Object.freeze({ ports: [], learningEnabled: null, corrections: [], outcomes: [] });

/**
 * The main-process side of the one-time recovery. `listOrigins` gives the
 * IndexedDB folder names with their modified times; `openPage(url)` loads a
 * page in a hidden window and resolves with a function that closes it.
 */
function createStrandedLearningRecovery({ currentPort, config, saveConfig, listOrigins, openPage, isFree = isPortFree, startServer = startStrandedOriginServer, timeoutMs = 15_000, warn = () => {} }) {
  let pending = null; let offered = [];
  async function read() {
    // The current origin is live again; if the port ever changes, its rows
    // must be read like any other old origin's.
    const recovered = (config.recoveredLearningOrigins || []).map(Number);
    if (recovered.includes(currentPort)) { config.recoveredLearningOrigins = recovered.filter(port => port !== currentPort); await saveConfig(); }
    const folders = await listOrigins().catch(() => []);
    const modified = new Map();
    const ports = strandedOriginPorts(folders.map(folder => folder.name), { currentPort, recovered: config.recoveredLearningOrigins || [] });
    for (const folder of folders) { const port = Number(ORIGIN_FOLDER.exec(String(folder.name))?.[1]); if (port) modified.set(port, Number(folder.modifiedMs) || 0); }
    ports.sort((left, right) => (modified.get(right) || 0) - (modified.get(left) || 0));
    const results = []; const read = [];
    for (const port of ports) {
      if (!await isFree(port)) continue;
      let server; let close; let timer;
      try {
        server = await startServer(port);
        close = await openPage(server.url);
        const result = await Promise.race([server.result, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Timed out reading an old origin.')), timeoutMs); })]);
        if (result?.error) throw new Error(result.error);
        results.push(result); read.push(port);
      } catch (error) {
        warn(`port ${port}: ${error.message}`);
      } finally {
        clearTimeout(timer);
        await Promise.resolve(close?.()).catch(() => {});
        await server?.close();
      }
    }
    return { ports: read, ...combineStrandedLearning(results) };
  }
  return {
    start() { pending = read().catch(error => { warn(error.message); return NOTHING_RECOVERED; }); return pending; },
    async take() { const recovered = await (pending || NOTHING_RECOVERED); offered = recovered.ports; return recovered; },
    async confirm(ports) {
      const confirmed = (Array.isArray(ports) ? ports : []).map(Number).filter(port => offered.includes(port));
      config.recoveredLearningOrigins = [...new Set([...(config.recoveredLearningOrigins || []), ...confirmed])];
      await saveConfig();
      return { recorded: confirmed.length };
    },
  };
}

module.exports = { DEFAULT_LOCAL_PORT, MAX_RECOVERY_BYTES, isPortFree, chooseLocalPort, strandedOriginPorts, startStrandedOriginServer, combineStrandedLearning, createStrandedLearningRecovery };
