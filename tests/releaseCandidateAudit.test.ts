import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { inspectAuthenticode, signatureFailures } from '../scripts/release-candidate-signatures.mjs';

const publisher = 'CN=Moe Tracker Publisher, O=Moe Tracker Publisher, C=EG';
const files = ['C:\\release\\Moe-Tracker-Application-0.2.0-Setup.exe', 'C:\\release\\win-unpacked\\Moe Tracker Application.exe'];
const valid = files.map(file => ({ path: file, status: 'Valid', subject: publisher }));

/** A throwaway candidate checkout: package.json, a fake installer and a matching latest.yml. */
function candidateCheckout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moetracker-candidate-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'moe-tracker-application', version: '0.2.0' }));
  fs.writeFileSync(path.join(root, '.gitignore'), 'release/\n');
  const installer = path.join(root, 'release', 'Moe-Tracker-Application-0.2.0-Setup.exe');
  fs.mkdirSync(path.join(root, 'release', 'win-unpacked'), { recursive: true });
  fs.writeFileSync(installer, 'unsigned installer');
  fs.writeFileSync(`${installer}.blockmap`, 'blockmap');
  fs.writeFileSync(path.join(root, 'release', 'win-unpacked', 'Moe Tracker Application.exe'), 'unsigned app');
  fs.writeFileSync(path.join(root, 'release', 'latest.yml'), `version: 0.2.0\nsha512: ${crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('base64')}\n`);
  for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.email=audit@example.test', '-c', 'user.name=Audit', 'commit', '-q', '-m', 'candidate']]) execFileSync('git', args, { cwd: root });
  return root;
}

function audit(root: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'release-candidate-audit.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, evidence: JSON.parse(fs.readFileSync(path.join(root, 'release', 'release-evidence', 'candidate-0.2.0.json'), 'utf8')) };
}

describe('release candidate signature policy', () => {
  it('cannot approve a signed candidate off Windows', () => {
    expect(signatureFailures({ requireSigned: true, platform: 'linux', expectedFiles: files, signatures: [], publisherNames: [publisher] })).toEqual([expect.stringContaining('only be verified on Windows')]);
    expect(signatureFailures({ requireSigned: false, platform: 'linux', expectedFiles: files, signatures: [], publisherNames: [] })).toEqual([]);
  });

  it('needs every expected file Valid and from a trusted publisher', () => {
    expect(signatureFailures({ requireSigned: true, platform: 'win32', expectedFiles: files, signatures: valid, publisherNames: [publisher] })).toEqual([]);
    expect(signatureFailures({ requireSigned: true, platform: 'win32', expectedFiles: files, signatures: valid, publisherNames: [] })).toEqual([expect.stringContaining('No trusted publisher')]);
    expect(signatureFailures({ requireSigned: true, platform: 'win32', expectedFiles: files, signatures: valid.slice(0, 1), publisherNames: [publisher] })).toEqual([expect.stringContaining('could not be read')]);
    expect(signatureFailures({ requireSigned: true, platform: 'win32', expectedFiles: files, signatures: [valid[0], { ...valid[1], subject: 'CN=Someone Else' }], publisherNames: [publisher] })).toEqual([expect.stringContaining('does not trust')]);
    expect(signatureFailures({ requireSigned: true, platform: 'win32', expectedFiles: files, signatures: [{ ...valid[0], status: 'NotSigned' }, valid[1]], publisherNames: [publisher] })).toEqual([expect.stringContaining('NotSigned')]);
    expect(signatureFailures({ requireSigned: true, platform: 'win32', expectedFiles: files, signatures: [], publisherNames: [publisher], inspectionError: 'pwsh not found' })).toEqual(['Authenticode inspection failed: pwsh not found']);
  });

  it('falls back to Windows PowerShell only when pwsh is not installed', () => {
    const enoent = { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync pwsh ENOENT'), { code: 'ENOENT' }) };
    const records = files.map(file => ({ path: file, status: 'NotSigned', subject: null }));
    const ok = { status: 0, stdout: JSON.stringify(records), stderr: '' };
    const calls: string[] = [];
    const spawn = (responses: Record<string, object>) => (shell: string) => { calls.push(shell); return responses[shell]; };

    expect(inspectAuthenticode('a.ps1', files, spawn({ pwsh: enoent, 'powershell.exe': ok }))).toEqual({ signatures: records, inspectionError: null });
    expect(calls).toEqual(['pwsh', 'powershell.exe']);

    // A pwsh that starts and fails is reported, never retried with another shell.
    calls.length = 0;
    expect(inspectAuthenticode('a.ps1', files, spawn({ pwsh: { status: 1, stdout: '', stderr: 'boom' }, 'powershell.exe': ok }))).toEqual({ signatures: [], inspectionError: 'pwsh: boom' });
    expect(calls).toEqual(['pwsh']);

    expect(inspectAuthenticode('a.ps1', files, spawn({ pwsh: enoent, 'powershell.exe': enoent }))).toEqual({ signatures: [], inspectionError: 'no PowerShell found (pwsh, powershell.exe)' });
    expect(inspectAuthenticode('a.ps1', files, spawn({ pwsh: { status: 0, stdout: 'not json', stderr: '' } })).inspectionError).toBe('pwsh: unreadable output');
  });

  it('fails the inspection on output that is not one known-status record per file', () => {
    const run = (stdout: unknown) => inspectAuthenticode('a.ps1', files, () => ({ status: 0, stdout: JSON.stringify(stdout), stderr: '' })).inspectionError;
    const records = files.map(file => ({ path: file, status: 'NotSigned', subject: null }));
    expect(run(records)).toBeNull();
    // What Windows PowerShell 5.1 printed for the old script: one record holding both paths.
    expect(run([{ path: { value: files, Count: 2 }, status: 'System.Object[]', subject: null }])).toBe('pwsh: expected 2 signature records, got 1');
    expect(run([records[0], { ...records[1], path: { value: [files[1]], Count: 1 } }])).toMatch(/expected one signature record for .*Moe Tracker Application\.exe, got 0/);
    expect(run([records[0], records[0]])).toMatch(/got 2/);
    expect(run([records[0], { ...records[1], status: 'System.Object[]' }])).toMatch(/unknown signature status/);
  });

  it.skipIf(process.platform === 'win32')('fails the signed audit run off Windows instead of passing it', () => {
    const root = candidateCheckout();
    try {
      const signed = audit(root, '--require-signed');
      expect(signed.status).toBe(1);
      expect(signed.evidence).toMatchObject({ publicReady: false, signedPublicCandidate: false, localCandidateReady: true, signatureCheck: 'not-run-off-windows' });
      expect(signed.evidence.failures).toEqual([expect.stringContaining('only be verified on Windows')]);
      // The unsigned local audit still passes and never claims public readiness.
      const local = audit(root);
      expect(local.status).toBe(0);
      expect(local.evidence).toMatchObject({ publicReady: false, signedPublicCandidate: false, localCandidateReady: true });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
