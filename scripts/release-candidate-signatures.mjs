import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateSignature } = require('../desktop/update-trust.cjs');

/**
 * Signature failures for a release candidate. A signed public candidate needs
 * every expected file inspected on Windows, Valid, and signed by a publisher in
 * desktop/update-trust.json; anything not proven counts as a failure.
 */
export function signatureFailures({ requireSigned, platform, expectedFiles, signatures, publisherNames, inspectionError = null }) {
  if (!requireSigned) return [];
  if (platform !== 'win32') return ['Signatures can only be verified on Windows; this audit cannot approve a signed public candidate here.'];
  if (inspectionError) return [`Authenticode inspection failed: ${inspectionError}`];
  if (!publisherNames.length) return ['No trusted publisher is configured in desktop/update-trust.json, so no signature can be accepted.'];
  const failures = [];
  for (const file of expectedFiles) {
    const record = signatures.find(item => String(item?.path || '').toLowerCase() === file.toLowerCase());
    const problem = evaluateSignature(record || null, { publisherNames, file });
    if (problem) failures.push(`${file}: ${problem}`);
  }
  return failures;
}

const SIGNATURE_STATUSES = new Set(['Valid', 'UnknownError', 'NotSigned', 'HashMismatch', 'NotTrusted', 'NotSupportedFileFormat', 'Incompatible']);

/** Null when there is exactly one record per expected file with a known Authenticode status. */
function signatureRecordProblem(files, signatures) {
  if (signatures.length !== files.length) return `expected ${files.length} signature records, got ${signatures.length}`;
  for (const file of files) {
    const records = signatures.filter(item => typeof item?.path === 'string' && item.path.toLowerCase() === file.toLowerCase());
    if (records.length !== 1) return `expected one signature record for ${file}, got ${records.length}`;
    if (!SIGNATURE_STATUSES.has(records[0].status)) return `unknown signature status for ${file}: ${JSON.stringify(records[0].status)}`;
  }
  return null;
}

/**
 * Runs scripts/authenticode-status.ps1 and returns { signatures, inspectionError }.
 * Prefers PowerShell 7 (pwsh) and falls back to Windows PowerShell 5.1 only when
 * pwsh is not installed; any other failure of a shell that did start is reported,
 * and so is output that is not one known-status record per expected file.
 */
export function inspectAuthenticode(scriptPath, files, spawn) {
  const missing = [];
  for (const shell of ['pwsh', 'powershell.exe']) {
    const result = spawn(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-FilesJson', JSON.stringify(files)], { encoding: 'utf8' });
    if (result.error?.code === 'ENOENT') { missing.push(shell); continue; }
    if (result.status !== 0) return { signatures: [], inspectionError: `${shell}: ${(result.stderr || result.error?.message || `exit ${result.status}`).trim()}` };
    let signatures;
    try { signatures = JSON.parse(result.stdout || '[]'); } catch { return { signatures: [], inspectionError: `${shell}: unreadable output` }; }
    signatures = Array.isArray(signatures) ? signatures : [signatures];
    const malformed = signatureRecordProblem(files, signatures);
    return malformed ? { signatures, inspectionError: `${shell}: ${malformed}` } : { signatures, inspectionError: null };
  }
  return { signatures: [], inspectionError: `no PowerShell found (${missing.join(', ')})` };
}
