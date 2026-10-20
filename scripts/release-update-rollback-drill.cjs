const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createUpdateHealth } = require('../desktop/update-health.cjs');

const currentVersion = require('../package.json').version;
const previousVersion = process.env.MOETRACKER_PREVIOUS_VERSION || '0.1.78';
const currentInstaller = path.resolve(`release/Moe-Tracker-Application-${currentVersion}-Setup.exe`);
const previousInstaller = path.resolve(`release/Moe-Tracker-Application-${previousVersion}-Setup.exe`);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  for (const file of [previousInstaller, currentInstaller]) if (!fs.existsSync(file)) throw new Error(`Installer required for rollback drill is missing: ${file}`);
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'moetracker-rollback-drill-'));
  const launched = [];
  try {
    const health = createUpdateHealth({ directory, launchInstaller: installer => launched.push(installer) });
    await health.prepareInstall({ previousVersion: 'bootstrap', targetVersion: previousVersion, downloadedFile: previousInstaller });
    const previousStartup = await health.beginStartup(previousVersion);
    const promoted = await health.confirmHealthy(previousVersion);
    const prepared = await health.prepareInstall({ previousVersion, targetVersion: currentVersion, downloadedFile: currentInstaller });
    const firstStartup = await health.beginStartup(currentVersion);
    const rollback = await health.beginStartup(currentVersion);
    const failures = [];
    if (previousStartup.state !== 'verifying' || !promoted.rollbackReady) failures.push('previous installer was not promoted to last-known-good');
    if (!prepared.rollbackReady || firstStartup.state !== 'verifying') failures.push('candidate startup verification was not armed');
    if (rollback.state !== 'rollback-started' || launched.length !== 1) failures.push('second failed startup did not launch exactly one rollback installer');
    const evidence = { schemaVersion: 1, passed: failures.length === 0, previousVersion, currentVersion, previousInstallerSha256: sha256(previousInstaller), currentInstallerSha256: sha256(currentInstaller), previousStartup, promoted, prepared, firstStartup, rollback, rollbackLaunches: launched.length, failures };
    const output = path.resolve(`release/release-evidence/update-rollback-${currentVersion}.json`); await fsp.mkdir(path.dirname(output), { recursive: true }); await fsp.writeFile(output, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ ...evidence, output }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally { await fsp.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
