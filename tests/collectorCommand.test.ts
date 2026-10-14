import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { collectChildOutput, collectJson } = require('../desktop/collector-command.cjs');

function fakeChild() {
  const child: any = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

describe('desktop replay collector command', () => {
  it('waits for stream close instead of parsing at the earlier exit event', async () => {
    const child = fakeChild();
    const result = collectChildOutput(child);
    child.emit('exit', 0);
    child.stdout.write('{"ok":');
    child.stdout.end('true}');
    child.stderr.end();
    child.emit('close', 0, null);
    await expect(result).resolves.toBe('{"ok":true}');
  });

  it('retries one incomplete JSON response safely', async () => {
    const run = vi.fn().mockResolvedValueOnce('').mockResolvedValueOnce('{"state":"ready"}');
    await expect(collectJson(run, ['process-latest'])).resolves.toEqual({ state: 'ready' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('returns an actionable error instead of a raw JSON SyntaxError', async () => {
    const run = vi.fn().mockResolvedValue('{');
    await expect(collectJson(run, ['scan'])).rejects.toThrow('incomplete response for scan');
  });
});
