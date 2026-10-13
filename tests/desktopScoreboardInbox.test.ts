import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { scoreboardInventory, readScoreboardRecord } = require('../desktop/scoreboard-inbox.cjs');
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
  });

  it('rejects a file whose extension and signature disagree', async () => {
    await fs.writeFile(path.join(folder, 'fake.png'), Buffer.from('not a png'));
    const [record] = await scoreboardInventory(folder, []);
    await expect(readScoreboardRecord(record)).rejects.toThrow(/contents do not match/);
  });
});
