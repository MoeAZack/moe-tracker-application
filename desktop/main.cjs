const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, shell, Tray } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { evidenceCandidates } = require('./evidence-handoff.cjs');
const { scoreboardInventory, readScoreboardRecord, readCaptureSession } = require('./scoreboard-inbox.cjs');
const { MAX_ENVELOPE_BYTES, encryptPortablePackage, decryptPortablePackage } = require('./portable-crypto.cjs');
const { appendLocalCrashEvent } = require('./local-crash-log.cjs');
const { createUpdateController } = require('./update-controller.cjs');
const { createUpdateHealth } = require('./update-health.cjs');
const { createSupportBundle } = require('./support-bundle.cjs');
const { resolveReplayRuntime } = require('./replay-runtime.cjs');
const { collectChildOutput, collectJson } = require('./collector-command.cjs');
const { canonical, refreshScreenshotOutboxFromData } = require('./sync-outbox.cjs');
const { hasRecentRecoveryBackup } = require('./recovery-backup.cjs');
const { isTrustedSenderUrl, sessionIsFresh } = require('./session-security.cjs');
const { loginCredentials } = require('./session-credentials.cjs');
const { analyzeVodTimeline } = require('./vod-timeline-analyzer.cjs');

let mainWindow;
let tray;
let serverProcess;
let collectorProcess;
let collectorImportPromise;
let collectorImportTimer;
let syncTimer;
let syncPromise;
let captureInboxTimer;
let backupTimer;
let lastNotifiedCaptureId = null;
let captureActivity = null;
let syncStateMutation = Promise.resolve();
let runtime;
let updateController;
let quitting = false;
const approvedVodPaths = new Set();

// Keep Windows taskbar/notification identity aligned with the owl-branded
// executable instead of inheriting an older Electron/VALORANT-style cache.
if (process.platform === 'win32') app.setAppUserModelId('com.moezack.moetracker.owl');

const json = async (file, fallback = null) => {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};

async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temp, file);
}

function applicationRoot() {
  return app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
}
function applicationCodeRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function appPaths() {
  const documentsRoot = process.env.MOETRACKER_DOCUMENTS_ROOT
    ? path.resolve(process.env.MOETRACKER_DOCUMENTS_ROOT)
    : app.getPath('documents');
  const documents = path.join(documentsRoot, 'Moe Tracker');
  const local = path.join(app.getPath('userData'), 'Local Workspace');
  return {
    local,
    database: path.join(local, 'data', 'db.json'),
    config: path.join(local, 'desktop-config.json'),
    syncState: path.join(local, 'sync-state.json'),
    replays: path.join(documents, 'Replays'),
    screenshots: path.join(documents, 'Scoreboards'),
    exports: path.join(documents, 'Exports'),
    backups: path.join(local, 'Backups'),
    logs: path.join(local, 'Logs'),
    valorantReplays: path.join(process.env.LOCALAPPDATA || '', 'VALORANT', 'Saved', 'Demos'),
    collector: path.join(process.env.LOCALAPPDATA || '', 'MoeTracker', 'ReplayCollector'),
  };
}

// backupKey encrypts automatic recovery backups (AES-256-GCM in the local service).
const CONFIG_SECRETS = [['adminPassword', 'adminCredential', 32], ['jwtSecret', 'jwtCredential', 48], ['backupKey', 'backupKeyCredential', 32]];
function protectConfigSecrets(config) {
  if (!safeStorage.isEncryptionAvailable()) return config;
  for (const [plain, encrypted, bytes] of CONFIG_SECRETS) {
    if (!config[plain] && config[encrypted]) config[plain] = safeStorage.decryptString(Buffer.from(config[encrypted], 'base64'));
    if (!config[plain]) config[plain] = crypto.randomBytes(bytes).toString('base64url');
    if (!config[encrypted]) config[encrypted] = safeStorage.encryptString(config[plain]).toString('base64');
  }
  return config;
}
function persistedConfig(config) {
  const copy = { ...config };
  if (safeStorage.isEncryptionAvailable()) for (const [plain] of CONFIG_SECRETS) delete copy[plain];
  return copy;
}
async function saveRuntimeConfig() { await atomicJson(runtime.paths.config, persistedConfig(runtime.config)); }

async function ensureRuntime() {
  const paths = appPaths();
  await Promise.all(Object.values({ local: paths.local, logs: paths.logs, replays: paths.replays, screenshots: paths.screenshots, exports: paths.exports, backups: paths.backups }).map(folder => fsp.mkdir(folder, { recursive: true })));
  let config = await json(paths.config, null);
  if (!config) {
    config = {
      schemaVersion: 1,
      deviceId: `desktop-${crypto.randomUUID()}`,
      deviceName: require('node:os').hostname(),
      role: 'coach',
      retentionDays: 30,
      mode: 'offline-first',
      cloudUrl: 'https://moetracker-site.pages.dev',
      extraReplayFolders: [],
      capturePaused: false,
      capturePreferences: { profile: 'fullscreen-windowed', display: 'primary', notification: 'open-review', offlineQueue: true },
      createdAt: new Date().toISOString(),
    };
  }
  protectConfigSecrets(config);
  config.capturePaused = config.capturePaused === true;
  config.capturePreferences = { profile: 'fullscreen-windowed', display: 'primary', notification: 'open-review', offlineQueue: true, ...(config.capturePreferences || {}) };
  if (!config.deviceId) {
    config.deviceId = `desktop-${crypto.randomUUID()}`;
  }
  await atomicJson(paths.config, persistedConfig(config));
  if (!await json(paths.syncState, null)) await atomicJson(paths.syncState, { schemaVersion: 1, outbox: [], inbox: [], completed: [] });
  runtime = { paths, config, port: await freePort(), session: null, coachSession: null };
  return runtime;
}

function crashLogDirectory() {
  return runtime?.paths.logs || path.join(app.getPath('userData'), 'Local Workspace', 'Logs');
}

function scoreboardRoots() {
  return [runtime.paths.screenshots, path.join(process.env.LOCALAPPDATA || '', 'MoeTracker', 'Scoreboards')];
}

async function allPendingScoreboards() {
  const lists = await Promise.all(scoreboardRoots().map(root => scoreboardInventory(root, runtime.config.processedScoreboardIds || [], runtime.config.processedScoreboardHashes || [])));
  return lists.flat().sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt));
}

function recordLocalCrash(type, error, details = {}) {
  return appendLocalCrashEvent(crashLogDirectory(), type, error, details).catch(logError => console.error(`[crash-log] ${logError.message}`));
}

function applyLoginPreference() {
  if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!runtime.config.startWithWindows, path: process.execPath, args: ['--hidden'] });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const address = server.address(); server.close(() => resolve(address.port)); });
  });
}

function runNode(entry, args = [], options = {}) {
  return spawn(process.execPath, [entry, ...args], {
    cwd: applicationRoot(),
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...options.env },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function waitForHealth(port, timeoutMs = 20_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${port}/api/health`, response => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      });
      request.on('error', retry);
      request.setTimeout(1000, () => request.destroy());
    };
    const retry = () => Date.now() - started > timeoutMs ? reject(new Error('The local Moe Tracker service did not start.')) : setTimeout(attempt, 250);
    attempt();
  });
}

async function startLocalServer() {
  const entry = path.join(applicationCodeRoot(), 'build', 'server.cjs');
  const integrationEnvironment = {};
  if (safeStorage.isEncryptionAvailable()) {
    for (const [key, encrypted] of Object.entries(runtime.config.integrationSecrets || {})) {
      try { integrationEnvironment[key] = safeStorage.decryptString(Buffer.from(String(encrypted), 'base64')); }
      catch (error) { void recordLocalCrash('local-integration-secret-decrypt-failed', error, { key }); }
    }
  }
  const child = runNode(entry, [], { env: {
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(runtime.port),
    DB_PATH: runtime.paths.database,
    PRIVATE_BACKUP_DIR: runtime.paths.backups,
    ...(runtime.config.backupKey ? { PRIVATE_BACKUP_KEY: runtime.config.backupKey } : {}),
    PRIVATE_BACKUP_KEEP: '14',
    ADMIN_PASSWORD: runtime.config.adminPassword,
    JWT_SECRET: runtime.config.jwtSecret,
    APP_DESKTOP: 'true',
    ...integrationEnvironment,
  }});
  serverProcess = child;
  child.stderr.on('data', value => console.error(`[local-service] ${String(value).trim()}`));
  child.on('exit', (code, signal) => {
    if (quitting || serverProcess !== child) return;
    void recordLocalCrash('local-service-exit', new Error('The local service exited unexpectedly.'), { code, signal });
    superviseRestart('local-service', startLocalServer);
  });
  await waitForHealth(runtime.port);
}

async function localServiceStatus() {
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/health`, { signal: AbortSignal.timeout(1_500) });
    return response.ok ? 'online' : 'offline';
  } catch { return 'offline'; }
}

async function restartLocalServer() {
  const previous = serverProcess; serverProcess = null;
  if (previous) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3_000);
      previous.once('exit', () => { clearTimeout(timer); resolve(); });
      previous.kill();
    });
  }
  runtime.session = null; runtime.coachSession = null;
  await startLocalServer();
}

async function collectorCommand(args) {
  const script = path.join(applicationRoot(), 'scripts', 'replay-collector.mjs');
  return collectChildOutput(runNode(script, args));
}

const collectorJsonCommand = args => collectJson(collectorCommand, args);

async function configureCollector() {
  const folders = [runtime.paths.valorantReplays, runtime.paths.replays, ...(runtime.config.extraReplayFolders || [])];
  const collectorRoot = runtime.paths.collector;
  // Prefer the parser runtime bundled with the installer (hash-pinned vrfkit
  // owned vrfkit release + embedded Python with pyarrow); fall back to a manual install.
  // A vrfkit.exe without its signed build-info.json is incomplete and must
  // never shadow a complete fallback runtime.
  const knownRuntime = resolveReplayRuntime({ applicationRoot: applicationRoot(), collectorRoot, localAppData: process.env.LOCALAPPDATA || '' });
  const runtimeArgs = knownRuntime.ready
    ? ['--vrfkit-binary', knownRuntime.binaryPath, '--python', knownRuntime.pythonPath, '--normalizer', knownRuntime.normalizerPath]
    : [];
  await collectorCommand(['configure', '--device-id', runtime.config.deviceId, '--managed-replay-path', runtime.paths.replays, '--scoreboard-folder', runtime.paths.screenshots, '--retention-days', String(runtime.config.retentionDays || 30), '--stable-seconds', '10', '--scan-seconds', '5', '--enable-auto-process', '--disable-auto-upload', ...runtimeArgs]);
  for (const folder of folders) await collectorCommand(['configure', '--add-path', folder]);
}

async function startCollector() {
  await configureCollector();
  const script = path.join(applicationRoot(), 'scripts', 'replay-collector.mjs');
  collectorProcess = runNode(script, ['watch']);
  collectorProcess.stdout.on('data', () => { void autoImportProcessedEvidence().catch(error => console.warn(`[collector-import] ${error.message}`)); });
  collectorProcess.stderr.on('data', value => console.error(`[collector] ${String(value).trim()}`));
  const child = collectorProcess;
  collectorProcess.on('exit', (code, signal) => {
    if (quitting || collectorProcess !== child) return;
    void recordLocalCrash('collector-exit', new Error('The replay watcher exited unexpectedly.'), { code, signal });
    superviseRestart('collector', startCollector);
  });
}

// Restart crashed children with backoff (2s, 4s, 8s ... capped at 60s). A
// child that keeps crashing more than 5 times in 10 minutes is left stopped
// and reported, instead of looping forever.
const restartHistory = new Map();
function superviseRestart(name, start) {
  const now = Date.now();
  const recent = (restartHistory.get(name) || []).filter(at => now - at < 10 * 60 * 1000);
  if (recent.length >= 5) { void recordLocalCrash(`${name}-restart-abandoned`, new Error(`${name} crashed repeatedly; restart Moe Tracker to try again.`)); return; }
  recent.push(now); restartHistory.set(name, recent);
  const delay = Math.min(60_000, 2_000 * 2 ** (recent.length - 1));
  setTimeout(() => { if (!quitting) void start().catch(error => recordLocalCrash(`${name}-restart-failed`, error)); }, delay);
}

async function bootstrapSession(force = false) {
  if (!force && sessionIsFresh(runtime.session)) return runtime.session;
  const credentials = loginCredentials(runtime.config);
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Local coach session could not be created (HTTP ${response.status}).`);
  runtime.session = result;
  return runtime.session;
}
async function bootstrapCoachSession(force = false) {
  if (!force && sessionIsFresh(runtime.coachSession)) return runtime.coachSession;
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(loginCredentials(runtime.config, true)) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Local privileged session could not be created (HTTP ${response.status}).`); runtime.coachSession = result; return runtime.coachSession;
}

async function localApiFetch(pathname, init = {}, coach = false) {
  const getSession = coach ? bootstrapCoachSession : bootstrapSession;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const session = await getSession(attempt > 0);
    const headers = new Headers(init.headers || {}); headers.set('authorization', `Bearer ${session.key}`);
    const response = await fetch(`http://127.0.0.1:${runtime.port}${pathname}`, { ...init, headers });
    if (response.status !== 401 || attempt > 0) return response;
    if (coach) runtime.coachSession = null; else runtime.session = null;
  }
  throw new Error('Local session renewal failed.');
}

async function importEvidenceFile(file) {
  const evidence = JSON.parse(await fsp.readFile(file, 'utf8'));
  const response = await localApiFetch('/api/desktop/replay-evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evidence) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Local replay evidence could not be added to the review inbox.');
  await enqueueSyncEvidence(evidence);
  return result;
}

async function autoImportProcessedEvidence() {
  if (runtime.config.capturePaused) return { imported: 0, paused: true };
  if (collectorImportPromise) return collectorImportPromise;
  collectorImportPromise = (async () => {
    const manifest = await json(path.join(runtime.paths.collector, 'manifest.json'), { files: {} });
    const completed = Array.isArray(runtime.config.importedEvidenceIds) ? runtime.config.importedEvidenceIds : [];
    const candidates = evidenceCandidates(manifest, runtime.paths.collector, completed);
    if (!candidates.length) return { imported: 0 };
    const importedIds = new Set(completed);
    let imported = 0;
    for (const candidate of candidates) {
      await importEvidenceFile(candidate.file);
      importedIds.add(candidate.id);
      imported += 1;
    }
    runtime.config.importedEvidenceIds = [...importedIds].slice(-1000);
    await saveRuntimeConfig();
    return { imported };
  })().finally(() => { collectorImportPromise = null; });
  return collectorImportPromise;
}

async function syncState() { return json(runtime.paths.syncState, { schemaVersion: 1, outbox: [], inbox: [], completed: [] }); }
async function mutateSyncState(mutator) {
  const operation = syncStateMutation.then(async () => {
    const state = await syncState();
    await mutator(state);
    await atomicJson(runtime.paths.syncState, state);
    return state;
  });
  syncStateMutation = operation.catch(() => undefined);
  return operation;
}
async function enqueueSyncEvidence(evidence) {
  const id = `replay:${evidence.source.sha256}:${evidence.evidenceSha256}`;
  await mutateSyncState(state => { if (!state.completed.includes(id) && !state.outbox.some(item => item.id === id)) state.outbox.push({ id, kind: 'replay-evidence', sha256: evidence.source.sha256, evidence, createdAt: new Date().toISOString(), attempts: 0, lastError: null }); });
}
async function enqueueScreenshotSummary(summary) {
  if (!summary?.match?.id || summary.schemaVersion !== 1) throw new Error('Screenshot summary is invalid.');
  const digest = crypto.createHash('sha256').update(canonical(summary)).digest('hex'); const id = `screenshot-summary:${summary.match.id}:${digest}`;
  await mutateSyncState(state => {
    state.outbox = state.outbox.filter(item => item.kind !== 'screenshot-summary' || item.matchId !== summary.match.id);
    if (!state.completed.includes(id) && !state.outbox.some(item => item.id === id)) state.outbox.push({ id, kind: 'screenshot-summary', matchId: summary.match.id, summary, createdAt: new Date().toISOString(), attempts: 0, lastError: null });
  });
  return { queued: true, id };
}
function safeCloudUrl(value) {
  const parsed = new URL(String(value || '').trim()); const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) throw new Error('Team server must use HTTPS.');
  return parsed.origin;
}
function evidenceForPairedDevice(evidence, deviceId) {
  const copy = structuredClone(evidence); copy.source.deviceId = deviceId; delete copy.evidenceSha256;
  copy.evidenceSha256 = crypto.createHash('sha256').update(canonical(copy)).digest('hex'); return copy;
}
function cloudCredential() {
  const pairing = runtime.config.cloudPairing; if (!pairing?.credential || !safeStorage.isEncryptionAvailable()) return null;
  return { ...pairing, token: safeStorage.decryptString(Buffer.from(pairing.credential, 'base64')) };
}
async function pairDevice({ server, code }) {
  const endpoint = safeCloudUrl(server); if (!/^[A-Z2-9]{10}$/.test(String(code || '').trim().toUpperCase())) throw new Error('Enter the 10-character pairing code.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable for this user.');
  const response = await fetch(`${endpoint}/api/replay-intake/pair`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: String(code).trim().toUpperCase(), deviceName: runtime.config.deviceName }) });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Device pairing failed.');
  runtime.config.cloudPairing = { server: endpoint, deviceId: result.device.id, owner: result.device.owner, credential: safeStorage.encryptString(result.credential.token).toString('base64'), pairedAt: new Date().toISOString() };
  runtime.config.identity = result.identity; runtime.config.role = result.identity?.role || result.device.owner.role; runtime.config.mode = 'connected'; runtime.session = null; await saveRuntimeConfig();
  setTimeout(() => mainWindow?.reload(), 500);
  return { paired: true, server: endpoint, device: result.device };
}
async function syncOnce() {
  const pairing = cloudCredential(); let state;
  try {
    const response = await localApiFetch('/api/data', {}, true);
    const data = response.ok ? await response.json() : null;
    state = await mutateSyncState(current => { if (data) refreshScreenshotOutboxFromData(current, data); });
  } catch (error) { console.warn(`[sync] Local screenshot queue refresh failed: ${error.message}`); }
  state ||= await syncState();
  if (!pairing || runtime.config.mode !== 'connected') return { state: 'local-only', message: `${state.outbox.length} change${state.outbox.length === 1 ? '' : 's'} safely queued. ${pairing ? 'Connected sync is paused.' : 'Pair this device to synchronize.'}`, pending: state.outbox.length };
  let uploaded = 0;
  for (const item of [...state.outbox]) {
    try {
      const screenshotSummary = item.kind === 'screenshot-summary';
      const endpoint = screenshotSummary ? `${pairing.server}/api/replay-intake/screenshot-summaries/${encodeURIComponent(item.matchId)}` : `${pairing.server}/api/replay-intake/evidence/${item.sha256}`;
      const payload = screenshotSummary ? item.summary : evidenceForPairedDevice(item.evidence, pairing.deviceId);
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-device-id': pairing.deviceId, 'x-device-token': pairing.token }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || `Sync failed with HTTP ${response.status}.`);
      state = await mutateSyncState(current => { current.outbox = current.outbox.filter(entry => entry.id !== item.id); current.completed = [...new Set([item.id, ...current.completed])].slice(0, 1000); }); uploaded += 1;
    } catch (error) {
      state = await mutateSyncState(current => { const pending = current.outbox.find(entry => entry.id === item.id); if (pending) { pending.attempts += 1; pending.lastError = String(error?.message || error).slice(0, 300); pending.lastAttemptAt = new Date().toISOString(); } });
      return { state: 'attention', message: `${uploaded} uploaded; ${state.outbox.length} remain safely queued. ${String(error?.message || error)}`, uploaded, pending: state.outbox.length };
    }
  }
  // Follow hasMore so a backlog larger than one page is fully downloaded.
  const inboxResult = { items: [], cursor: state.cursor || null };
  for (let page = 0; page < 20; page += 1) {
    const inboxResponse = await fetch(`${pairing.server}/api/replay-intake/device-sync${inboxResult.cursor ? `?since=${encodeURIComponent(inboxResult.cursor)}` : ''}`, { redirect: 'error', headers: { 'x-device-id': pairing.deviceId, 'x-device-token': pairing.token } });
    const pageResult = await inboxResponse.json().catch(() => ({}));
    if (!inboxResponse.ok) return { state: 'attention', message: `${uploaded} uploaded; shared updates could not be downloaded. ${pageResult.error || `HTTP ${inboxResponse.status}`}`, uploaded, pending: state.outbox.length };
    const fresh = (pageResult.items || []).filter(item => !inboxResult.items.some(existing => existing.id === item.id));
    inboxResult.items.push(...fresh);
    const advanced = pageResult.cursor && pageResult.cursor !== inboxResult.cursor;
    if (pageResult.cursor) inboxResult.cursor = pageResult.cursor;
    if (!pageResult.hasMore || !advanced) break;
  }
  const received = inboxResult.items.filter(item => !state.inbox.some(existing => existing.id === item.id));
  let applyResult = null;
  if (received.length) {
    const applyResponse = await localApiFetch('/api/desktop/sync-inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: received }) }, true);
    applyResult = await applyResponse.json().catch(() => ({})); if (!applyResponse.ok) throw new Error(applyResult.error || 'Downloaded team updates could not be applied.');
  }
  state = await mutateSyncState(current => {
    if (received.length) { const receivedAt = new Date().toISOString(); for (const item of received) if (!current.inbox.some(existing => existing.id === item.id)) current.inbox.push({ ...item, receivedAt, applyResult }); current.inbox = current.inbox.slice(-500); }
    if (inboxResult.cursor) current.cursor = inboxResult.cursor;
  });
  return { state: 'synced', message: `${uploaded} uploaded; ${received.length} shared update${received.length === 1 ? '' : 's'} received.`, uploaded, downloaded: received.length, pending: state.outbox.length };
}
async function syncNow() {
  if (syncPromise) return syncPromise;
  syncPromise = syncOnce().finally(() => { syncPromise = null; }); return syncPromise;
}
async function createRecoveryBackup() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const last = Date.parse(runtime.config.lastBackupAt || '');
  if (Number.isFinite(last) && last >= cutoff && await hasRecentRecoveryBackup(runtime.paths.backups, cutoff)) return { skipped: true };
  const response = await localApiFetch('/api/desktop/backup', { method: 'POST' }, true); const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Automatic recovery backup failed.'); runtime.config.lastBackupAt = new Date().toISOString(); await saveRuntimeConfig(); return result;
}

async function replayInventory() {
  const folders = [runtime.paths.valorantReplays, runtime.paths.replays, ...(runtime.config.extraReplayFolders || [])];
  const entries = [];
  for (const folder of folders) {
    try {
      for (const item of await fsp.readdir(folder, { withFileTypes: true })) if (item.isFile() && item.name.toLowerCase().endsWith('.vrf')) {
        const fullPath = path.join(folder, item.name); const stat = await fsp.stat(fullPath);
        entries.push({ name: item.name, path: fullPath, size: stat.size, modifiedAt: stat.mtime.toISOString() });
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return entries.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

async function desktopStatus() {
  const replays = await replayInventory();
  const pendingScoreboards = await allPendingScoreboards();
  const localSync = await syncState();
  let collector = null;
  try { collector = await collectorJsonCommand(['status']); } catch (error) { collector = { error: error.message }; }
  const collectorText = JSON.stringify(collector || {}); const matchDetected = /observing|locked/i.test(collectorText); const capturing = captureActivity?.state === 'capturing' && Date.now() - captureActivity.startedAt < 5 * 60 * 1000;
  const captureState = runtime.config.capturePaused ? 'paused' : pendingScoreboards.length ? 'review-required' : collector?.error ? 'error' : capturing ? 'capturing' : matchDetected ? 'match-detected' : syncPromise && localSync.outbox.length ? 'uploading' : runtime.config.cloudPairing && !localSync.outbox.length ? 'synchronized' : replays.length ? 'capture-ready' : 'waiting-for-valorant';
  return {
    appVersion: app.getVersion(),
    deviceId: runtime.config.deviceId,
    mode: runtime.config.mode,
    deviceName: runtime.config.deviceName,
    retentionDays: runtime.config.retentionDays,
    startWithWindows: !!runtime.config.startWithWindows,
    role: runtime.config.role || 'coach',
    teamName: runtime.config.cloudPairing?.owner?.teamName || runtime.config.cloudPairing?.owner?.teamId || null,
    capture: { state: captureState, paused: !!runtime.config.capturePaused, preferences: runtime.config.capturePreferences, safety: 'post-match-only', lastError: collector?.error || null },
    cloudUrl: runtime.config.cloudUrl,
    folders: runtime.paths,
    replayCount: replays.length,
    replays,
    pendingScoreboards: pendingScoreboards.length,
    latestReplay: replays[0] || null,
    collector,
    sync: { paired: !!runtime.config.cloudPairing, server: runtime.config.cloudPairing?.server || null, pending: localSync.outbox.length, received: localSync.inbox.length },
    localService: await localServiceStatus(),
    update: updateController?.getState() || { state: app.isPackaged ? 'current' : 'disabled', version: null, percent: null, message: app.isPackaged ? 'Update service is starting.' : 'Updates are available in installed builds.' },
  };
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const startHidden = process.argv.includes('--hidden');
  mainWindow = new BrowserWindow({
    width: 1540, height: 980, minWidth: 1080, minHeight: 720,
    backgroundColor: '#050b18',
    title: 'Moe Tracker Application',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    show: !startHidden,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow.hide(); } });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== `http://127.0.0.1:${runtime.port}/?desktop=1` && !url.startsWith(`http://127.0.0.1:${runtime.port}/`)) event.preventDefault(); });
  await mainWindow.loadURL(`http://127.0.0.1:${runtime.port}/?desktop=1`);
  return mainWindow;
}

async function showMainWindow() {
  const window = await createWindow();
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}

async function notifyLatestCapture() {
  const captures = (await allPendingScoreboards()).filter(record => record.capture);
  const latest = captures.at(-1);
  if (!latest || latest.id === lastNotifiedCaptureId) return;
  lastNotifiedCaptureId = latest.id;
  captureActivity = null;
  if (runtime.config.capturePaused || runtime.config.capturePreferences?.notification === 'silent') return;
  if (runtime.config.capturePreferences?.notification === 'notify-only') { if (Notification.isSupported()) new Notification({ title: 'Moe Tracker capture ready', body: 'The post-match capture is ready for review.' }).show(); return; }
  const window = await createWindow();
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
  window.webContents.send('desktop:capture-ready', { id: latest.id, captureId: latest.capture.captureId });
}

function createTray() {
  tray?.destroy();
  tray = new Tray(path.join(__dirname, 'assets', 'app-icon.ico'));
  tray.setToolTip(runtime.config.capturePaused ? 'Moe Tracker — capture paused' : 'Moe Tracker — capture watcher active');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: runtime.config.capturePaused ? 'Capture paused' : 'Capture watcher active', enabled: false },
    { type: 'separator' },
    { label: 'Open Moe Tracker', click: () => { void showMainWindow().catch(error => recordLocalCrash('open-window-failed', error)); } },
    { label: runtime.config.capturePaused ? 'Resume capture' : 'Pause capture', click: () => { runtime.config.capturePaused = !runtime.config.capturePaused; void saveRuntimeConfig().then(createTray); } },
    { label: 'Open replay inbox', click: () => { void shell.openPath(runtime.paths.replays); } },
    { label: 'Open captured scoreboards', click: () => { void shell.openPath(runtime.paths.screenshots); } },
    { label: 'Open diagnostic logs', click: () => { void shell.openPath(runtime.paths.logs); } },
    { type: 'separator' },
    { label: 'Quit Moe Tracker', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { void showMainWindow().catch(error => recordLocalCrash('open-window-failed', error)); });
}

function requireTrustedSender(event) {
  const senderUrl = String(event?.senderFrame?.url || event?.sender?.getURL?.() || '');
  if (!isTrustedSenderUrl(senderUrl, runtime.port)) throw new Error('Desktop request rejected from an untrusted page.');
}

function handleTrusted(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => { requireTrustedSender(event); return listener(event, ...args); });
}

handleTrusted('desktop:bootstrap-session', (event, force) => { requireTrustedSender(event); return bootstrapSession(force === true); });
handleTrusted('desktop:get-status', desktopStatus);
handleTrusted('desktop:check-for-updates', () => updateController?.check() || { state: 'disabled', message: 'Update service is not ready.' });
handleTrusted('desktop:download-update', () => updateController?.download() || Promise.reject(new Error('Update service is not ready.')));
handleTrusted('desktop:install-update', () => updateController?.install() || Promise.reject(new Error('Update service is not ready.')));
handleTrusted('desktop:process-match', async event => {
  requireTrustedSender(event);
  await configureCollector();
  let first = await collectorJsonCommand(['scan']);
  if (first.some(item => item.status === 'observing')) { await new Promise(resolve => setTimeout(resolve, 11_000)); first = await collectorJsonCommand(['scan']); }
  if (first.some(item => item.status === 'observing' || item.status === 'locked')) return { state: 'waiting', message: 'VALORANT is still finishing the replay. Moe Tracker will keep watching it automatically.', items: first };
  let processed;
  try { processed = await collectorJsonCommand(['process-latest']); }
  catch (error) {
    if (/Local (binaryPath|pythonPath|normalizerPath) is not configured|build-info\.json|Local vrfkit runtime does not match/.test(String(error?.message || ''))) throw new Error('The verified replay parser is incomplete on this PC. Screenshot capture still works; install or repair the replay parser from Settings before processing replay files.');
    throw error;
  }
  if (processed?.state === 'unsupported-patch') return { state: 'unsupported-patch', message: processed.message, items: first };
  const imported = await importEvidenceFile(processed.evidencePath);
  const skippedNote = processed.skippedUnsupported ? ` Skipped ${processed.skippedUnsupported} newer replay${processed.skippedUnsupported === 1 ? '' : 's'} from an unsupported VALORANT patch; use screenshot capture for those.` : '';
  return { state: imported.automatic ? 'processed' : 'review-ready', message: `${imported.automatic ? 'Replay, player names, and available statistics were processed automatically. You can edit the saved match later.' : imported.idempotent ? 'This replay was already in the local review inbox.' : 'Replay parsed locally. It will finish automatically when the matching scoreboard is available.'}${skippedNote}`, items: first, processed, imported };
});
handleTrusted('desktop:choose-vod-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Choose a VALORANT VOD', filters: [{ name: 'Video files', extensions: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'] }] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const selected = path.resolve(result.filePaths[0]); approvedVodPaths.add(selected);
  return { canceled: false, path: selected, name: path.basename(selected) };
});
const activeVodAnalyses = new Map();
handleTrusted('desktop:analyze-vod', async (event, input = {}) => {
  const players = Array.isArray(input.players) ? input.players.slice(0, 10).map(item => ({ name: String(item?.name || '').trim().slice(0, 100), team: item?.team === 'theirs' ? 'theirs' : 'ours', expectedKills: Number.isInteger(item?.expectedKills) && item.expectedKills >= 0 ? item.expectedKills : null, expectedDeaths: Number.isInteger(item?.expectedDeaths) && item.expectedDeaths >= 0 ? item.expectedDeaths : null })).filter(item => item.name) : [];
  if (players.length < 5) throw new Error('Timeline analysis needs at least five identified scoreboard names.');
  const localPath = input.localPath ? path.resolve(String(input.localPath)) : null;
  if (localPath && !approvedVodPaths.has(localPath)) throw new Error('Choose the local VOD through Moe Tracker before analyzing it.');
  const progress = payload => { if (!event.sender.isDestroyed()) event.sender.send('desktop:vod-analysis-progress', payload); };
  const jobKey = event.sender.id; if (activeVodAnalyses.has(jobKey)) throw new Error('A VOD analysis is already running in this window.');
  const controller = new AbortController(); activeVodAnalyses.set(jobKey, controller);
  try {
    return await analyzeVodTimeline({ vodUrl: String(input.vodUrl || '').trim(), localPath, players, povPlayerName: String(input.povPlayerName || '').trim() || null }, { progress, signal: controller.signal, workRoot: path.join(runtime.paths.local, 'Vod Analysis') });
  } finally { activeVodAnalyses.delete(jobKey); if (localPath) approvedVodPaths.delete(localPath); }
});
handleTrusted('desktop:cancel-vod-analysis', event => { const controller = activeVodAnalyses.get(event.sender.id); if (!controller) return { cancelled: false }; controller.abort(new Error('VOD analysis was cancelled.')); return { cancelled: true }; });
handleTrusted('desktop:sync-now', syncNow);
handleTrusted('desktop:pair-device', (event, input) => { requireTrustedSender(event); return pairDevice(input || {}); });
handleTrusted('desktop:set-sync-mode', async (_event, mode) => { if (!['offline-first', 'connected'].includes(mode)) throw new Error('Unknown synchronization mode.'); if (mode === 'connected' && !runtime.config.cloudPairing) throw new Error('Pair this device before enabling connected sync.'); runtime.config.mode = mode; await saveRuntimeConfig(); return { mode }; });
handleTrusted('desktop:set-retention-days', async (_event, value) => { const days = Number(value); if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Retention must be between 1 and 365 days.'); runtime.config.retentionDays = days; await saveRuntimeConfig(); await configureCollector(); return { retentionDays: days }; });
handleTrusted('desktop:set-start-with-windows', async (_event, enabled) => { runtime.config.startWithWindows = enabled === true; await saveRuntimeConfig(); applyLoginPreference(); return { startWithWindows: runtime.config.startWithWindows }; });
handleTrusted('desktop:set-capture-paused', async (_event, paused) => { runtime.config.capturePaused = paused === true; await saveRuntimeConfig(); createTray(); return { paused: runtime.config.capturePaused }; });
handleTrusted('desktop:set-capture-preferences', async (_event, input = {}) => {
  const profile = ['fullscreen', 'fullscreen-windowed', 'windowed'].includes(input.profile) ? input.profile : runtime.config.capturePreferences.profile;
  const display = /^(primary|display:\d{1,2})$/.test(String(input.display || '')) ? String(input.display) : runtime.config.capturePreferences.display;
  const notification = ['open-review', 'notify-only', 'silent'].includes(input.notification) ? input.notification : runtime.config.capturePreferences.notification;
  runtime.config.capturePreferences = { profile, display, notification, offlineQueue: input.offlineQueue !== false }; await saveRuntimeConfig(); return runtime.config.capturePreferences;
});
handleTrusted('desktop:disconnect-device', async () => { delete runtime.config.cloudPairing; delete runtime.config.identity; runtime.config.mode = 'offline-first'; runtime.config.role = 'coach'; runtime.session = null; runtime.coachSession = null; await saveRuntimeConfig(); return { disconnected: true }; });
handleTrusted('desktop:list-scoreboards', async () => (await allPendingScoreboards()).map(({ file: _privatePath, capture: privateCapture, ...record }) => ({ ...record, capture: privateCapture ? { captureId: privateCapture.captureId, template: privateCapture.template, requestedRounds: privateCapture.requestedRounds } : null })));
handleTrusted('desktop:read-scoreboard', async (_event, id) => {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('Unknown scoreboard image.');
  const record = (await allPendingScoreboards()).find(item => item.id === id);
  if (!record) throw new Error('The scoreboard image is no longer pending.');
  return readScoreboardRecord(record);
});
handleTrusted('desktop:read-capture-session', async (_event, id) => {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('Unknown capture session.');
  const record = (await allPendingScoreboards()).find(item => item.id === id);
  if (!record) throw new Error('The capture session is no longer pending.');
  const session = await readCaptureSession(record);
  return {
    id: record.id,
    captureId: String(session.manifest.captureId || record.capture?.captureId || ''),
    template: String(session.manifest.template || record.capture?.template || ''),
    requestedRounds: Number(session.manifest.requestedRounds || 0),
    captures: session.captures.map(item => ({ kind: item.kind, round: item.round, name: item.file, mediaType: item.mediaType, base64: item.bytes.toString('base64') })),
  };
});
handleTrusted('desktop:complete-scoreboard', async (_event, id) => {
  if (!/^[a-f0-9]{64}$/.test(String(id || ''))) throw new Error('Unknown scoreboard image.');
  const record = (await allPendingScoreboards()).find(item => item.id === id);
  if (!record) throw new Error('The scoreboard image is no longer pending.');
  const loaded = await readScoreboardRecord(record);
  runtime.config.processedScoreboardIds = [...new Set([...(runtime.config.processedScoreboardIds || []), id])].slice(-50_000);
  runtime.config.processedScoreboardHashes = [...new Set([...(runtime.config.processedScoreboardHashes || []), loaded.imageSha256])].slice(-50_000);
  await saveRuntimeConfig(); return { completed: true };
});
handleTrusted('desktop:start-scrim-capture', async (_event, input = {}) => {
  if (runtime.config.capturePaused) throw new Error('Capture is paused. Resume it from the tray or Settings first.');
  const roundCount = input.roundCount === undefined || input.roundCount === null || input.roundCount === '' ? 0 : Number(input.roundCount);
  if (!Number.isInteger(roundCount) || roundCount < 0 || roundCount > 32) throw new Error('Round count must be automatic or between 1 and 32.');
  const launcher = path.join(applicationRoot(), 'scripts', 'start-scrim-capture.cmd');
  if (!path.isAbsolute(launcher) || !fs.existsSync(launcher)) throw new Error('The built-in capture helper is missing. Reinstall Moe Tracker.');
  captureActivity = { state: 'capturing', startedAt: Date.now() };
  const command = "$process = Start-Process -FilePath $env:MOE_CAPTURE_LAUNCHER -Verb RunAs -ArgumentList @($env:MOE_CAPTURE_ROUNDS, 'elevated', $env:MOE_CAPTURE_PROFILE, $env:MOE_CAPTURE_DISPLAY) -PassThru; if (-not $process) { exit 1 }";
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      env: { ...process.env, MOE_CAPTURE_LAUNCHER: launcher, MOE_CAPTURE_ROUNDS: String(roundCount), MOE_CAPTURE_PROFILE: runtime.config.capturePreferences.profile, MOE_CAPTURE_DISPLAY: runtime.config.capturePreferences.display },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', value => { stderr += String(value); });
    child.on('error', error => { captureActivity = null; reject(error); });
    child.on('exit', code => { if (code === 0) resolve(); else { captureActivity = null; reject(new Error(stderr.trim() || 'Windows did not start the capture helper.')); } });
  });
  return { started: true, message: `Capture started${roundCount ? ` for ${roundCount} rounds` : ' with automatic round detection'}. Approve Windows elevation, then return to VALORANT before the countdown ends.` };
});
handleTrusted('desktop:delete-replay', async (event, replayPath) => {
  requireTrustedSender(event);
  const requested = path.resolve(String(replayPath || ''));
  const record = (await replayInventory()).find(item => path.resolve(item.path) === requested);
  if (!record || path.extname(record.path).toLowerCase() !== '.vrf') throw new Error('That replay is no longer in a configured replay folder.');
  await shell.trashItem(record.path);
  return { deleted: true, message: `${record.name} was moved to the Recycle Bin.` };
});
handleTrusted('desktop:get-integration-secret-status', async () => ({
  encryptionAvailable: safeStorage.isEncryptionAvailable(),
  configured: Object.fromEntries(['GEMINI_API_KEY', 'GRID_API_KEY', 'DISCORD_WEBHOOK_URL'].map(key => [key, !!runtime.config.integrationSecrets?.[key]])),
  scope: 'local-device',
}));
handleTrusted('desktop:set-integration-secret', async (event, input = {}) => {
  requireTrustedSender(event);
  const key = String(input.key || ''); const value = String(input.value || '').trim();
  if (!['GEMINI_API_KEY', 'GRID_API_KEY', 'DISCORD_WEBHOOK_URL'].includes(key)) throw new Error('Unknown integration secret.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable for this user.');
  if (key === 'DISCORD_WEBHOOK_URL' && value && !/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(value)) throw new Error('Enter a valid Discord webhook URL.');
  runtime.config.integrationSecrets ||= {};
  if (value) runtime.config.integrationSecrets[key] = safeStorage.encryptString(value).toString('base64');
  else delete runtime.config.integrationSecrets[key];
  await saveRuntimeConfig();
  await restartLocalServer();
  return { configured: !!value };
});
handleTrusted('desktop:open-folder', async (_event, kind) => {
  const allowed = { replays: runtime.paths.replays, screenshots: runtime.paths.screenshots, exports: runtime.paths.exports, backups: runtime.paths.backups, logs: runtime.paths.logs };
  if (!allowed[kind]) throw new Error('Unknown Moe Tracker folder.');
  await fsp.mkdir(allowed[kind], { recursive: true });
  const error = await shell.openPath(allowed[kind]);
  if (error) throw new Error(error);
  return { opened: true, path: allowed[kind] };
});
handleTrusted('desktop:report-diagnostic', async (_event, input = {}) => {
  const code = `MT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await recordLocalCrash('reported-action-error', new Error(String(input.message || 'Unknown desktop action error')), { code, action: String(input.action || 'unknown').slice(0, 100) });
  return { code };
});
handleTrusted('desktop:export-support-bundle', async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(runtime.paths.exports, `MoeTracker-Support-${timestamp}.zip`);
  const result = await createSupportBundle({
    target, logs: runtime.paths.logs,
    captureRoots: [runtime.paths.screenshots, path.join(process.env.LOCALAPPDATA || '', 'MoeTracker', 'Scoreboards')],
    summary: { schemaVersion: 1, createdAt: new Date().toISOString(), appVersion: app.getVersion(), platform: process.platform, architecture: process.arch, windowsRelease: require('node:os').release(), deviceName: runtime.config.deviceName, mode: runtime.config.mode, paired: !!runtime.config.cloudPairing, update: updateController?.getState() || null },
  });
  return { ...result, message: `Support bundle saved to ${result.path}` };
});
handleTrusted('desktop:queue-screenshot-summary', (_event, input) => enqueueScreenshotSummary(input));
handleTrusted('desktop:choose-replay-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Choose an additional replay folder' });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  runtime.config.extraReplayFolders = [...new Set([...(runtime.config.extraReplayFolders || []), result.filePaths[0]])];
  await saveRuntimeConfig(); await configureCollector();
  return { canceled: false, path: result.filePaths[0] };
});
handleTrusted('desktop:export-team-package', async (event, input = {}) => {
  requireTrustedSender(event);
  const session = await bootstrapCoachSession();
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/portable-package/export`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ sourceDeviceId: runtime.config.deviceId }) });
  if (!response.ok) throw new Error('Local team package could not be created.');
  const target = path.join(runtime.paths.exports, `moe-tracker-team-${new Date().toISOString().replace(/[:.]/g, '-')}.moetracker`);
  const plaintext = Buffer.from(await response.arrayBuffer()); const password = String(input.password || '');
  await fsp.writeFile(target, password ? await encryptPortablePackage(plaintext, password) : plaintext);
  return { exported: true, encrypted: !!password, path: target };
});
handleTrusted('desktop:preview-team-package', async (event, input = {}) => {
  requireTrustedSender(event);
  runtime.pendingImport = null;
  const selection = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Preview a MoeTracker package', filters: [{ name: 'MoeTracker packages', extensions: ['moetracker'] }] });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  const file = selection.filePaths[0]; const bytes = await fsp.readFile(file); if (bytes.length > MAX_ENVELOPE_BYTES) throw new Error('Portable package exceeds the safety limit.');
  const packageBytes = await decryptPortablePackage(bytes, input.password); const session = await bootstrapCoachSession();
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/portable-package/preview`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: packageBytes });
  const preview = await response.json().catch(() => ({})); if (!response.ok) throw new Error(preview.error || 'Portable package preview failed.');
  runtime.pendingImport = { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), packageBytes };
  return { canceled: false, file, preview };
});
handleTrusted('desktop:import-team-package', async event => {
  requireTrustedSender(event);
  if (!runtime.pendingImport) throw new Error('Preview a package before importing it.');
  const bytes = await fsp.readFile(runtime.pendingImport.file); const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== runtime.pendingImport.sha256) throw new Error('The package changed after preview. Preview it again.');
  const session = await bootstrapCoachSession(); const response = await fetch(`http://127.0.0.1:${runtime.port}/api/portable-package/import`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: runtime.pendingImport.packageBytes });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Portable package import failed.');
  runtime.pendingImport = null; return { imported: true, message: 'Portable package imported. Conflicts were left unchanged.', result };
});

process.on('unhandledRejection', reason => { void recordLocalCrash('unhandled-rejection', reason); });
process.on('uncaughtException', error => { void recordLocalCrash('uncaught-exception', error).finally(() => { dialog.showErrorBox('Moe Tracker stopped unexpectedly', 'A local crash report was saved. Restart Moe Tracker to continue.'); app.exit(1); }); });
app.on('render-process-gone', (_event, _webContents, details) => { void recordLocalCrash('renderer-process-gone', new Error('The desktop window process stopped.'), { reason: details.reason, exitCode: details.exitCode }); });
app.on('child-process-gone', (_event, details) => { void recordLocalCrash('electron-child-process-gone', new Error('An application helper process stopped.'), { type: details.type, reason: details.reason, exitCode: details.exitCode }); });

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();
app.on('second-instance', () => { if (runtime) void showMainWindow().catch(error => recordLocalCrash('open-window-failed', error)); });

if (singleInstanceLock) app.whenReady().then(async () => {
  await ensureRuntime(); applyLoginPreference();
  const { autoUpdater } = require('electron-updater');
  const updateHealth = createUpdateHealth({ directory: path.join(runtime.paths.local, 'Updates') });
  const healthState = app.isPackaged ? await updateHealth.beginStartup(app.getVersion()) : { state: 'not-pending' };
  if (healthState.state === 'rollback-started') { quitting = true; app.quit(); return; }
  const updatesEnabled = app.isPackaged && healthState.state !== 'safe-mode';
  updateController = createUpdateController({ autoUpdater, enabled: updatesEnabled, currentVersion: app.getVersion(), updateHealth });
  updateController.start();
  await startLocalServer(); await startCollector(); await createWindow(); createTray();
  captureInboxTimer = setInterval(() => { void notifyLatestCapture().catch(error => recordLocalCrash('capture-inbox-watch-failed', error)); }, 2_000); captureInboxTimer.unref?.();
  setTimeout(() => void notifyLatestCapture().catch(error => recordLocalCrash('capture-inbox-watch-failed', error)), 750);
  if (healthState.state === 'verifying') await updateHealth.confirmHealthy(app.getVersion());
  collectorImportTimer = setInterval(() => { void autoImportProcessedEvidence().catch(error => console.warn(`[collector-import] ${error.message}`)); }, 5_000); collectorImportTimer.unref?.();
  setTimeout(() => void autoImportProcessedEvidence().catch(error => console.warn(`[collector-import] ${error.message}`)), 1_000);
  syncTimer = setInterval(() => { if (runtime.config.cloudPairing && runtime.config.mode === 'connected') void syncNow().catch(error => console.warn(`[sync] ${error.message}`)); }, 60_000); syncTimer.unref?.();
  setTimeout(() => void syncNow().catch(error => console.warn(`[sync] ${error.message}`)), 5_000);
  setTimeout(() => void createRecoveryBackup().catch(error => console.warn(`[backup] ${error.message}`)), 8_000);
  // The tray keeps the app alive for days; re-check every 6 hours so a daily
  // encrypted recovery backup is taken even without a restart.
  backupTimer = setInterval(() => void createRecoveryBackup().catch(error => console.warn(`[backup] ${error.message}`)), 6 * 60 * 60 * 1000);
  app.on('activate', () => { void showMainWindow().catch(error => recordLocalCrash('open-window-failed', error)); });
}).catch(error => { dialog.showErrorBox('Moe Tracker could not start', error.message); app.quit(); });

app.on('before-quit', () => { quitting = true; updateController?.stop(); if (collectorImportTimer) clearInterval(collectorImportTimer); if (syncTimer) clearInterval(syncTimer); if (captureInboxTimer) clearInterval(captureInboxTimer); if (backupTimer) clearInterval(backupTimer); tray?.destroy(); collectorProcess?.kill(); serverProcess?.kill(); });
app.on('window-all-closed', () => { /* The tray keeps replay watching and synchronization alive. */ });
