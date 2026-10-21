// Checks that every runtime the Windows app ships is pinned to an exact source
// and hash: npm packages by lockfile integrity, the Electron download by its
// checksums.json entry, and each bundled executable by SHA-256, in the
// checkout and inside a packaged win-unpacked folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const VERSION_FIELDS = { electron: 'electron', electronBuilder: 'electron-builder', sharp: 'sharp', ffmpegStatic: 'ffmpeg-static', ffprobeStatic: 'ffprobe-static', youtubeDlExec: 'youtube-dl-exec' };

export function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

/** Each pinned npm package must resolve, in package-lock.json, to exactly the pinned tarball. */
export function lockIntegrityFailures(lockPackages, pin) {
  const failures = [];
  const pinned = pin.npmIntegrity || {};
  for (const name of [...Object.values(VERSION_FIELDS), 'app-builder-lib', 'electron-updater', '@img/sharp-win32-x64']) if (!pinned[name]) failures.push(`${name} has no pinned npm integrity`);
  for (const [name, integrity] of Object.entries(pinned)) {
    const entry = lockPackages[`node_modules/${name}`];
    if (!entry) failures.push(`${name} is not in package-lock.json`);
    else if (entry.integrity !== integrity) failures.push(`${name} lockfile integrity does not match the pin`);
    else if (!/^https:\/\/registry\.npmjs\.org\//.test(String(entry.resolved || ''))) failures.push(`${name} does not resolve from the npm registry`);
  }
  for (const [field, name] of Object.entries(VERSION_FIELDS)) if (lockPackages[`node_modules/${name}`]?.version !== pin[field]) failures.push(`${name} lockfile version is ${lockPackages[`node_modules/${name}`]?.version || 'missing'}, expected ${pin[field]}`);
  return failures;
}

/** Electron's installer downloads its zip and checks it against checksums.json; that entry must be the pinned one. */
export function electronChecksumFailures(checksums, pin) {
  const name = `electron-v${pin.electron}-win32-x64.zip`;
  if (!pin.windowsX64?.electronZipSha256) return ['the Electron win32-x64 zip has no pinned SHA-256'];
  return checksums?.[name] === pin.windowsX64.electronZipSha256 ? [] : [`${name} checksum does not match the pin`];
}

/** yt-dlp must come from one dated release, never "latest". */
export function ytDlpReleaseFailures(pin) {
  return /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(String(pin.ytDlpRelease || '')) ? [] : [`yt-dlp release "${pin.ytDlpRelease || ''}" is not a dated release tag`];
}

/** The bundled executables a Windows build carries, relative to a checkout or to win-unpacked/resources. */
export function bundledFiles(pin, replayPin, { packaged }) {
  const modules = packaged ? 'app.asar.unpacked/node_modules' : 'node_modules';
  return [
    { component: 'ffmpeg', version: pin.ffmpegStatic, file: `${modules}/ffmpeg-static/ffmpeg.exe`, sha256: pin.windowsX64.ffmpegSha256 },
    { component: 'ffprobe', version: pin.ffprobeStatic, file: `${modules}/ffprobe-static/bin/win32/x64/ffprobe.exe`, sha256: pin.windowsX64.ffprobeSha256 },
    { component: 'yt-dlp', version: pin.ytDlpRelease, file: `${modules}/youtube-dl-exec/bin/yt-dlp.exe`, sha256: pin.windowsX64.ytDlpSha256 },
    { component: 'sharp', version: pin.sharp, file: `${modules}/@img/sharp-win32-x64/lib/sharp-win32-x64-${pin.sharp}.node`, sha256: pin.windowsX64.sharpSha256 },
    { component: 'vrfkit', version: replayPin.version, file: 'replay-runtime/vrfkit/vrfkit.exe', sha256: replayPin.windowsX64ExeSha256 },
    { component: 'python', version: replayPin.python.version, file: 'replay-runtime/python/python.exe', sha256: replayPin.python.windowsX64ExeSha256 },
  ];
}

/** Hashes every bundled file under `base` and checks the replay runtime manifest and the installed pyarrow. */
export function bundledEvidence(base, pin, replayPin, { packaged }) {
  const failures = [];
  const files = bundledFiles(pin, replayPin, { packaged }).map(item => {
    const file = path.join(base, item.file);
    const actual = fs.existsSync(file) ? sha256File(file) : null;
    if (!actual) failures.push(`${item.component} is missing: ${item.file}`);
    else if (actual !== item.sha256) failures.push(`${item.component} hash is ${actual}, expected ${item.sha256}`);
    return { ...item, actualSha256: actual };
  });
  const manifestFile = path.join(base, 'replay-runtime', 'runtime-manifest.json');
  let manifest = null;
  if (!fs.existsSync(manifestFile)) failures.push('replay runtime manifest is missing');
  else {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^﻿/, ''));
    const expected = {
      vrfkit: { version: replayPin.version, commit: replayPin.commit, sha256: replayPin.windowsX64ExeSha256 },
      python: { version: replayPin.python.version, sha256: replayPin.python.windowsX64ExeSha256, archiveSha256: replayPin.python.windowsX64EmbedZipSha256 },
      pyarrow: { version: replayPin.pyarrow.version, wheel: replayPin.pyarrow.windowsCp312X64Wheel, wheelSha256: replayPin.pyarrow.windowsCp312X64WheelSha256 },
    };
    for (const component of Object.keys(expected)) for (const [field, value] of Object.entries(expected[component])) if (manifest?.[component]?.[field] !== value) failures.push(`${component}.${field} does not match the release pin`);
  }
  const pyarrowRecord = path.join(base, 'replay-runtime', 'python', 'Lib', 'site-packages', `pyarrow-${replayPin.pyarrow.version}.dist-info`, 'RECORD');
  if (!fs.existsSync(pyarrowRecord)) failures.push(`pyarrow ${replayPin.pyarrow.version} is not installed in the bundled Python`);
  return { files, manifest, pyarrow: { version: replayPin.pyarrow.version, recordSha256: fs.existsSync(pyarrowRecord) ? sha256File(pyarrowRecord) : null }, failures };
}
