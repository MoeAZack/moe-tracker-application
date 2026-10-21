// Rollback drill for the first automatic update: version A was installed
// from its own installer (so no update has ever been confirmed healthy), the
// app updates to B, B fails its startup check twice, and A's installer must be
// the one launched to roll back.
//
//   node scripts/release-update-rollback-drill.cjs            # update-health drill on the two installers
//   node scripts/release-update-rollback-drill.cjs --install  # Windows: also really install A, upgrade to B, roll back to A
//   node scripts/release-update-rollback-drill.cjs --signed   # require Authenticode signatures from update-trust.json
//
// Installers come from release/Moe-Tracker-Application-<version>-Setup.exe;
// MOETRACKER_PREVIOUS_VERSION names A (B is package.json's version).
// Unsigned builds are checked against the SHA-256 of the two installers given
// here, so a swapped or altered rollback installer still fails the drill.
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createUpdateHealth, INSTALLED_DIRECTORY, installedInstallerName } = require('../desktop/update-health.cjs');
const { createUpdateTrust } = require('../desktop/update-trust.cjs');

const currentVersion = process.env.MOETRACKER_CURRENT_VERSION || require('../package.json').version;
const previousVersion = process.env.MOETRACKER_PREVIOUS_VERSION || '0.1.78';
const realInstall = process.argv.includes('--install');
const requireSigned = process.argv.includes('--signed');
const currentInstaller = path.resolve(`release/Moe-Tracker-Application-${currentVersion}-Setup.exe`);
const previousInstaller = path.resolve(`release/Moe-Tracker-Application-${previousVersion}-Setup.exe`);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function installerVerifier() {
  if (requireSigned) return { mode: 'authenticode', verify: createUpdateTrust().verify };
  const pinned = new Set([sha256(previousInstaller), sha256(currentInstaller)]);
  return { mode: 'sha256-pinned (unsigned build)', verify: async file => fs.existsSync(file) && pinned.has(sha256(file)) ? null : 'The installer does not match either drill installer.' };
}

/** Runs an NSIS installer silently into `directory` and waits for it. */
function runInstaller(installer, directory) {
  const result = spawnSync(installer, ['/S', `/D=${directory}`], { stdio: 'inherit', windowsHide: true, timeout: 10 * 60 * 1000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(installer)} exited with ${result.status}.`);
}

function installedVersion(directory) {
  const exe = path.join(directory, 'Moe Tracker Application.exe');
  if (!fs.existsSync(exe)) return null;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:MOETRACKER_EXE).VersionInfo.ProductVersion'], { encoding: 'utf8', env: { ...process.env, MOETRACKER_EXE: exe }, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The update folder the installed app (and desktop/installer.nsh) uses. */
function liveUpdatesDirectory() {
  return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'moe-tracker-application', 'Local Workspace', 'Updates');
}

const installedCopies = directory => { try { return fs.readdirSync(path.join(directory, INSTALLED_DIRECTORY)).filter(name => name.endsWith('.exe')).sort(); } catch { return []; } };

async function simulatedDrill(verifier, failures) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moetracker-rollback-drill-'));
  try {
    // What desktop/installer.nsh leaves behind after installing A.
    await fsp.mkdir(path.join(directory, INSTALLED_DIRECTORY), { recursive: true });
    await fsp.copyFile(previousInstaller, path.join(directory, INSTALLED_DIRECTORY, installedInstallerName(previousVersion)));
    const launched = [];
    const health = createUpdateHealth({ directory, launchInstaller: installer => launched.push(installer), verifyInstaller: verifier.verify });
    const prepared = await health.prepareInstall({ previousVersion, targetVersion: currentVersion, downloadedFile: currentInstaller });
    // Installing B replaces the installed/ copy.
    await fsp.rm(path.join(directory, INSTALLED_DIRECTORY), { recursive: true, force: true });
    const firstStartup = await health.beginStartup(currentVersion);
    const rollback = await health.beginStartup(currentVersion);
    const launchedSha256 = launched.length === 1 ? sha256(launched[0]) : null;
    if (!prepared.rollbackReady) failures.push(`first update had no rollback installer (${prepared.rollbackProblem || 'unknown'})`);
    if (firstStartup.state !== 'verifying') failures.push('candidate startup verification was not armed');
    if (rollback.state !== 'rollback-started' || rollback.version !== previousVersion || launched.length !== 1) failures.push('second failed startup did not launch exactly one rollback installer');
    if (launchedSha256 && launchedSha256 !== sha256(previousInstaller)) failures.push('the rollback launched an installer other than the previously installed version');

    // A tampered rollback installer must not run.
    const tamperDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moetracker-rollback-tamper-'));
    try {
      await fsp.mkdir(path.join(tamperDirectory, INSTALLED_DIRECTORY), { recursive: true });
      await fsp.copyFile(previousInstaller, path.join(tamperDirectory, INSTALLED_DIRECTORY, installedInstallerName(previousVersion)));
      const tamperLaunches = [];
      const tampered = createUpdateHealth({ directory: tamperDirectory, launchInstaller: installer => tamperLaunches.push(installer), verifyInstaller: verifier.verify });
      await tampered.prepareInstall({ previousVersion, targetVersion: currentVersion, downloadedFile: currentInstaller });
      const pending = JSON.parse(await fsp.readFile(path.join(tamperDirectory, 'pending-health.json'), 'utf8'));
      if (pending.rollbackInstaller) await fsp.appendFile(pending.rollbackInstaller, 'tampered');
      await tampered.beginStartup(currentVersion);
      const tamperRollback = await tampered.beginStartup(currentVersion);
      if (tamperRollback.state !== 'safe-mode' || tamperLaunches.length) failures.push('a tampered rollback installer was launched');
      return { prepared, firstStartup, rollback, rollbackLaunches: launched.length, launchedSha256, tamperedRollback: { state: tamperRollback.state, launches: tamperLaunches.length } };
    } finally { await fsp.rm(tamperDirectory, { recursive: true, force: true }); }
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
}

async function installedDrill(verifier, failures) {
  if (process.platform !== 'win32') throw new Error('--install runs the real installers and needs Windows.');
  const installDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moetracker-install-drill-'));
  const updates = liveUpdatesDirectory();
  const steps = {};
  runInstaller(previousInstaller, installDirectory);
  steps.installed = { version: installedVersion(installDirectory), installerCopies: installedCopies(updates) };
  if (steps.installed.version !== previousVersion) failures.push(`fresh install reports ${steps.installed.version}, expected ${previousVersion}`);
  if (!steps.installed.installerCopies.includes(installedInstallerName(previousVersion))) failures.push('the installer did not leave a copy of itself for rollback');

  const launched = [];
  const health = createUpdateHealth({ directory: updates, launchInstaller: installer => { launched.push(installer); runInstaller(installer, installDirectory); }, verifyInstaller: verifier.verify });
  steps.prepared = await health.prepareInstall({ previousVersion, targetVersion: currentVersion, downloadedFile: currentInstaller });
  if (!steps.prepared.rollbackReady) failures.push(`first update had no rollback installer (${steps.prepared.rollbackProblem || 'unknown'})`);
  runInstaller(currentInstaller, installDirectory);
  steps.upgraded = { version: installedVersion(installDirectory), installerCopies: installedCopies(updates) };
  if (steps.upgraded.version !== currentVersion) failures.push(`upgrade reports ${steps.upgraded.version}, expected ${currentVersion}`);
  if (steps.upgraded.installerCopies.join() !== installedInstallerName(currentVersion)) failures.push(`after upgrade the installer copies are ${steps.upgraded.installerCopies.join(', ') || 'missing'}`);

  steps.firstStartup = await health.beginStartup(currentVersion);
  steps.rollback = await health.beginStartup(currentVersion);
  steps.rolledBack = { version: installedVersion(installDirectory), launches: launched.length };
  if (steps.rollback.state !== 'rollback-started' || launched.length !== 1) failures.push('second failed startup did not launch exactly one rollback installer');
  if (steps.rolledBack.version !== previousVersion) failures.push(`rollback left ${steps.rolledBack.version} installed, expected ${previousVersion}`);
  const uninstaller = path.join(installDirectory, `Uninstall Moe Tracker Application.exe`);
  if (fs.existsSync(uninstaller)) spawnSync(uninstaller, ['/S'], { stdio: 'inherit', windowsHide: true, timeout: 5 * 60 * 1000 });
  return steps;
}

(async () => {
  for (const file of [previousInstaller, currentInstaller]) if (!fs.existsSync(file)) throw new Error(`Installer required for rollback drill is missing: ${file}`);
  const verifier = installerVerifier();
  const failures = [];
  const simulated = await simulatedDrill(verifier, failures);
  const installed = realInstall ? await installedDrill(verifier, failures) : null;
  const evidence = { schemaVersion: 2, passed: failures.length === 0, scenario: 'first update, no prior healthy update', signatureCheck: verifier.mode, previousVersion, currentVersion, previousInstallerSha256: sha256(previousInstaller), currentInstallerSha256: sha256(currentInstaller), simulated, installed, failures };
  const output = path.resolve(`release/release-evidence/update-rollback-${currentVersion}.json`); await fsp.mkdir(path.dirname(output), { recursive: true }); await fsp.writeFile(output, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, output }, null, 2));
  if (failures.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
