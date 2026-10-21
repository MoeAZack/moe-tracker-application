const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

// Which Authenticode publishers may ship Moe Tracker updates. electron-updater
// skips its own check when app-update.yml names no publisher, so this module
// replaces it and refuses any installer it cannot prove came from one of them.

const TRUST_FILE = path.join(__dirname, 'update-trust.json');

function loadTrustedPublishers(file = TRUST_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(parsed?.publisherNames) ? parsed.publisherNames : []).map(name => String(name || '').trim()).filter(Boolean);
  } catch { return []; }
}

function parseDn(value) {
  const parts = new Map();
  let key = '', current = '', quoted = false, readingValue = false;
  const flush = () => { if (key.trim()) parts.set(key.trim().toUpperCase(), current.trim().replace(/^"(.*)"$/, '$1')); key = ''; current = ''; readingValue = false; };
  for (const char of String(value || '')) {
    if (char === '"') { quoted = !quoted; current += char; continue; }
    if (!quoted && char === ',') { flush(); continue; }
    if (!readingValue && char === '=') { readingValue = true; continue; }
    if (readingValue) current += char; else key += char;
  }
  flush();
  return parts;
}

/** A full DN must match every part it names; a bare name must equal the signer's CN. */
function publisherMatches(subject, publisherNames) {
  const signer = parseDn(subject);
  return publisherNames.some(name => {
    if (!name.includes('=')) return !!signer.get('CN') && signer.get('CN') === name;
    const expected = parseDn(name);
    return expected.size > 0 && [...expected].every(([key, value]) => signer.get(key) === value);
  });
}

/** null when the signature is valid and from a trusted publisher; otherwise why not. */
function evaluateSignature(record, { publisherNames, file = null }) {
  if (!publisherNames?.length) return 'No trusted update publisher is configured for this build.';
  if (!record) return 'The installer signature could not be read.';
  if (file && record.path && path.normalize(String(record.path)).toLowerCase() !== path.normalize(String(file)).toLowerCase()) return 'The signature check read a different file than the installer.';
  if (record.status !== 'Valid') return `The installer signature is ${record.status || 'missing'}, not Valid.`;
  if (!record.subject || !publisherMatches(record.subject, publisherNames)) return 'The installer is signed by a publisher this build does not trust.';
  return null;
}

/** Reads one file's Authenticode status with Windows PowerShell. The path travels in the environment, never in the command text. */
function inspectAuthenticode(file, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32') return Promise.reject(new Error('Authenticode signatures can only be checked on Windows.'));
  const command = "$s = Get-AuthenticodeSignature -LiteralPath $env:MOETRACKER_SIGNED_FILE; [pscustomobject]@{ path = $s.Path; status = $s.Status.ToString(); subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null } } | ConvertTo-Json -Compress";
  return new Promise((resolve, reject) => {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command', command], { env: { ...process.env, PSModulePath: '', MOETRACKER_SIGNED_FILE: file }, timeout: 30_000, windowsHide: true }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(String(stdout || '').trim())); } catch { reject(new Error('The signature check returned unreadable output.')); }
    });
  });
}

function createUpdateTrust({ publisherNames = loadTrustedPublishers(), inspect = inspectAuthenticode } = {}) {
  const publishers = publisherNames.map(name => String(name || '').trim()).filter(Boolean);
  async function verify(file) {
    if (!publishers.length) return evaluateSignature(null, { publisherNames: publishers });
    if (!file || !fs.existsSync(file)) return 'The installer to verify is missing.';
    try { return evaluateSignature(await inspect(file), { publisherNames: publishers, file }); }
    catch (error) { return `The installer signature could not be verified: ${String(error?.message || error).slice(0, 160)}`; }
  }
  return { configured: publishers.length > 0, publisherNames: [...publishers], verify };
}

module.exports = { TRUST_FILE, loadTrustedPublishers, parseDn, publisherMatches, evaluateSignature, inspectAuthenticode, createUpdateTrust };
