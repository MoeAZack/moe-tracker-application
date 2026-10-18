import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { scoreboardInventory, readScoreboardRecord, readCaptureSession } = require('../desktop/scoreboard-inbox.cjs');
let folder: string;

describe('desktop scoreboard folder inbox', () => {
  beforeEach(async () => { folder = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-scoreboards-')); });
  afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });

  it('inventories supported local images without exposing processed files', async () => {
    await fs.writeFile(path.join(folder, 'score.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    await fs.writeFile(path.join(folder, 'notes.txt'), 'not an image');
    const records = await scoreboardInventory(folder, []);
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ name: 'score.png', mediaType: 'image/png' });
    expect((await readScoreboardRecord(records[0])).bytes).toHaveLength(9);
    expect(await scoreboardInventory(folder, [records[0].id])).toEqual([]);
    const loaded = await readScoreboardRecord(records[0]);
    await fs.copyFile(path.join(folder, 'score.png'), path.join(folder, 'moved-copy.png'));
    expect(await scoreboardInventory(folder, [], [loaded.imageSha256])).toEqual([]);
  });

  it('rejects a file whose extension and signature disagree', async () => {
    await fs.writeFile(path.join(folder, 'fake.png'), Buffer.from('not a png'));
    const [record] = await scoreboardInventory(folder, []);
    await expect(readScoreboardRecord(record)).rejects.toThrow(/contents do not match/);
  });

  it('discovers the scoreboard inside a complete capture session', async () => {
    const capture = path.join(folder, 'Scrim-20261014-103926'); await fs.mkdir(capture);
    await fs.writeFile(path.join(capture, 'scoreboard.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    await fs.writeFile(path.join(capture, 'capture-manifest.json'), JSON.stringify({ status: 'complete', captureId: '20261014-103926', template: 'without-performance', requestedRounds: 24, captures: [{ kind: 'scoreboard', file: 'scoreboard.png' }] }));
    const records = await scoreboardInventory(folder, []);
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ name: 'Scrim-20261014-103926/scoreboard.png', capture: { captureId: '20261014-103926', requestedRounds: 24 } });
  });

  it('discovers a PowerShell UTF-8 BOM capture manifest', async () => {
    const capture = path.join(folder, 'Scrim-20261014-104000'); await fs.mkdir(capture);
    await fs.writeFile(path.join(capture, 'scoreboard.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
    const manifest = JSON.stringify({ status: 'complete', captureId: '20261014-104000', captures: [{ kind: 'scoreboard', file: 'scoreboard.png' }] });
    await fs.writeFile(path.join(capture, 'capture-manifest.json'), `\uFEFF${manifest}`, 'utf8');
    const records = await scoreboardInventory(folder, []);
    expect(records).toHaveLength(1);
    expect(records[0].capture.captureId).toBe('20261014-104000');
  });

  it('reads every verified image in a complete capture session', async () => {
    const capture = path.join(folder, 'Scrim-20261014-104500'); await fs.mkdir(capture);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    await fs.writeFile(path.join(capture, 'scoreboard.png'), png);
    await fs.writeFile(path.join(capture, 'round-01.png'), png);
    const manifest = { status: 'complete', captureId: '20261014-104500', captures: [{ kind: 'scoreboard', file: 'scoreboard.png' }, { kind: 'round', round: 1, file: 'round-01.png' }] };
    await fs.writeFile(path.join(capture, 'capture-manifest.json'), `\uFEFF${JSON.stringify(manifest)}`, 'utf8');
    const [record] = await scoreboardInventory(folder, []);
    const session = await readCaptureSession(record);
    expect(session.manifest.captureId).toBe('20261014-104500');
    expect(session.captures.map((item: any) => ({ kind: item.kind, round: item.round, file: item.file, mediaType: item.mediaType }))).toEqual([
      { kind: 'scoreboard', round: undefined, file: 'scoreboard.png', mediaType: 'image/png' },
      { kind: 'round', round: 1, file: 'round-01.png', mediaType: 'image/png' },
    ]);
  });

  it('rejects capture files that escape the session folder', async () => {
    const capture = path.join(folder, 'Scrim-20261014-105000'); await fs.mkdir(capture);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    await fs.writeFile(path.join(capture, 'scoreboard.png'), png);
    await fs.writeFile(path.join(capture, 'capture-manifest.json'), JSON.stringify({ status: 'complete', captureId: '20261014-105000', captures: [{ kind: 'scoreboard', file: 'scoreboard.png' }] }));
    const [record] = await scoreboardInventory(folder, []);
    await fs.writeFile(path.join(capture, 'capture-manifest.json'), JSON.stringify({ status: 'complete', captureId: '20261014-105000', captures: [{ kind: 'scoreboard', file: 'scoreboard.png' }, { kind: 'round', round: 1, file: '../outside.png' }] }));
    await expect(readCaptureSession(record)).rejects.toThrow(/unsafe or duplicate filename/);
  });
});
