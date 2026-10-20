import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = require('./release-runtime-pin.json');
const replayPin = require('./replay-runtime-pin.json');
const requireBundled = process.argv.includes('--require-bundled');
const failures = [];
const versions = {
  appVersion: require('../package.json').version,
  electron: require('../node_modules/electron/package.json').version,
  electronBuilder: require('../node_modules/electron-builder/package.json').version,
  sharp: require('../node_modules/sharp/package.json').version,
  ffmpegStatic: require('../node_modules/ffmpeg-static/package.json').version,
  ffprobeStatic: require('../node_modules/ffprobe-static/package.json').version,
  youtubeDlExec: require('../node_modules/youtube-dl-exec/package.json').version,
};

for (const [name, expected] of Object.entries(pin)) {
  if (name === 'schemaVersion' || name === 'windowsX64') continue;
  if (versions[name] !== expected) failures.push(`${name} is ${versions[name] || 'missing'}, expected ${expected}`);
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function verifyFile(label, file, expected) {
  if (!fs.existsSync(file)) return failures.push(`${label} is missing: ${file}`);
  const actual = sha256(file);
  if (actual !== expected) failures.push(`${label} hash is ${actual}, expected ${expected}`);
}

if (process.platform === 'win32') {
  verifyFile('ffmpeg', path.join(root, 'node_modules/ffmpeg-static/ffmpeg.exe'), pin.windowsX64.ffmpegSha256);
  verifyFile('ffprobe', require('../node_modules/ffprobe-static').path, pin.windowsX64.ffprobeSha256);
  verifyFile('yt-dlp', path.join(root, 'node_modules/youtube-dl-exec/bin/yt-dlp.exe'), pin.windowsX64.ytDlpSha256);
  verifyFile('sharp native module', path.join(root, 'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.5.node'), pin.windowsX64.sharpSha256);
}

const runtimeRoot = path.join(root, 'replay-runtime');
if (requireBundled) {
  const manifestFile = path.join(runtimeRoot, 'runtime-manifest.json');
  if (!fs.existsSync(manifestFile)) failures.push('replay runtime manifest is missing');
  else {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
    const expected = {
      vrfkit: { version: replayPin.version, commit: replayPin.commit, sha256: replayPin.windowsX64ExeSha256 },
      python: { version: replayPin.python.version, sha256: replayPin.python.windowsX64ExeSha256, archiveSha256: replayPin.python.windowsX64EmbedZipSha256 },
      pyarrow: { version: replayPin.pyarrow.version, wheel: replayPin.pyarrow.windowsCp312X64Wheel, wheelSha256: replayPin.pyarrow.windowsCp312X64WheelSha256 },
    };
    for (const component of Object.keys(expected)) for (const [field, value] of Object.entries(expected[component])) if (manifest?.[component]?.[field] !== value) failures.push(`${component}.${field} does not match the release pin`);
  }
  verifyFile('vrfkit', path.join(runtimeRoot, 'vrfkit/vrfkit.exe'), replayPin.windowsX64ExeSha256);
  verifyFile('embedded Python', path.join(runtimeRoot, 'python/python.exe'), replayPin.python.windowsX64ExeSha256);
}

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ passed: true, versions, replayRuntime: requireBundled ? replayPin.version : 'not-required' }, null, 2));
