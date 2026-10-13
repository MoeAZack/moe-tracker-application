import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { createUpdateController, safeMessage } = require('../desktop/update-controller.cjs');

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checkForUpdates = vi.fn(async () => this.emit('update-available', { version: '0.2.0' }));
  downloadUpdate = vi.fn(async () => this.emit('update-downloaded', { version: '0.2.0' }));
  quitAndInstall = vi.fn();
}

describe('desktop update controller', () => {
  it('requires a verified download before installation', async () => {
    const updater = new FakeUpdater();
    const controller = createUpdateController({ autoUpdater: updater, enabled: true });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    await controller.check();
    expect(controller.getState()).toMatchObject({ state: 'available', version: '0.2.0' });
    await controller.download();
    expect(controller.getState()).toMatchObject({ state: 'downloaded', percent: 100 });
    controller.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
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
