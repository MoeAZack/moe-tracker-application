const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_DELAY_MS = 2 * 60 * 1000;

function safeMessage(error) {
  return String(error?.message || error || 'Update operation failed.')
    .replace(/https?:\/\/\S+/gi, '[update service]')
    .slice(0, 240);
}

const UNTRUSTED_BUILD = 'Automatic updates are off: this build names no trusted code-signing publisher, so no update can be verified.';

function createUpdateController({ autoUpdater, enabled, currentVersion = null, updateHealth = null, trust = null, delayMs = DEFAULT_DELAY_MS, intervalMs = DEFAULT_INTERVAL_MS, onChange = () => {} }) {
  let timer = null;
  let downloadedFile = null;
  // Fail closed: without a configured publisher there is nothing to verify an
  // installer against, so the updater never checks, downloads or installs.
  const blocked = enabled && !trust?.configured;
  enabled = enabled && !blocked;
  let state = blocked
    ? { state: 'blocked', version: null, percent: null, message: UNTRUSTED_BUILD }
    : enabled
      ? { state: 'current', version: null, percent: null, message: 'Moe Tracker is up to date.' }
      : { state: 'disabled', version: null, percent: null, message: 'Updates are available in installed builds.' };

  const setState = (next) => {
    state = { ...state, ...next };
    onChange({ ...state });
    return { ...state };
  };

  if (enabled) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    // Replaces electron-updater's check, which passes any installer when
    // app-update.yml names no publisher. A non-null result rejects the download.
    autoUpdater.verifySignature = file => trust.verify(file);
    autoUpdater.on('checking-for-update', () => setState({ state: 'checking', percent: null, message: 'Checking for updates…' }));
    autoUpdater.on('update-available', info => setState({ state: 'available', version: info?.version || null, percent: null, message: `Version ${info?.version || 'new'} is available.` }));
    autoUpdater.on('update-not-available', () => setState({ state: 'current', version: null, percent: null, message: 'Moe Tracker is up to date.' }));
    autoUpdater.on('download-progress', progress => setState({ state: 'downloading', percent: Math.max(0, Math.min(100, Math.round(progress?.percent || 0))), message: 'Downloading the verified update…' }));
    autoUpdater.on('update-downloaded', info => { downloadedFile = info?.downloadedFile || null; setState({ state: 'downloaded', version: info?.version || state.version, percent: 100, message: 'Update ready. Restart to install it.' }); });
    autoUpdater.on('error', error => setState({ state: 'error', percent: null, message: safeMessage(error) }));
  }

  async function check() {
    if (!enabled) return { ...state };
    if (['checking', 'downloading', 'downloaded'].includes(state.state)) return { ...state };
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { setState({ state: 'error', percent: null, message: safeMessage(error) }); }
    return { ...state };
  }

  async function download() {
    if (!enabled) return { ...state };
    if (state.state !== 'available') throw new Error('Check for an available update first.');
    setState({ state: 'downloading', percent: 0, message: 'Downloading the verified update…' });
    try { await autoUpdater.downloadUpdate(); }
    catch (error) { setState({ state: 'error', percent: null, message: safeMessage(error) }); }
    return { ...state };
  }

  async function install() {
    if (!enabled || state.state !== 'downloaded') throw new Error('No downloaded update is ready to install.');
    // The file on disk is checked again: it may have changed since download.
    const failure = await trust.verify(downloadedFile);
    if (failure) { setState({ state: 'error', percent: null, message: safeMessage(failure) }); throw new Error(`The downloaded update was not installed: ${failure}`); }
    const health = updateHealth ? await updateHealth.prepareInstall({ previousVersion: currentVersion, targetVersion: state.version, downloadedFile }) : { rollbackReady: false };
    autoUpdater.quitAndInstall(false, true);
    return { installing: true, rollbackReady: health.rollbackReady };
  }

  function start() {
    if (!enabled || timer) return;
    timer = setTimeout(() => {
      void check();
      timer = setInterval(() => void check(), intervalMs);
      timer.unref?.();
    }, delayMs);
    timer.unref?.();
  }

  function stop() { if (timer) clearTimeout(timer); timer = null; }
  return { getState: () => ({ ...state }), check, download, install, start, stop };
}

module.exports = { createUpdateController, safeMessage, UNTRUSTED_BUILD };
