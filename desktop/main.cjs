const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

let mainWindow;
let serverProcess;
let collectorProcess;
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

function appPaths() {
  const documents = path.join(app.getPath('documents'), 'Moe Tracker');
  const local = path.join(app.getPath('userData'), 'Local Workspace');
  return {
    local,
    database: path.join(local, 'data', 'db.json'),
    config: path.join(local, 'desktop-config.json'),
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
  runtime = { paths, config, port: await freePort(), session: null };
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
  const entry = path.join(applicationRoot(), 'build', 'server.cjs');
  serverProcess = runNode(entry, [], { env: {
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(runtime.port),
    DB_PATH: runtime.paths.database,
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
  collectorProcess.stderr.on('data', value => console.error(`[collector] ${String(value).trim()}`));
}

async function bootstrapSession() {
  if (runtime.session) return runtime.session;
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: runtime.config.adminPassword }) });
  if (!response.ok) throw new Error('Local coach session could not be created.');
  runtime.session = await response.json();
  return runtime.session;
}

async function importEvidenceFile(file) {
  const session = await bootstrapSession();
  const evidence = JSON.parse(await fsp.readFile(file, 'utf8'));
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/desktop/replay-evidence`, { method: 'POST', headers: { authorization: `Bearer ${session.key}`, 'content-type': 'application/json' }, body: JSON.stringify(evidence) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Local replay evidence could not be added to the review inbox.');
  return result;
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
  const first = JSON.parse((await collectorCommand(['scan'])) || '[]');
  if (first.some(item => item.status === 'observing')) return { state: 'waiting', message: 'Replay found. Waiting briefly for VALORANT to finish writing it.', items: first };
  const processed = JSON.parse(await collectorCommand(['process-latest']));
  const imported = await importEvidenceFile(processed.evidencePath);
  return { state: 'review-ready', message: imported.idempotent ? 'This replay was already in the local review inbox.' : 'Replay parsed locally. The coach review draft is ready.', items: first, processed, imported };
});
ipcMain.handle('desktop:sync-now', async () => ({ state: 'local-only', message: 'Nothing was uploaded. Cloud sync activates after this device is paired with the team workspace.' }));
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
  const session = await bootstrapSession();
  const response = await fetch(`http://127.0.0.1:${runtime.port}/api/backup`, { method: 'POST', headers: { authorization: `Bearer ${session.key}` } });
  if (!response.ok) throw new Error('Local team package could not be created.');
  const target = path.join(runtime.paths.exports, `moe-tracker-team-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fsp.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return { exported: true, path: target };
});

app.whenReady().then(async () => {
  await ensureRuntime(); await startLocalServer(); await startCollector(); await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('Moe Tracker could not start', error.message); app.quit(); });

app.on('before-quit', () => { collectorProcess?.kill(); serverProcess?.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
