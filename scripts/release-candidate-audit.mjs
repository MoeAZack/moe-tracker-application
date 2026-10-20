import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const installer = path.join(root, 'release', `Moe-Tracker-Application-${pkg.version}-Setup.exe`);
const blockmap = `${installer}.blockmap`;
const latestFile = path.join(root, 'release', 'latest.yml');
const evidenceDir = path.join(root, 'release', 'release-evidence');
const requireSigned = process.argv.includes('--require-signed');
const allowDirty = process.argv.includes('--allow-dirty');
const failures = [];

for (const file of [installer, blockmap, latestFile, path.join(root, 'release/win-unpacked/Moe Tracker Application.exe')]) if (!fs.existsSync(file)) failures.push(`Missing candidate file: ${path.relative(root, file)}`);

const hash = (algorithm, file, encoding = 'hex') => crypto.createHash(algorithm).update(fs.readFileSync(file)).digest(encoding);
const latest = fs.existsSync(latestFile) ? fs.readFileSync(latestFile, 'utf8') : '';
const latestVersion = latest.match(/^version:\s*(.+)$/m)?.[1]?.trim();
const latestSha512 = latest.match(/^sha512:\s*(.+)$/m)?.[1]?.trim();
if (latestVersion !== pkg.version) failures.push(`latest.yml version is ${latestVersion || 'missing'}, expected ${pkg.version}`);
if (fs.existsSync(installer) && latestSha512 !== hash('sha512', installer, 'base64')) failures.push('latest.yml SHA-512 does not match the installer');

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
if (!allowDirty && dirty.length) failures.push(`Working tree is not clean (${dirty.length} paths)`);

let signatures = [];
if (process.platform === 'win32' && fs.existsSync(installer)) {
  const signatureFiles = [installer, path.join(root, 'release/win-unpacked/Moe Tracker Application.exe')];
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/authenticode-status.ps1'), '-FilesJson', JSON.stringify(signatureFiles)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`Authenticode inspection failed: ${result.stderr.trim()}`);
  else signatures = JSON.parse(result.stdout || '[]');
  if (!Array.isArray(signatures)) signatures = [signatures];
  if (requireSigned && signatures.some(item => item.status !== 'Valid')) failures.push('The public candidate is not signed by a valid Authenticode certificate');
}

const evidence = {
  schemaVersion: 1,
  appVersion: pkg.version,
  head,
  createdAt: new Date().toISOString(),
  installer: fs.existsSync(installer) ? { file: path.basename(installer), bytes: fs.statSync(installer).size, sha256: hash('sha256', installer), sha512: hash('sha512', installer, 'base64') } : null,
  blockmap: fs.existsSync(blockmap) ? { file: path.basename(blockmap), bytes: fs.statSync(blockmap).size, sha256: hash('sha256', blockmap) } : null,
  signatures,
  signedPublicCandidate: signatures.length > 0 && signatures.every(item => item.status === 'Valid'),
  exactHead: dirty.length === 0,
  dirtyPaths: dirty,
  publicReady: failures.length === 0 && requireSigned,
  localCandidateReady: failures.filter(item => !item.includes('not signed')).length === 0,
  failures,
};
fs.mkdirSync(evidenceDir, { recursive: true });
const output = path.join(evidenceDir, `candidate-${pkg.version}.json`);
fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, output }, null, 2));
if (failures.length) process.exitCode = 1;
