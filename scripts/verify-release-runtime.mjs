// node scripts/verify-release-runtime.mjs                    # versions, lockfile integrity, Electron checksum; Windows: node_modules hashes
// node scripts/verify-release-runtime.mjs --require-bundled  # also the staged replay-runtime folder
// node scripts/verify-release-runtime.mjs --packaged <dir>   # also every bundled file inside a win-unpacked build
// Writes release/release-evidence/runtime-<version>.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { VERSION_FIELDS, bundledEvidence, electronChecksumFailures, lockIntegrityFailures, ytDlpReleaseFailures } from './runtime-pin-check.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = require('./release-runtime-pin.json');
const replayPin = require('./replay-runtime-pin.json');
const requireBundled = process.argv.includes('--require-bundled');
const packagedIndex = process.argv.indexOf('--packaged');
const packagedDirectory = packagedIndex >= 0 ? path.resolve(process.argv[packagedIndex + 1] || 'release/win-unpacked') : null;
const failures = [];

const appVersion = require('../package.json').version;
if (appVersion !== pin.appVersion) failures.push(`appVersion is ${appVersion}, expected ${pin.appVersion}`);
const versions = { appVersion };
for (const [field, name] of Object.entries(VERSION_FIELDS)) {
  versions[field] = require(`../node_modules/${name}/package.json`).version;
  if (versions[field] !== pin[field]) failures.push(`${field} is ${versions[field] || 'missing'}, expected ${pin[field]}`);
}
failures.push(...lockIntegrityFailures(JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages, pin));
failures.push(...electronChecksumFailures(require('../node_modules/electron/checksums.json'), pin));
failures.push(...ytDlpReleaseFailures(pin));

const evidence = { schemaVersion: 1, appVersion, platform: process.platform, versions, ytDlpRelease: pin.ytDlpRelease, npmIntegrity: pin.npmIntegrity, electronZipSha256: pin.windowsX64.electronZipSha256, checkout: null, packaged: null };
if (process.platform === 'win32') {
  const checkout = bundledEvidence(root, pin, replayPin, { packaged: false });
  // Without --require-bundled the replay runtime may not be staged yet.
  const replayFailures = item => /^(vrfkit|python|pyarrow|replay runtime)/.test(item);
  failures.push(...checkout.failures.filter(item => requireBundled || !replayFailures(item)));
  evidence.checkout = checkout;
} else if (requireBundled) failures.push('--require-bundled checks Windows executables and needs Windows');
if (packagedDirectory) {
  const packaged = bundledEvidence(path.join(packagedDirectory, 'resources'), pin, replayPin, { packaged: true });
  failures.push(...packaged.failures.map(item => `packaged ${item}`));
  evidence.packaged = { directory: packagedDirectory, ...packaged };
}

evidence.passed = failures.length === 0;
evidence.failures = failures;
const output = path.join(root, 'release', 'release-evidence', `runtime-${appVersion}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
if (failures.length) { console.error(JSON.stringify({ passed: false, failures, output }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ passed: true, versions, ytDlpRelease: pin.ytDlpRelease, replayRuntime: requireBundled || packagedDirectory ? replayPin.version : 'not-required', output }, null, 2));
