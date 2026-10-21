import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { createUpdateHealth } = require('../desktop/update-health.cjs');

const verified = async () => null;

/** What build/installer.nsh leaves behind when version 0.1.0 is installed. */
async function installedCopy(directory: string, version: string, bytes: string) {
  await mkdir(path.join(directory, 'installed'), { recursive: true });
  const file = path.join(directory, 'installed', `Moe-Tracker-Application-${version}-Setup.exe`);
  await writeFile(file, bytes);
  return file;
}

describe('post-update health and rollback', () => {
  it('promotes a healthy installer for the next rollback', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-health-'));
    const candidate = path.join(directory, 'download.exe'); await writeFile(candidate, 'signed installer bytes');
    const health = createUpdateHealth({ directory, launchInstaller: vi.fn(), verifyInstaller: verified });
    await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate });
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'verifying', attempts: 1 });
    expect(await health.confirmHealthy('0.2.0')).toMatchObject({ confirmed: true, rollbackReady: true });
  });

  it('launches the cached last-known-good installer after two failed starts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-rollback-'));
    const first = path.join(directory, 'first.exe'); await writeFile(first, 'first');
    const second = path.join(directory, 'second.exe'); await writeFile(second, 'second');
    const launchInstaller = vi.fn(); const health = createUpdateHealth({ directory, launchInstaller, verifyInstaller: verified });
    await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: first });
    await health.beginStartup('0.2.0'); await health.confirmHealthy('0.2.0');
    await health.prepareInstall({ previousVersion: '0.2.0', targetVersion: '0.3.0', downloadedFile: second });
    expect(await health.beginStartup('0.3.0')).toMatchObject({ state: 'verifying' });
    expect(await health.beginStartup('0.3.0')).toMatchObject({ state: 'rollback-started', version: '0.2.0' });
    expect(launchInstaller).toHaveBeenCalledOnce();
  });

  it('rolls the first update back to the installer the current version was set up from', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-first-'));
    const installed = await installedCopy(directory, '0.1.0', 'installer 0.1.0');
    const candidate = path.join(directory, 'download.exe'); await writeFile(candidate, 'installer 0.2.0');
    const launchInstaller = vi.fn(); const verifyInstaller = vi.fn(verified);
    const health = createUpdateHealth({ directory, launchInstaller, verifyInstaller });
    expect(await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate })).toMatchObject({ prepared: true, rollbackReady: true });
    // The 0.2.0 installer replaces the installed/ copy as it runs.
    await rm(installed); await installedCopy(directory, '0.2.0', 'installer 0.2.0');
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'verifying', attempts: 1 });
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'rollback-started', version: '0.1.0' });
    expect(launchInstaller).toHaveBeenCalledOnce();
    const rollback = launchInstaller.mock.calls[0][0];
    expect(await readFile(rollback, 'utf8')).toBe('installer 0.1.0');
    expect(verifyInstaller).toHaveBeenLastCalledWith(rollback);
  });

  it('pauses updates when the first update has no cached rollback installer', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-safe-'));
    const candidate = path.join(directory, 'first.exe'); await writeFile(candidate, 'first');
    await installedCopy(directory, '0.0.9', 'some other version');
    const launchInstaller = vi.fn(); const health = createUpdateHealth({ directory, launchInstaller, verifyInstaller: verified });
    expect(await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate })).toMatchObject({ rollbackReady: false });
    await health.beginStartup('0.2.0');
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'safe-mode', attempts: 2 });
    expect(launchInstaller).not.toHaveBeenCalled();
  });

  it('never launches a rollback installer that fails its signature check', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-untrusted-'));
    await installedCopy(directory, '0.1.0', 'installer 0.1.0');
    const candidate = path.join(directory, 'download.exe'); await writeFile(candidate, 'installer 0.2.0');
    const launchInstaller = vi.fn(); const verifyInstaller = vi.fn(verified);
    const health = createUpdateHealth({ directory, launchInstaller, verifyInstaller });
    expect(await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate })).toMatchObject({ rollbackReady: true });
    await health.beginStartup('0.2.0');
    verifyInstaller.mockResolvedValue('The installer signature is HashMismatch, not Valid.');
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'safe-mode', message: expect.stringContaining('HashMismatch') });
    expect(launchInstaller).not.toHaveBeenCalled();
    // With no signature check configured at all, rollback is refused as well.
    const bare = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-noverify-')); await installedCopy(bare, '0.1.0', 'installer 0.1.0');
    const unverified = createUpdateHealth({ directory: bare, launchInstaller });
    expect(await unverified.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate })).toMatchObject({ rollbackReady: false, rollbackProblem: expect.stringContaining('No installer signature check') });
  });
});
