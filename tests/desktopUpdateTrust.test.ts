import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { loadTrustedPublishers, publisherMatches, evaluateSignature, inspectAuthenticode, createUpdateTrust } = require('../desktop/update-trust.cjs');

const publisher = 'CN=Moe Tracker Publisher, O=Moe Tracker Publisher, C=EG';

describe('update publisher trust', () => {
  it('matches a full DN on every part and a bare name only on the CN', () => {
    expect(publisherMatches('CN=Moe Tracker Publisher, O=Moe Tracker Publisher, L=Cairo, C=EG', [publisher])).toBe(true);
    expect(publisherMatches('CN=Moe Tracker Publisher, O=Someone Else, C=EG', [publisher])).toBe(false);
    expect(publisherMatches('CN="Moe Tracker Publisher, Inc", C=EG', ['CN=Moe Tracker Publisher, Inc'])).toBe(false);
    expect(publisherMatches('CN="Moe Tracker Publisher, Inc", C=EG', ['CN="Moe Tracker Publisher, Inc"'])).toBe(true);
    expect(publisherMatches('CN=Moe Tracker Publisher Evil, C=EG', ['Moe Tracker Publisher'])).toBe(false);
    expect(publisherMatches('O=Moe Tracker Publisher', ['Moe Tracker Publisher'])).toBe(false);
  });

  it('accepts only a Valid signature from a trusted publisher on the same file', () => {
    const file = path.join(os.tmpdir(), 'update.exe');
    const good = { path: file, status: 'Valid', subject: publisher };
    expect(evaluateSignature(good, { publisherNames: [publisher], file })).toBeNull();
    expect(evaluateSignature(good, { publisherNames: [], file })).toMatch(/No trusted update publisher/);
    expect(evaluateSignature({ ...good, status: 'NotSigned', subject: null }, { publisherNames: [publisher], file })).toMatch(/NotSigned/);
    expect(evaluateSignature({ ...good, status: 'HashMismatch' }, { publisherNames: [publisher], file })).toMatch(/HashMismatch/);
    expect(evaluateSignature({ ...good, subject: 'CN=Someone Else' }, { publisherNames: [publisher], file })).toMatch(/does not trust/);
    expect(evaluateSignature({ ...good, path: path.join(os.tmpdir(), 'other.exe') }, { publisherNames: [publisher], file })).toMatch(/different file/);
    expect(evaluateSignature(null, { publisherNames: [publisher], file })).toMatch(/could not be read/);
  });

  it('fails closed when the signature cannot be inspected', async () => {
    const file = path.join(os.tmpdir(), `moetracker-trust-${process.pid}.exe`);
    fs.writeFileSync(file, 'installer');
    try {
      await expect(inspectAuthenticode(file, { platform: 'linux' })).rejects.toThrow('only be checked on Windows');
      const broken = (_cmd: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => callback(new Error('powershell.exe was not found'), '');
      await expect(inspectAuthenticode(file, { platform: 'win32', run: broken })).rejects.toThrow('not found');
      expect(await createUpdateTrust({ publisherNames: [publisher], inspect: () => inspectAuthenticode(file, { platform: 'linux' }) }).verify(file)).toMatch(/could not be verified/);
      expect(await createUpdateTrust({ publisherNames: [publisher], inspect: async () => ({ path: file, status: 'Valid', subject: publisher }) }).verify(file)).toBeNull();
      expect(await createUpdateTrust({ publisherNames: [publisher], inspect: vi.fn() }).verify(path.join(os.tmpdir(), 'missing-update.exe'))).toMatch(/missing/);
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('passes the installer path to PowerShell outside the command text', async () => {
    const file = path.join(os.tmpdir(), "it's; calc.exe");
    let seen: any;
    const run = (cmd: string, args: string[], options: any, callback: (error: Error | null, stdout: string) => void) => { seen = { cmd, args, options }; callback(null, JSON.stringify({ path: file, status: 'Valid', subject: publisher })); };
    await expect(inspectAuthenticode(file, { platform: 'win32', run })).resolves.toEqual({ path: file, status: 'Valid', subject: publisher });
    expect(seen.cmd).toBe('powershell.exe');
    expect(seen.args.join(' ')).not.toContain(file);
    expect(seen.options.env.MOETRACKER_SIGNED_FILE).toBe(file);
  });

  it('ships with no trusted publisher until a signing certificate is configured', () => {
    const file = path.join(os.tmpdir(), `moetracker-trust-${process.pid}.json`);
    try {
      expect(loadTrustedPublishers()).toEqual([]);
      fs.writeFileSync(file, JSON.stringify({ publisherNames: [' ', publisher] }));
      expect(loadTrustedPublishers(file)).toEqual([publisher]);
      expect(loadTrustedPublishers(path.join(os.tmpdir(), 'no-such-trust.json'))).toEqual([]);
    } finally { fs.rmSync(file, { force: true }); }
  });
});
