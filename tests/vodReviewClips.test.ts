import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const run = promisify(execFile);
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });

describe('local VOD review clips', () => {
  it('cuts a bounded playable clip around a supported review moment', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-review-clip-')); folders.push(folder);
    const source = path.join(folder, 'source.mp4');
    await run(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    const { createReviewClips } = require('../desktop/vod-timeline-analyzer.cjs');
    const clips = await createReviewClips({ localPath: source, moments: [{ timestampMs: 2_000, startMs: 500, endMs: 3_500, label: 'R1 advantage lost' }] }, { outputRoot: path.join(folder, 'clips'), workRoot: path.join(folder, 'work'), minimumFreeBytes: 0 });
    expect(clips).toHaveLength(1); expect(clips[0]).toMatchObject({ label: 'R1 advantage lost', startMs: 500, endMs: 3500 });
    expect(clips[0].fileName).toMatch(/^R1-advantage-lost-/); expect((await fs.stat(clips[0].path)).size).toBeGreaterThan(1_000);
  });
});
