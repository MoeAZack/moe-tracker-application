import { describe, expect, it, vi } from 'vitest';
import { renameWithRetry } from '../scripts/replay-collector.mjs';

const failing = (code: string, times: number) => {
  let calls = 0;
  return vi.fn(async () => { calls += 1; if (calls <= times) throw Object.assign(new Error(`${code}: rename`), { code }); });
};

describe('collector state writes on Windows', () => {
  it('retries a rename blocked for a moment by another reader', async () => {
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      const rename = failing(code, 3);
      await expect(renameWithRetry('a.tmp', 'a', { rename, delayMs: 1 })).resolves.toBeUndefined();
      expect(rename).toHaveBeenCalledTimes(4);
    }
  });

  it('gives up after the last attempt and never retries other errors', async () => {
    const stuck = failing('EPERM', 99);
    await expect(renameWithRetry('a.tmp', 'a', { rename: stuck, attempts: 3, delayMs: 1 })).rejects.toThrow('EPERM');
    expect(stuck).toHaveBeenCalledTimes(3);
    const missing = failing('ENOENT', 99);
    await expect(renameWithRetry('a.tmp', 'a', { rename: missing, delayMs: 1 })).rejects.toThrow('ENOENT');
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
