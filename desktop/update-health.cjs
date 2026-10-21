const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(temporary, file);
}

function safeVersion(value) { return String(value || '').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 64); }

// The NSIS installer leaves a copy of itself here (build/installer.nsh), so
// the very first update already has the installed version to fall back to.
const INSTALLED_DIRECTORY = 'installed';
function installedInstallerName(version) { return `Moe-Tracker-Application-${safeVersion(version)}-Setup.exe`; }

function createUpdateHealth({ directory, launchInstaller = installer => {
  const child = spawn(installer, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}, verifyInstaller = async () => 'No installer signature check is configured.' }) {
  const pendingFile = path.join(directory, 'pending-health.json');
  const goodFile = path.join(directory, 'last-known-good.json');

  // The installer this version was set up from: the last update confirmed
  // healthy, or else the copy the installer left on first install.
  async function previousInstaller(previousVersion) {
    const good = await readJson(goodFile);
    if (good?.version === previousVersion && good?.installer && fs.existsSync(good.installer)) return good.installer;
    const installed = path.join(directory, INSTALLED_DIRECTORY, installedInstallerName(previousVersion));
    if (!previousVersion || !fs.existsSync(installed)) return null;
    // A later install replaces the installed/ copy, so keep this one aside.
    const kept = path.join(directory, `rollback-${safeVersion(previousVersion)}.exe`);
    await fsp.copyFile(installed, kept);
    return kept;
  }

  async function prepareInstall({ previousVersion, targetVersion, downloadedFile }) {
    if (!downloadedFile || !fs.existsSync(downloadedFile)) throw new Error('The downloaded installer is unavailable. Download the update again.');
    await fsp.mkdir(directory, { recursive: true });
    const targetInstaller = path.join(directory, `candidate-${safeVersion(targetVersion)}.exe`);
    await fsp.copyFile(downloadedFile, targetInstaller);
    let rollbackInstaller = await previousInstaller(previousVersion);
    const rollbackProblem = rollbackInstaller ? await verifyInstaller(rollbackInstaller) : 'No installer for the current version is cached.';
    if (rollbackProblem) rollbackInstaller = null;
    await atomicJson(pendingFile, { schemaVersion: 1, previousVersion, targetVersion, targetInstaller, rollbackInstaller, attempts: 0, preparedAt: new Date().toISOString() });
    return { prepared: true, rollbackReady: !!rollbackInstaller, ...(rollbackProblem ? { rollbackProblem } : {}) };
  }

  async function beginStartup(currentVersion) {
    const pending = await readJson(pendingFile);
    if (!pending || pending.targetVersion !== currentVersion) return { state: 'not-pending' };
    pending.attempts = Number(pending.attempts || 0) + 1;
    pending.lastAttemptAt = new Date().toISOString();
    await atomicJson(pendingFile, pending);
    if (pending.attempts < 2) return { state: 'verifying', attempts: pending.attempts };
    if (!pending.rollbackInstaller || !fs.existsSync(pending.rollbackInstaller)) return { state: 'safe-mode', attempts: pending.attempts, message: 'The update did not pass its startup check and no previous signed installer is cached. Automatic updates are paused.' };
    // Never run an installer whose signature no longer checks out.
    const problem = await verifyInstaller(pending.rollbackInstaller);
    if (problem) return { state: 'safe-mode', attempts: pending.attempts, message: `The update did not pass its startup check and the previous installer failed verification (${problem}). Automatic updates are paused.` };
    launchInstaller(pending.rollbackInstaller);
    return { state: 'rollback-started', attempts: pending.attempts, version: pending.previousVersion };
  }

  async function confirmHealthy(currentVersion) {
    const pending = await readJson(pendingFile);
    if (!pending || pending.targetVersion !== currentVersion) return { confirmed: false };
    const installer = path.join(directory, `last-known-good-${safeVersion(currentVersion)}.exe`);
    await fsp.copyFile(pending.targetInstaller, installer);
    await atomicJson(goodFile, { schemaVersion: 1, version: currentVersion, installer, confirmedAt: new Date().toISOString() });
    await fsp.unlink(pendingFile);
    return { confirmed: true, version: currentVersion, rollbackReady: true };
  }

  return { prepareInstall, beginStartup, confirmHealthy };
}

module.exports = { createUpdateHealth, INSTALLED_DIRECTORY, installedInstallerName };
