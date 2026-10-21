import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledEvidence, bundledFiles, electronChecksumFailures, lockIntegrityFailures, ytDlpReleaseFailures } from '../scripts/runtime-pin-check.mjs';
import { stageYtDlp, ytDlpDownloadUrl } from '../scripts/stage-yt-dlp.mjs';

const pin = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'release-runtime-pin.json'), 'utf8'));
const replayPin = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'replay-runtime-pin.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8')).packages;
const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

/** A fake win-unpacked resources folder whose files hash to a matching fake pin. */
function fakeBuild() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'moetracker-runtime-'));
  const fakePin = structuredClone(pin); const fakeReplay = structuredClone(replayPin);
  const contents: Record<string, string> = {};
  for (const item of bundledFiles(pin, replayPin, { packaged: true })) {
    contents[item.component] = `${item.component} bytes`;
    fs.mkdirSync(path.dirname(path.join(base, item.file)), { recursive: true });
    fs.writeFileSync(path.join(base, item.file), contents[item.component]);
  }
  Object.assign(fakePin.windowsX64, { ffmpegSha256: sha(contents.ffmpeg), ffprobeSha256: sha(contents.ffprobe), ytDlpSha256: sha(contents['yt-dlp']), sharpSha256: sha(contents.sharp) });
  fakeReplay.windowsX64ExeSha256 = sha(contents.vrfkit); fakeReplay.python.windowsX64ExeSha256 = sha(contents.python);
  fs.writeFileSync(path.join(base, 'replay-runtime', 'runtime-manifest.json'), `﻿${JSON.stringify({ vrfkit: { version: fakeReplay.version, commit: fakeReplay.commit, sha256: fakeReplay.windowsX64ExeSha256 }, python: { version: fakeReplay.python.version, sha256: fakeReplay.python.windowsX64ExeSha256, archiveSha256: fakeReplay.python.windowsX64EmbedZipSha256 }, pyarrow: { version: fakeReplay.pyarrow.version, wheel: fakeReplay.pyarrow.windowsCp312X64Wheel, wheelSha256: fakeReplay.pyarrow.windowsCp312X64WheelSha256 } })}`);
  const record = path.join(base, 'replay-runtime', 'python', 'Lib', 'site-packages', `pyarrow-${fakeReplay.pyarrow.version}.dist-info`, 'RECORD');
  fs.mkdirSync(path.dirname(record), { recursive: true }); fs.writeFileSync(record, 'pyarrow/__init__.py,sha256=x,1\n');
  return { base, fakePin, fakeReplay };
}

describe('runtime pins', () => {
  it('pins every shipped npm runtime to its exact registry tarball', () => {
    expect(lockIntegrityFailures(lock, pin)).toEqual([]);
    const tampered = structuredClone(lock);
    tampered['node_modules/ffmpeg-static'].integrity = 'sha512-different';
    tampered['node_modules/sharp'].resolved = 'https://example.test/sharp.tgz';
    expect(lockIntegrityFailures(tampered, pin)).toEqual(['sharp does not resolve from the npm registry', 'ffmpeg-static lockfile integrity does not match the pin']);
    const unpinned = structuredClone(pin); delete unpinned.npmIntegrity['electron-builder'];
    expect(lockIntegrityFailures(lock, unpinned)).toContain('electron-builder has no pinned npm integrity');
  });

  it('pins the Electron download and a dated yt-dlp release', () => {
    expect(electronChecksumFailures(JSON.parse(fs.readFileSync(path.join(process.cwd(), 'node_modules', 'electron', 'checksums.json'), 'utf8')), pin)).toEqual([]);
    expect(electronChecksumFailures({ [`electron-v${pin.electron}-win32-x64.zip`]: 'f'.repeat(64) }, pin)).toHaveLength(1);
    expect(ytDlpReleaseFailures(pin)).toEqual([]);
    expect(ytDlpReleaseFailures({ ...pin, ytDlpRelease: 'latest' })).toHaveLength(1);
    expect(() => ytDlpDownloadUrl('latest')).toThrow('dated tag');
    expect(ytDlpDownloadUrl('2026.08.19')).toBe('https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe');
  });

  it('hashes every bundled executable in a packaged build and names any that differ', () => {
    const { base, fakePin, fakeReplay } = fakeBuild();
    try {
      const good = bundledEvidence(base, fakePin, fakeReplay, { packaged: true });
      expect(good.failures).toEqual([]);
      expect(good.files.map(item => item.component)).toEqual(['ffmpeg', 'ffprobe', 'yt-dlp', 'sharp', 'vrfkit', 'python']);
      fs.appendFileSync(path.join(base, 'app.asar.unpacked/node_modules/youtube-dl-exec/bin/yt-dlp.exe'), 'newer release');
      fs.rmSync(path.join(base, 'replay-runtime/python/Lib/site-packages', `pyarrow-${fakeReplay.pyarrow.version}.dist-info`), { recursive: true });
      const bad = bundledEvidence(base, fakePin, { ...fakeReplay, commit: 'other' }, { packaged: true });
      expect(bad.failures).toEqual([expect.stringMatching(/^yt-dlp hash is/), 'vrfkit.commit does not match the release pin', `pyarrow ${fakeReplay.pyarrow.version} is not installed in the bundled Python`]);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
});

describe('pinned yt-dlp staging', () => {
  it('installs only bytes that match the pinned hash, from the pinned release', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moetracker-ytdlp-'));
    const target = path.join(dir, 'bin', 'yt-dlp.exe');
    try {
      const urls: string[] = [];
      const wrong = async (url: string) => { urls.push(url); return new Response('some other yt-dlp'); };
      await expect(stageYtDlp({ platform: 'win32', target, fetchImpl: wrong as typeof fetch })).rejects.toThrow('Nothing was installed');
      expect(fs.existsSync(target)).toBe(false);
      expect(urls).toEqual([`https://github.com/yt-dlp/yt-dlp/releases/download/${pin.ytDlpRelease}/yt-dlp.exe`]);
      expect(await stageYtDlp({ platform: 'linux', target, fetchImpl: wrong as typeof fetch })).toMatchObject({ staged: false });
      const failing = async () => new Response('', { status: 404 });
      await expect(stageYtDlp({ platform: 'win32', target, fetchImpl: failing as typeof fetch })).rejects.toThrow('HTTP 404');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
