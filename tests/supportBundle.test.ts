import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createSupportBundle, zip } = require('../desktop/support-bundle.cjs');
const unzipper = require('unzipper');
const temporary: string[] = [];

afterEach(async () => { await Promise.all(temporary.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });

describe('desktop support bundle', () => {
  it('creates a valid zip container with named entries', () => {
    const bytes = zip([{ name: 'support-summary.json', bytes: Buffer.from('{"ok":true}'), modifiedAt: new Date('2026-10-14T00:00:00Z') }]);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from('support-summary.json'))).toBe(true);
    expect(bytes.readUInt32LE(bytes.length - 22)).toBe(0x06054b50);
  });

  it('includes the capture transcript and uses its related capture session', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-support-')); temporary.push(root);
    const captures = path.join(root, 'Scoreboards'); const logs = path.join(root, 'Logs');
    await fs.mkdir(path.join(captures, 'Scrim-20261014-100000'), { recursive: true });
    await fs.mkdir(path.join(captures, 'Scrim-20261014-110000'), { recursive: true });
    await fs.mkdir(logs);
    await fs.writeFile(path.join(root, 'scrim-capture-last-run.log'), 'Output: Scrim-20261014-100000');
    await fs.writeFile(path.join(captures, 'Scrim-20261014-100000', 'scoreboard.png'), 'related-capture');
    await fs.writeFile(path.join(captures, 'Scrim-20261014-110000', 'scoreboard.png'), 'newest-unrelated');
    const target = path.join(root, 'out', 'support.zip');
    const result = await createSupportBundle({ target, logs, captureRoots: [captures], summary: { ok: true } });
    const bytes = await fs.readFile(target);
    const archive = await unzipper.Open.buffer(bytes);
    const archived = new Map(await Promise.all(archive.files.map(async (file: any) => [file.path, (await file.buffer()).toString('utf8')])));
    expect(result).toMatchObject({ includedCapture: true });
    expect(archived.get('logs/scrim-capture-last-run.log')).toContain('Scrim-20261014-100000');
    expect(archived.get('latest-capture/scoreboard.png')).toBe('related-capture');
  });
});
