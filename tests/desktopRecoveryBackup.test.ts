import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { hasRecentRecoveryBackup } = require('../desktop/recovery-backup.cjs');
let directory = '';

afterEach(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); directory = ''; });

describe('desktop recovery backup detection', () => {
  it('does not trust a timestamp when the configured backup folder is empty', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-backup-'));
    expect(await hasRecentRecoveryBackup(directory, Date.now() - 60_000)).toBe(false);
  });

  it('recognizes a valid recent private backup manifest', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-backup-'));
    const item = path.join(directory, 'backup-one'); await fs.mkdir(item);
    await fs.writeFile(path.join(item, 'manifest.json'), JSON.stringify({ format: 'moetracker-private-backup/v1', createdAt: new Date().toISOString() }));
    expect(await hasRecentRecoveryBackup(directory, Date.now() - 60_000)).toBe(true);
  });
});
