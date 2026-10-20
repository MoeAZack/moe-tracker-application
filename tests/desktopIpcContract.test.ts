import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const preload = fs.readFileSync('desktop/preload.cjs', 'utf8');
const main = fs.readFileSync('desktop/main.cjs', 'utf8');
const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map(match => match[1]);
const handled = [...main.matchAll(/handleTrusted\('([^']+)'/g)].map(match => match[1]);
const subscribed = [...preload.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map(match => match[1]);

describe('desktop IPC release contract', () => {
  it('registers every renderer command through the trusted-sender wrapper exactly once', () => {
    expect(new Set(invoked)).toEqual(new Set(handled));
    expect(invoked).toHaveLength(new Set(invoked).size);
    expect(handled).toHaveLength(new Set(handled).size);
    expect(main).not.toMatch(/ipcMain\.handle\('(?!desktop:)/);
  });

  it('emits every progress event exposed by the preload bridge', () => {
    for (const channel of subscribed) expect(main).toContain(`'${channel}'`);
    expect(new Set(subscribed)).toEqual(new Set(['desktop:vod-analysis-progress', 'desktop:ingestion-progress', 'desktop:capture-ready']));
  });

  it('keeps the renderer bridge immutable and enforces the exact local origin', () => {
    expect(preload).toContain("contextBridge.exposeInMainWorld('moeDesktop', Object.freeze({");
    expect(main).toContain("throw new Error('Desktop request rejected from an untrusted page.')");
    expect(main).toContain('requireTrustedSender(event)');
  });
});
