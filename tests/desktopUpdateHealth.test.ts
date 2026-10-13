import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { createUpdateHealth } = require('../desktop/update-health.cjs');

describe('post-update health and rollback', () => {
  it('promotes a healthy installer for the next rollback', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-health-'));
    const candidate = path.join(directory, 'download.exe'); await writeFile(candidate, 'signed installer bytes');
    const health = createUpdateHealth({ directory, launchInstaller: vi.fn() });
    await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate });
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'verifying', attempts: 1 });
    expect(await health.confirmHealthy('0.2.0')).toMatchObject({ confirmed: true, rollbackReady: true });
  });

  it('launches the cached last-known-good installer after two failed starts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-rollback-'));
    const first = path.join(directory, 'first.exe'); await writeFile(first, 'first');
    const second = path.join(directory, 'second.exe'); await writeFile(second, 'second');
    const launchInstaller = vi.fn(); const health = createUpdateHealth({ directory, launchInstaller });
    await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: first });
    await health.beginStartup('0.2.0'); await health.confirmHealthy('0.2.0');
    await health.prepareInstall({ previousVersion: '0.2.0', targetVersion: '0.3.0', downloadedFile: second });
    expect(await health.beginStartup('0.3.0')).toMatchObject({ state: 'verifying' });
    expect(await health.beginStartup('0.3.0')).toMatchObject({ state: 'rollback-started', version: '0.2.0' });
    expect(launchInstaller).toHaveBeenCalledOnce();
  });

  it('pauses updates when the first update has no cached rollback installer', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'moetracker-update-safe-'));
    const candidate = path.join(directory, 'first.exe'); await writeFile(candidate, 'first');
    const health = createUpdateHealth({ directory, launchInstaller: vi.fn() });
    await health.prepareInstall({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: candidate });
    await health.beginStartup('0.2.0');
    expect(await health.beginStartup('0.2.0')).toMatchObject({ state: 'safe-mode', attempts: 2 });
  });
});
