// Puts the pinned yt-dlp release into youtube-dl-exec's bin folder.
// youtube-dl-exec's own postinstall downloads whatever release is "latest";
// CI skips that (YOUTUBE_DL_SKIP_DOWNLOAD) and this script fetches one named
// release instead, refusing it unless its SHA-256 matches release-runtime-pin.json.
// Windows only: the desktop app ships yt-dlp.exe; elsewhere it does nothing.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pin = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'release-runtime-pin.json'), 'utf8'));

export function ytDlpDownloadUrl(release) {
  if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(String(release || ''))) throw new Error(`yt-dlp release must be a dated tag such as 2026.08.19, not "${release}".`);
  return `https://github.com/yt-dlp/yt-dlp/releases/download/${release}/yt-dlp.exe`;
}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export async function stageYtDlp({ platform = process.platform, target = path.join(root, 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe'), fetchImpl = fetch } = {}) {
  if (platform !== 'win32') return { staged: false, reason: 'yt-dlp.exe is only bundled on Windows' };
  const expected = pin.windowsX64.ytDlpSha256;
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === expected) return { staged: true, release: pin.ytDlpRelease, sha256: expected, downloaded: false };
  const url = ytDlpDownloadUrl(pin.ytDlpRelease);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`yt-dlp ${pin.ytDlpRelease} download failed (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== expected) throw new Error(`yt-dlp ${pin.ytDlpRelease} hash is ${actual}, expected ${expected}. Nothing was installed.`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.yt-dlp-${process.pid}-${os.hostname()}.tmp`);
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, target);
  return { staged: true, release: pin.ytDlpRelease, sha256: actual, downloaded: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageYtDlp().then(result => console.log(JSON.stringify(result)), error => { console.error(error.message); process.exitCode = 1; });
}
