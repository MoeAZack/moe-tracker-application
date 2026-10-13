const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { evidenceCandidates } = require('./evidence-handoff.cjs');

let mainWindow;
let serverProcess;
let collectorProcess;
let collectorImportPromise;
let collectorImportTimer;
let syncTimer;
let syncPromise;
let runtime;

const json = async (file, fallback = null) => {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};

async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
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
    backups: path.join(documents, 'Backups'),
    valorantReplays: path.join(process.env.LOCALAPPDATA || '', 'VALORANT', 'Saved', 'Demos'),
    collector: path.join(process.env.LOCALAPPDATA || '', 'MoeTracker', 'ReplayCollector'),
  };
}

async function ensureRuntime() {
  const paths = appPaths();
  await Promise.all(Object.values({ local: paths.local, replays: paths.replays, screenshots: paths.screenshots, exports: paths.exports, backups: paths.backups }).map(folder => fsp.mkdir(folder, { recursive: true })));
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
      adminPassword: crypto.randomBytes(32).toString('base64url'),
      jwtSecret: crypto.randomBytes(48).toString('base64url'),
      extraReplayFolders: [],
      createdAt: new Date().toISOString(),
    };
    await atomicJson(paths.config, config);
  }
  if (!config.deviceId) {
    config.deviceId = `desktop-${crypto.randomUUID()}`;
    await atomicJson(paths.config, config);
  }
  if (!await json(paths.syncState, null)) await atomicJson(paths.syncState, { schemaVersion: 1, outbox: [], inbox: [], completed: [] });
  runtime = { paths, config, port: await freePort(), session: null, coachSession: null };
  return runtime;
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
  serverProcess = runNode(entry, [], { env: {
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(runtime.port),
    DB_PATH: runtime.paths.database,
    PRIVATE_BACKUP_DIR: runtime.paths.backups,
    ADMIN_PASSWORD: runtime.config.adminPassword,
    JWT_SECRET: runtime.config.jwtSecret,
    APP_DESKTOP: 'true',
  }});
  serverProcess.stderr.on('data', value => console.error(`[local-service] ${String(value).trim()}`));
  await waitForHealth(runtime.port);
}

async function collectorCommand(args) {
  const script = path.join(applicationRoot(), 'scripts', 'replay-collector.mjs');
  return new Promise((resolve, reject) => {
    const child = runNode(script, args);
    let stdout = ''; let stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    child.on('exit', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `Collector exited with code ${code}.`)));
  });
}

async function configureCollector() {
  const folders = [runtime.paths.valorantReplays, runtime.paths.replays, ...(runtime.config.extraReplayFolders || [])];
  await collectorCommand(['configure', '--device-id', runtime.config.deviceId, '--managed-replay-path', runtime.paths.replays, '--scoreboard-folder', runtime.paths.screenshots, '--retention-days', String(runtime.config.retentionDays || 30), '--stable-seconds', '10', '--scan-seconds', '5', '--enable-auto-process', '--disable-auto-upload']);
  for (const folder of folders) await collectorCommand(['configure', '--add-path', folder]);
}

async function startCollector() {
  await configureCollector();
  const script = path.join(applicationRoot(), 'scripts', 'replay-collector.mjs');
  collectorProcess = runNode(script, ['watch']);
  collectorProcess.stdout.on('data', () => { void autoImportProcessedEvidence().catch(error => console.warn(`[collector-import] ${error.message}`)); });
  collectorProcess.stderr.on('data', value => console.error(`[collector] ${String(value).trim()}`));
}

async function bootstrapSession() {
  if (runtime.session) return runtime.session;
  const credentials = { key: runtime.config.adminPassword };
  if (runtime.config.identity) credentials.desktopIdentity = runtime.config.identity;
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  if (!response.ok) throw new Error('Local coach session could not be created.');
  runtime.session = await response.json();
  return runtime.session;
}
async function bootstrapCoachSession() {
  if (runtime.coachSession) return runtime.coachSession;
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: runtime.config.adminPassword }) });
  if (!response.ok) throw new Error('Local privileged session could not be created.'); runtime.coachSession = await response.json(); return runtime.coachSession;
}

async function importEvidenceFile(file) {
  const session = await bootstrapSession();
  const evidence = JSON.parse(await fsp.readFile(file, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/desktop/replay-evidence`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: JSON.stringify(evidence) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Local replay evidence could not be added to the review inbox.');
  await enqueueSyncEvidence(evidence);
  return result;
}

async function autoImportProcessedEvidence() {
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
    await atomicJson(runtime.paths.config, runtime.config);
    return { imported };
  })().finally(() => { collectorImportPromise = null; });
  return collectorImportPromise;
}

async function syncState() { return json(runtime.paths.syncState, { schemaVersion: 1, outbox: [], inbox: [], completed: [] }); }
async function enqueueSyncEvidence(evidence) {
  const state = await syncState(); const id = `replay:${evidence.source.sha256}:${evidence.evidenceSha256}`;
  if (!state.completed.includes(id) && !state.outbox.some(item => item.id === id)) state.outbox.push({ id, kind: 'replay-evidence', sha256: evidence.source.sha256, evidence, createdAt: new Date().toISOString(), attempts: 0, lastError: null });
  await atomicJson(runtime.paths.syncState, state);
}
function safeCloudUrl(value) {
  const parsed = new URL(String(value || '').trim()); const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) throw new Error('Team server must use HTTPS.');
  return parsed.origin;
}
function canonical(value) { return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested) ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right))) : nested); }
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
  runtime.config.identity = result.identity; runtime.config.role = result.identity?.role || result.device.owner.role; runtime.config.mode = 'connected'; runtime.session = null; await atomicJson(runtime.paths.config, runtime.config);
  setTimeout(() => mainWindow?.reload(), 500);
  return { paired: true, server: endpoint, device: result.device };
}
async function syncOnce() {
  const pairing = cloudCredential(); const state = await syncState();
  if (!pairing || runtime.config.mode !== 'connected') return { state: 'local-only', message: `${state.outbox.length} change${state.outbox.length === 1 ? '' : 's'} safely queued. ${pairing ? 'Connected sync is paused.' : 'Pair this device to synchronize.'}`, pending: state.outbox.length };
  let uploaded = 0;
  for (const item of [...state.outbox]) {
    try {
      const response = await fetch(`${pairing.server}/api/replay-intake/evidence/${item.sha256}`, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', 'x-device-id': pairing.deviceId, 'x-device-token': pairing.token }, body: JSON.stringify(evidenceForPairedDevice(item.evidence, pairing.deviceId)) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || `Sync failed with HTTP ${response.status}.`);
      state.outbox = state.outbox.filter(entry => entry.id !== item.id); state.completed = [...new Set([item.id, ...state.completed])].slice(0, 1000); uploaded += 1; await atomicJson(runtime.paths.syncState, state);
    } catch (error) {
      const pending = state.outbox.find(entry => entry.id === item.id); if (pending) { pending.attempts += 1; pending.lastError = String(error?.message || error).slice(0, 300); pending.lastAttemptAt = new Date().toISOString(); }
      await atomicJson(runtime.paths.syncState, state); return { state: 'attention', message: `${uploaded} uploaded; ${state.outbox.length} remain safely queued. ${String(error?.message || error)}`, uploaded, pending: state.outbox.length };
    }
  }
  const inboxResponse = await fetch(`${pairing.server}/api/replay-intake/device-sync${state.cursor ? `?since=${encodeURIComponent(state.cursor)}` : ''}`, { redirect: 'error', headers: { 'x-device-id': pairing.deviceId, 'x-device-token': pairing.token } });
  const inboxResult = await inboxResponse.json().catch(() => ({}));
  if (!inboxResponse.ok) return { state: 'attention', message: `${uploaded} uploaded; shared updates could not be downloaded. ${inboxResult.error || `HTTP ${inboxResponse.status}`}`, uploaded, pending: state.outbox.length };
  const received = (inboxResult.items || []).filter(item => !state.inbox.some(existing => existing.id === item.id));
  if (received.length) {
    const session = await bootstrapCoachSession(); const applyResponse = await fetch(`http://127.0.0.1:${runtime.port}/api/desktop/sync-inbox`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ items: received }) });
    const applied = await applyResponse.json().catch(() => ({})); if (!applyResponse.ok) throw new Error(applied.error || 'Downloaded team updates could not be applied.');
    const receivedAt = new Date().toISOString(); for (const item of received) state.inbox.push({ ...item, receivedAt, applyResult: applied }); state.inbox = state.inbox.slice(-500);
  }
  if (inboxResult.cursor) state.cursor = inboxResult.cursor; await atomicJson(runtime.paths.syncState, state);
  return { state: 'synced', message: `${uploaded} uploaded; ${received.length} shared update${received.length === 1 ? '' : 's'} received.`, uploaded, downloaded: received.length, pending: state.outbox.length };
}
async function syncNow() {
  if (syncPromise) return syncPromise;
  syncPromise = syncOnce().finally(() => { syncPromise = null; }); return syncPromise;
}
async function createRecoveryBackup() {
  const last = Date.parse(runtime.config.lastBackupAt || ''); if (Number.isFinite(last) && Date.now() - last < 24 * 60 * 60 * 1000) return { skipped: true };
  const session = await bootstrapCoachSession(); const response = await fetch(`http://127.0.0.1:${runtime.port}/api/desktop/backup`, { method: 'POST', headers: { authorization: `Bearer ${session.key}` } }); const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Automatic recovery backup failed.'); runtime.config.lastBackupAt = new Date().toISOString(); await atomicJson(runtime.paths.config, runtime.config); return result;
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
  const localSync = await syncState();
  let collector = null;
  try { collector = JSON.parse(await collectorCommand(['status'])); } catch (error) { collector = { error: error.message }; }
  return {
    mode: runtime.config.mode,
    deviceName: runtime.config.deviceName,
    retentionDays: runtime.config.retentionDays,
    cloudUrl: runtime.config.cloudUrl,
    folders: runtime.paths,
    replayCount: replays.length,
    latestReplay: replays[0] || null,
    collector,
    sync: { paired: !!runtime.config.cloudPairing, server: runtime.config.cloudPairing?.server || null, pending: localSync.outbox.length, received: localSync.inbox.length },
    localService: 'online',
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540, height: 980, minWidth: 1080, minHeight: 720,
    backgroundColor: '#050b18',
    title: 'Moe Tracker Application',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await mainWindow.loadURL(`http://127.0.0.1:${runtime.port}/?desktop=1`);
}

ipcMain.handle('desktop:bootstrap-session', bootstrapSession);
ipcMain.handle('desktop:get-status', desktopStatus);
ipcMain.handle('desktop:process-match', async () => {
  await configureCollector();
  let first = JSON.parse((await collectorCommand(['scan'])) || '[]');
  if (first.some(item => item.status === 'observing')) { await new Promise(resolve => setTimeout(resolve, 11_000)); first = JSON.parse((await collectorCommand(['scan'])) || '[]'); }
  if (first.some(item => item.status === 'observing' || item.status === 'locked')) return { state: 'waiting', message: 'VALORANT is still finishing the replay. Moe Tracker will keep watching it automatically.', items: first };
  const processed = JSON.parse(await collectorCommand(['process-latest']));
  const imported = await importEvidenceFile(processed.evidencePath);
  return { state: 'review-ready', message: imported.idempotent ? 'This replay was already in the local review inbox.' : 'Replay parsed locally. The coach review draft is ready.', items: first, processed, imported };
});
ipcMain.handle('desktop:sync-now', syncNow);
ipcMain.handle('desktop:pair-device', (_event, input) => pairDevice(input || {}));
ipcMain.handle('desktop:set-sync-mode', async (_event, mode) => { if (!['offline-first', 'connected'].includes(mode)) throw new Error('Unknown synchronization mode.'); if (mode === 'connected' && !runtime.config.cloudPairing) throw new Error('Pair this device before enabling connected sync.'); runtime.config.mode = mode; await atomicJson(runtime.paths.config, runtime.config); return { mode }; });
ipcMain.handle('desktop:set-retention-days', async (_event, value) => { const days = Number(value); if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Retention must be between 1 and 365 days.'); runtime.config.retentionDays = days; await atomicJson(runtime.paths.config, runtime.config); await configureCollector(); return { retentionDays: days }; });
ipcMain.handle('desktop:open-folder', async (_event, kind) => {
  const allowed = { replays: runtime.paths.replays, screenshots: runtime.paths.screenshots, exports: runtime.paths.exports, backups: runtime.paths.backups };
  if (!allowed[kind]) throw new Error('Unknown Moe Tracker folder.');
  await fsp.mkdir(allowed[kind], { recursive: true });
  const error = await shell.openPath(allowed[kind]);
  if (error) throw new Error(error);
  return { opened: true, path: allowed[kind] };
});
ipcMain.handle('desktop:choose-replay-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Choose an additional replay folder' });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  runtime.config.extraReplayFolders = [...new Set([...(runtime.config.extraReplayFolders || []), result.filePaths[0]])];
  await atomicJson(runtime.paths.config, runtime.config); await configureCollector();
  return { canceled: false, path: result.filePaths[0] };
});
ipcMain.handle('desktop:export-team-package', async () => {
  const session = await bootstrapCoachSession();
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/portable-package/export`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ sourceDeviceId: runtime.config.deviceId }) });
  if (!response.ok) throw new Error('Local team package could not be created.');
  const target = path.join(runtime.paths.exports, `moe-tracker-team-${new Date().toISOString().replace(/[:.]/g, '-')}.moetracker`);
  await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return { exported: true, path: target };
});
ipcMain.handle('desktop:preview-team-package', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], title: 'Preview a MoeTracker package', filters: [{ name: 'MoeTracker packages', extensions: ['moetracker'] }] });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  const file = selection.filePaths[0]; const bytes = await fsp.readFile(file); const session = await bootstrapCoachSession();
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/portable-package/preview`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: bytes });
  const preview = await response.json().catch(() => ({})); if (!response.ok) throw new Error(preview.error || 'Portable package preview failed.');
  runtime.pendingImport = { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  return { canceled: false, file, preview };
});
ipcMain.handle('desktop:import-team-package', async () => {
  if (!runtime.pendingImport) throw new Error('Preview a package before importing it.');
  const bytes = await fsp.readFile(runtime.pendingImport.file); const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== runtime.pendingImport.sha256) throw new Error('The package changed after preview. Preview it again.');
  const session = await bootstrapCoachSession(); const response = await fetch(`http://127.0.0.1:${runtime.port}/api/portable-package/import`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: bytes });
  const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Portable package import failed.');
  runtime.pendingImport = null; return { imported: true, message: 'Portable package imported. Conflicts were left unchanged.', result };
});

app.whenReady().then(async () => {
  await ensureRuntime(); await startLocalServer(); await startCollector(); await createWindow();
  collectorImportTimer = setInterval(() => { void autoImportProcessedEvidence().catch(error => console.warn(`[collector-import] ${error.message}`)); }, 5_000); collectorImportTimer.unref?.();
  setTimeout(() => void autoImportProcessedEvidence().catch(error => console.warn(`[collector-import] ${error.message}`)), 1_000);
  syncTimer = setInterval(() => { if (runtime.config.cloudPairing && runtime.config.mode === 'connected') void syncNow().catch(error => console.warn(`[sync] ${error.message}`)); }, 60_000); syncTimer.unref?.();
  if (runtime.config.cloudPairing && runtime.config.mode === 'connected') setTimeout(() => void syncNow().catch(error => console.warn(`[sync] ${error.message}`)), 5_000);
  setTimeout(() => void createRecoveryBackup().catch(error => console.warn(`[backup] ${error.message}`)), 8_000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('Moe Tracker could not start', error.message); app.quit(); });

app.on('before-quit', () => { if (collectorImportTimer) clearInterval(collectorImportTimer); if (syncTimer) clearInterval(syncTimer); collectorProcess?.kill(); serverProcess?.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
