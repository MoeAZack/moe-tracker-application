import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { createUpdateController, safeMessage } = require('../desktop/update-controller.cjs');
const { createUpdateTrust } = require('../desktop/update-trust.cjs');
const { NsisUpdater } = require('electron-updater/out/NsisUpdater.js');

const trusted = { configured: true, verify: vi.fn(async () => null) };

function realNsisUpdater() {
  const app = { version: '0.1.0', name: 'moe-tracker-application', isPackaged: true, appUpdateConfigPath: path.join(os.tmpdir(), 'no-app-update.yml'), userDataPath: os.tmpdir(), baseCachePath: os.tmpdir(), whenReady: () => Promise.resolve(), onQuit() {}, quit() {}, relaunch() {} };
  return new NsisUpdater(null, app);
}

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checkForUpdates = vi.fn(async () => this.emit('update-available', { version: '0.2.0' }));
  downloadUpdate = vi.fn(async () => this.emit('update-downloaded', { version: '0.2.0', downloadedFile: 'download.exe' }));
  quitAndInstall = vi.fn();
}

describe('desktop update controller', () => {
  it('requires a verified download before installation', async () => {
    const updater = new FakeUpdater();
    const updateHealth = { prepareInstall: vi.fn(async () => ({ rollbackReady: true })) };
    const controller = createUpdateController({ autoUpdater: updater, enabled: true, currentVersion: '0.1.0', updateHealth, trust: trusted });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await controller.check();
    expect(controller.getState()).toMatchObject({ state: 'available', version: '0.2.0' });
    await controller.download();
    expect(controller.getState()).toMatchObject({ state: 'downloaded', percent: 100 });
    await controller.install();
    expect(updateHealth.prepareInstall).toHaveBeenCalledWith({ previousVersion: '0.1.0', targetVersion: '0.2.0', downloadedFile: 'download.exe' });
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('stays off when the build names no trusted publisher', async () => {
    const updater = new FakeUpdater();
    const controller = createUpdateController({ autoUpdater: updater, enabled: true, currentVersion: '0.1.0', trust: createUpdateTrust({ publisherNames: [] }) });
    expect(controller.getState()).toMatchObject({ state: 'blocked' });
    await controller.check();
    controller.start();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await expect(controller.install()).rejects.toThrow('No downloaded update');
    expect(createUpdateController({ autoUpdater: new FakeUpdater(), enabled: true }).getState().state).toBe('blocked');
    controller.stop();
  });

  it('makes electron-updater reject an installer the publisher check refuses, even with no publisher in app-update.yml', async () => {
    const updater = realNsisUpdater();
    const file = path.join(os.tmpdir(), `moetracker-unsigned-${process.pid}.exe`);
    fs.writeFileSync(file, 'not a signed installer');
    try {
      // Unpatched, electron-updater passes any file when app-update.yml has no publisherName.
      await expect(updater.verifySignature(file)).resolves.toBeNull();
      const inspect = vi.fn(async () => ({ path: file, status: 'NotSigned', subject: null }));
      createUpdateController({ autoUpdater: updater, enabled: true, currentVersion: '0.1.0', trust: createUpdateTrust({ publisherNames: ['CN=Moe Tracker Publisher'], inspect }) });
      await expect(updater.verifySignature(file)).resolves.toMatch(/NotSigned/);
      expect(inspect).toHaveBeenCalledWith(file);
    } finally { fs.rmSync(file, { force: true }); }
  });

  it('re-verifies the downloaded installer before handing it to the installer', async () => {
    const updater = new FakeUpdater();
    const updateHealth = { prepareInstall: vi.fn(async () => ({ rollbackReady: true })) };
    const trust = { configured: true, verify: vi.fn(async () => null) };
    const controller = createUpdateController({ autoUpdater: updater, enabled: true, currentVersion: '0.1.0', updateHealth, trust });
    await controller.check(); await controller.download();
    trust.verify.mockResolvedValueOnce('The installer is signed by a publisher this build does not trust.');
    await expect(controller.install()).rejects.toThrow('was not installed');
    expect(trust.verify).toHaveBeenLastCalledWith('download.exe');
    expect(updateHealth.prepareInstall).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(controller.getState().state).toBe('error');
  });

  it('does not enable updates in development builds', async () => {
    const updater = new FakeUpdater();
    const controller = createUpdateController({ autoUpdater: updater, enabled: false });
    await controller.check();
    expect(controller.getState().state).toBe('disabled');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('redacts service URLs from errors', () => {
    expect(safeMessage(new Error('failed at https://example.test/releases/latest.yml'))).toBe('failed at [update service]');
  });
});
