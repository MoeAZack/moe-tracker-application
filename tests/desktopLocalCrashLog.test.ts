import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { LOG_FILE, appendLocalCrashEvent, serializeError } = require('../desktop/local-crash-log.cjs');
const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map(folder => rm(folder, { recursive: true, force: true }))));

describe('local crash diagnostics', () => {
  it('writes bounded structured events to a private local log', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'moetracker-crash-')); temporary.push(folder);
    await appendLocalCrashEvent(folder, 'renderer-gone', new Error('renderer failed'), { reason: 'crashed' });
    const record = JSON.parse((await readFile(join(folder, LOG_FILE), 'utf8')).trim());
    expect(record).toMatchObject({ type: 'renderer-gone', error: { name: 'Error', message: 'renderer failed' }, details: { reason: 'crashed' } });
    expect(Date.parse(record.timestamp)).not.toBeNaN();
  });

  it('rotates logs and bounds untrusted error text', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'moetracker-crash-')); temporary.push(folder);
    await appendLocalCrashEvent(folder, 'first', new Error('x'.repeat(8_000)), {}, { maxBytes: 1, maxFiles: 2 });
    await appendLocalCrashEvent(folder, 'second', 'plain failure', {}, { maxBytes: 1, maxFiles: 2 });
    expect((await readFile(join(folder, `${LOG_FILE}.2`), 'utf8')).length).toBeGreaterThan(0);
    expect(serializeError(new Error('x'.repeat(8_000))).message).toHaveLength(4_000);
  });
});
