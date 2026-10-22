import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';
import analyzerModule from '../desktop/vod-timeline-analyzer.cjs';
import performanceModule from '../desktop/vod-performance.cjs';

const { analyzeVodTimeline, changedFrames, changedFramesTogether, sampleRegions, recognizeFrames, createOcrPool } = analyzerModule;
const { normalizeVodPerformance, resolveOcrWorkers, combinedDecodeArgs, sampledRange } = performanceModule;
const GB = 1024 ** 3;

// The production region specs, copied so a change to either side is noticed here.
const specs = [
  { key: 'killFeedSnapshots', label: 'kill feed', fps: 2, crop: 'crop=iw*0.42:ih*0.38:iw*0.58:0', width: 720, height: 366, threshold: 0.15, burstFrames: 3, maxCandidates: 3600 },
  { key: 'objectiveSnapshots', label: 'round and objective notices', fps: 1, crop: 'crop=iw*0.62:ih*0.34:iw*0.19:ih*0.02', width: 720, height: 222, threshold: 0.15, burstFrames: 2, maxCandidates: 1800 },
  { key: 'roundStateSnapshots', label: 'round state and score', fps: 1, crop: 'crop=iw*0.46:ih*0.20:iw*0.27:0', width: 700, height: 240, threshold: 0.1, burstFrames: 2, maxCandidates: 1800 },
  { key: 'ultimateSnapshots', label: 'ultimate state', fps: 1, crop: 'crop=iw*0.28:ih*0.25:iw*0.36:ih*0.72', width: 520, height: 260, threshold: 0.12, burstFrames: 2, maxCandidates: 1800 },
  { key: 'povSnapshots', label: 'POV identity', fps: 0.25, crop: 'crop=iw*0.34:ih*0.28:0:ih*0.67', width: 560, height: 280, threshold: 0.08, burstFrames: 1, maxCandidates: 600 },
  { key: 'scoreboardSnapshots', label: 'scoreboard totals', fps: 0.2, crop: 'crop=iw*0.78:ih*0.72:iw*0.11:ih*0.14', width: 1100, height: 680, threshold: 0.12, burstFrames: 1, maxCandidates: 480 },
];

const digest = (frames: Record<string, Array<{ timestampMs: number; pixels: Buffer }>>) =>
  Object.fromEntries(Object.entries(frames).map(([key, list]) => [key, list.map(frame => `${frame.timestampMs}:${crypto.createHash('sha256').update(frame.pixels).digest('hex')}`)]));

describe('VOD speed settings', () => {
  it('defaults to Auto threads and software decode, and rejects odd values', () => {
    expect(normalizeVodPerformance(undefined)).toEqual({ ocrWorkers: 'auto', hardwareDecode: false });
    expect(normalizeVodPerformance({ ocrWorkers: 3, hardwareDecode: true })).toEqual({ ocrWorkers: 3, hardwareDecode: true });
    expect(normalizeVodPerformance({ ocrWorkers: 0 })).toEqual({ ocrWorkers: 'auto', hardwareDecode: false });
    expect(normalizeVodPerformance({ ocrWorkers: 9, hardwareDecode: 'yes' })).toEqual({ ocrWorkers: 'auto', hardwareDecode: false });
  });

  it('Auto uses cores minus one up to four, and memory caps every setting', () => {
    expect(resolveOcrWorkers('auto', { cpus: 1, freeBytes: 16 * GB })).toBe(1);
    expect(resolveOcrWorkers('auto', { cpus: 4, freeBytes: 16 * GB })).toBe(3);
    expect(resolveOcrWorkers('auto', { cpus: 16, freeBytes: 16 * GB })).toBe(4);
    expect(resolveOcrWorkers(1, { cpus: 16, freeBytes: 16 * GB })).toBe(1);
    expect(resolveOcrWorkers(8, { cpus: 4, freeBytes: 16 * GB })).toBe(4);
    // 2 GB free with 0.6 GB of candidate frames leaves room for one extra worker.
    expect(resolveOcrWorkers(8, { cpus: 16, freeBytes: 2 * GB, frameBytes: 0.6 * GB })).toBe(1);
    expect(resolveOcrWorkers('auto', { cpus: 16, freeBytes: 0.5 * GB })).toBe(1);
  });

  it('one decode splits into the same filter chain per region, each with its own time limit and pipe', () => {
    const args = combinedDecodeArgs('in.mp4', specs.slice(0, 2), sampledRange({ startMs: 5000, endMs: 65000 }, 600), { hardwareDecode: true });
    expect(args.slice(0, 6)).toEqual(['-hide_banner', '-loglevel', 'error', '-hwaccel', 'auto', '-ss']);
    expect(args[args.indexOf('-filter_complex') + 1]).toBe(`[0:v]split=2[v0][v1];[v0]fps=2,${specs[0].crop},scale=720:366:flags=fast_bilinear,format=gray[o0];[v1]fps=1,${specs[1].crop},scale=720:222:flags=fast_bilinear,format=gray[o1]`);
    expect(args.filter(arg => arg === '-t')).toHaveLength(2);
    expect(args.slice(-2)).toEqual(['gray', 'pipe:4']);
  });
});

describe('VOD sampling equivalence (fixture video)', () => {
  let directory = '';
  let video = '';
  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-vod-speed-'));
    for (let second = 0; second < 30; second += 1) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#202830"/>
        <rect x="${(second * 37) % 1100}" y="${(second * 53) % 600}" width="160" height="90" fill="#7a9"/>
        <text x="790" y="60" font-family="DejaVu Sans" font-size="34" fill="#fff">ALPHA ${Math.floor(second / 3)} BRAVO</text>
        <text x="420" y="70" font-family="DejaVu Sans" font-size="40" fill="#ff0">SCORE ${Math.floor(second / 5)} - ${Math.floor(second / 7)}</text>
        <text x="60" y="580" font-family="DejaVu Sans" font-size="34" fill="#fff">ECHO ${Math.floor(second / 4)} READY</text>
        <text x="300" y="320" font-family="DejaVu Sans" font-size="38" fill="#fff">TOTAL ${Math.floor(second / 6)} 12 7 3</text></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(path.join(directory, `f${String(second).padStart(3, '0')}.png`));
    }
    video = path.join(directory, 'fixture.mp4');
    execFileSync(ffmpegStatic as unknown as string, ['-hide_banner', '-loglevel', 'error', '-framerate', '1', '-i', path.join(directory, 'f%03d.png'), '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y', video]);
  }, 60_000);
  afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });

  for (const range of [{}, { startMs: 4000, endMs: 23000 }]) {
    it(`one decode gives byte-identical candidate frames to one decode per region ${range.startMs ? '(game range)' : '(whole VOD)'}`, async () => {
      const separate: Record<string, any> = {};
      for (const spec of specs) separate[spec.key] = await changedFrames(video, spec, 30, null, null, range);
      const together = await changedFramesTogether(video, specs, 30, null, null, range);
      expect(Object.values(separate).every((list: any[]) => list.length > 0)).toBe(true);
      expect(digest(together as any)).toEqual(digest(separate));
      const withHardware = await sampleRegions(video, specs, 30, null, null, range, { hardwareDecode: true });
      expect(digest(withHardware as any)).toEqual(digest(separate));
    }, 60_000);
  }

  it('falls back from hardware to software to per-region decode and logs each step', async () => {
    const log: string[] = []; const progress = vi.fn();
    const together = vi.fn().mockRejectedValue(new Error('pipe:3: Bad file descriptor'));
    const single = vi.fn(async (_file: string, spec: any) => [{ timestampMs: 0, pixels: Buffer.from(spec.key) }]);
    const frames = await (sampleRegions as any)('in.mp4', specs, 30, progress, null, {}, { hardwareDecode: true }, (line: string) => log.push(line), { together, single });
    expect(together.mock.calls.map(call => call[6])).toEqual([{ hardwareDecode: true }, { hardwareDecode: false }]);
    expect(single).toHaveBeenCalledTimes(specs.length);
    expect(Object.keys(frames)).toEqual(specs.map(spec => spec.key));
    expect(log).toEqual([expect.stringContaining('hardware decode failed'), expect.stringContaining('single software decode failed'), 'decode: per-region software']);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('Hardware decode failed') }));
  });

  it('reads the same snapshots and observations with 3 OCR threads as with 1', async () => {
    const run = async (performance: any) => {
      let inspected: any = null;
      const evidence = await analyzeVodTimeline({ localPath: video, players: [], sourceSha256: 'fixture' }, { workRoot: path.join(directory, 'work'), minimumFreeBytes: 1, performance, inspect: (value: any) => { inspected = value; } });
      return { inspected, observations: evidence.observations };
    };
    const baseline = await run({ singleDecode: false, ocrWorkers: 1 });
    const candidate = await run({ ocrWorkers: 3 });
    expect(baseline.inspected.ocrWorkers).toBe(1);
    expect(candidate.inspected.ocrWorkers).toBeGreaterThanOrEqual(1);
    expect(digest(candidate.inspected.candidates)).toEqual(digest(baseline.inspected.candidates));
    expect(candidate.inspected.snapshots).toEqual(baseline.inspected.snapshots);
    expect(Object.values(baseline.inspected.snapshots).flat().length).toBeGreaterThan(0);
    expect(candidate.observations).toEqual(baseline.observations);
  }, 120_000);
});

describe('parallel OCR keeps frame order', () => {
  const spec = { width: 2, height: 1 };
  const frames = Array.from({ length: 23 }, (_, index) => ({ timestampMs: index * 500, pixels: Buffer.from([index, 255 - index]) }));
  const fakeWorker = (failOn: number | null = null) => {
    let failed = false;
    return {
      recognize: async (image: Buffer) => {
        const value = image[image.length - 2];
        await new Promise(resolve => setTimeout(resolve, (value * 7) % 5));
        if (value === failOn && !failed) { failed = true; throw new Error('worker crashed'); }
        return { data: { text: value % 4 === 0 ? '' : `frame ${value}`, confidence: 80 + (value % 10) } };
      },
    };
  };
  const read = async (pool: any) => {
    const states: any[] = [];
    const snapshots = await recognizeFrames(frames, spec, pool, null, 0, frames.length, null, null, async (state: any) => { states.push(structuredClone(state)); });
    return { snapshots, states };
  };

  it('four workers give the same snapshots and checkpoints as one', async () => {
    const one = await read({ workers: [fakeWorker()] });
    const four = await read({ workers: [fakeWorker(), fakeWorker(), fakeWorker(), fakeWorker()] });
    expect(four).toEqual(one);
    expect(one.states.map(state => state.processed)).toEqual([10, 20, 23]);
  });

  it('a crashed worker drops the pool to one worker and the result is unchanged', async () => {
    const one = await read({ workers: [fakeWorker()] });
    const pool: any = { workers: [fakeWorker(9), fakeWorker(9), fakeWorker(9)] };
    pool.degrade = vi.fn(async () => { pool.workers = [fakeWorker()]; pool.degrade = null; });
    const recovered = await read(pool);
    expect(pool.workers).toHaveLength(1);
    expect(recovered).toEqual(one);
  });

  it('the real pool falls back to one worker only once, so a worker that always fails stops the import', async () => {
    const started: any[] = []; const log: string[] = [];
    const tesseract = { PSM: { SPARSE_TEXT: '11' }, createWorker: vi.fn(async () => { const worker = { setParameters: vi.fn(async () => {}), recognize: vi.fn(async () => { throw new Error('worker crashed'); }), terminate: vi.fn(async () => {}) }; started.push(worker); return worker; }) };
    const pool = await (createOcrPool as any)(3, (line: string) => log.push(line), tesseract);
    expect(pool.workers).toHaveLength(3);
    await expect(read(pool)).rejects.toThrow('worker crashed');
    // Three workers, then exactly one replacement; no third round.
    expect(tesseract.createWorker).toHaveBeenCalledTimes(4);
    expect(pool.degrade).toBeNull();
    for (const worker of started.slice(0, 3)) expect(worker.terminate).toHaveBeenCalled();
    expect(log.filter(line => line.includes('continuing with 1 worker'))).toHaveLength(1);
    await pool.terminate();
    expect(started[3].terminate).toHaveBeenCalled();
  });

  it('a second failure after falling back stops the import with the error', async () => {
    const pool: any = { workers: [fakeWorker(3)], degrade: null };
    await expect(read(pool)).rejects.toThrow('worker crashed');
  });
});
