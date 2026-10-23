import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import analyzerModule from '../desktop/vod-timeline-analyzer.cjs';
import { boundaryTimelinePlayers } from '../src/components/VodSubmission';

const { aggregateVideoEvidence, NO_IDENTITIES_LIMITATION, parseKillFeedSnapshot, parseUltimateSnapshots, parseRoundStateSnapshot, buildRoundTimeline, buildObserverSegments, applyVisualTemplates, fuseVodEvidence } = evidenceModule;
const { tabBoardRows, tabBoardFit, isTabBoard, tabCellImage, readCoachTabBoards, TAB_BOX, TAB_FRAME, TAB_OUR_ROWS, TAB_CELLS, killFeedSummary, createChangeCollector, readScoreBox, KILL_FEED_BOX, killFeedCrop, scoreBoxCrop, fixSevens, SCORE_BOXES, rowText, stretchedBanner, splitDigitCrop, bannerDigitCrop, selectBannerCandidates, readBannerDigits, sweepOrphanedVodDirectories, normalizeYoutubeUrl, youtubeVideoId, frameDifference, visualSignature, scoreboardGeometryScore, agentSelectGeometryScore, chooseGameBoundaries, inferPovPlayer, analyzeVodTimeline, releaseVodSource, discoverVodGames, readVodFrame, readOwnedVodFrame, normalizeTimelinePlayers } = analyzerModule;
const players = [
  { name: 'Alpha', team: 'ours' }, { name: 'Bravo', team: 'ours' }, { name: 'Charlie', team: 'ours' }, { name: 'Delta', team: 'ours' }, { name: 'Echo', team: 'ours' },
  { name: 'EnemyOne', team: 'theirs' }, { name: 'EnemyTwo', team: 'theirs' }, { name: 'EnemyThree', team: 'theirs' }, { name: 'EnemyFour', team: 'theirs' }, { name: 'EnemyFive', team: 'theirs' },
] as const;

describe('VOD timeline evidence', () => {
  it('keeps late score samples inside measured game windows', () => {
    const collect = (startSeconds: number, endSeconds: number, fps: number, frames: number) => {
      const collector = createChangeCollector({ key: 'endBannerSnapshots', label: 'end', width: 1, height: 1, fps, threshold: 0, burstFrames: 0, maxCandidates: 240, everySeconds: 0 }, endSeconds + 10, { startSeconds, endSeconds, sampledDuration: endSeconds - startSeconds }, null, null);
      for (let index = 0; index < frames; index += 1) collector.push(Buffer.from([index]));
      return collector.frames().map((frame: any) => frame.timestampMs);
    };
    // Full containing window, not a narrowed crop around the known result.
    const vod2g2 = collect(3_888, 7_504, 1, 3_617);
    expect(vod2g2.every(timestamp => timestamp >= 3_888_000 && timestamp <= 7_504_000)).toBe(true);
    expect(vod2g2.filter(timestamp => timestamp >= 6_822_000 && timestamp <= 6_852_000).length).toBeGreaterThanOrEqual(2);
    const vod3g3 = collect(8_928, 10_079, 1, 1_152);
    expect(vod3g3.every(timestamp => timestamp >= 8_928_000 && timestamp <= 10_079_000)).toBe(true);
    expect(vod3g3.filter(timestamp => timestamp >= 10_076_000 && timestamp <= 10_079_000)).toEqual([10_076_000, 10_077_000, 10_078_000, 10_079_000]);
  });

  it('retains TAB openings from one 0.25-second frame through 4.5 seconds', () => {
    const retained = (frames: number) => {
      const collector = createChangeCollector({ key: 'tabBoardSnapshots', label: 'TAB', width: 1, height: 1, fps: 4, threshold: 1, burstFrames: 0, maxCandidates: 480, everySeconds: 0, rank: () => 10, rankKeep: 9, rankOnly: true }, 600, { startSeconds: 100, endSeconds: 200, sampledDuration: 100 }, null, null);
      for (let index = 0; index < frames; index += 1) collector.push(Buffer.from([index]));
      return collector.frames();
    };
    expect(retained(1).map((frame: any) => frame.timestampMs)).toEqual([100_000]);
    expect(retained(18).length).toBeGreaterThan(0);
  });
  it('runs with no known player identity on an empty workspace and says what is missing', () => {
    expect(normalizeTimelinePlayers(undefined)).toEqual([]);
    expect(normalizeTimelinePlayers([])).toEqual([]);
    expect(normalizeTimelinePlayers([{ name: '  ' }, { name: 'Alpha', team: 'theirs', expectedKills: -1, expectedDeaths: 3 }, null])).toEqual([{ name: 'Alpha', team: 'theirs', expectedKills: null, expectedDeaths: 3 }]);
    const result = aggregateVideoEvidence({ players: [], durationMs: 60_000,
      killFeedSnapshots: [{ timestampMs: 1_000, text: 'Alpha Vandal EnemyOne', confidence: .9 }],
      roundStateSnapshots: [{ timestampMs: 500, text: '0 0 1:39', confidence: .9 }],
    });
    // Nobody is credited and nothing is invented: unknown stays unknown, never zero for a named player.
    expect(result.playerMetrics).toEqual([]);
    expect(result.observations.filter((event: any) => event.kind === 'elimination')).toEqual([]);
    expect(result.coverage.signals.eliminations).toBe('unsupported');
    expect(result.coverage.killFeedSnapshots).toBe(1);
    expect(result.limitations).toContain(NO_IDENTITIES_LIMITATION);
    expect(NO_IDENTITIES_LIMITATION).toMatch(/Roster/);
    // Named analyses keep their existing limitations untouched.
    expect(aggregateVideoEvidence({ players, durationMs: 60_000 }).limitations).not.toContain(NO_IDENTITIES_LIMITATION);
  });

  it('parses ordered cross-team kill-feed names without inventing same-team events', () => {
    expect(parseKillFeedSnapshot({ timestampMs: 1_000, text: 'Alpha Vandal EnemyOne', confidence: .9 }, players)).toEqual([
      expect.objectContaining({ kind: 'elimination', killer: 'Alpha', victim: 'EnemyOne', killerTeam: 'ours', victimTeam: 'theirs' }),
    ]);
    expect(parseKillFeedSnapshot({ timestampMs: 1_000, text: 'Alpha assisted Bravo', confidence: .9 }, players)).toEqual([]);
  });

  it('deduplicates persistent feed rows and derives a covered trade and KAST sample', () => {
    const result = aggregateVideoEvidence({ players, durationMs: 120_000, killFeedSnapshots: [
      { timestampMs: 10_000, text: 'EnemyOne Vandal Alpha', confidence: .9 },
      { timestampMs: 12_000, text: 'EnemyOne Vandal Alpha', confidence: .8 },
      { timestampMs: 14_000, text: 'Bravo Phantom EnemyOne', confidence: .9 },
    ] });
    expect(result.coverage.resolvedEliminations).toBe(2);
    expect(result.playerMetrics.find((row: any) => row.playerName === 'Alpha')).toMatchObject({ deaths: 1, trades: 1, kastSuccessful: 1, kastCovered: 1, kastRate: 100 });
    expect(result.coverage.signals.throws).toBe('unsupported');
    expect(result.throwCandidates).toEqual([]);
  });

  it('counts only a supported full-to-empty ultimate transition', () => {
    const parsed = parseUltimateSnapshots([
      { timestampMs: 1_000, text: '7 / 7', confidence: .9 },
      { timestampMs: 8_000, text: '0 / 7', confidence: .9 },
      { timestampMs: 40_000, text: '1 / 7', confidence: .9 },
    ], 'Alpha');
    expect(parsed.uses).toHaveLength(1);
  });

  it('keeps a six-of-seven reset as an ultimate candidate rather than a confirmed use', () => {
    const parsed = parseUltimateSnapshots([
      { timestampMs: 1_000, text: '6 / 7', confidence: .9 },
      { timestampMs: 8_000, text: '0 / 7', confidence: .9 },
    ], 'Alpha');
    expect(parsed.uses).toEqual([]);
    expect(parsed.candidates).toEqual([expect.objectContaining({ kind: 'ultimate-use-candidate', reason: 'not-confirmed-ready' })]);
  });

  it('does not call trade timing complete when reconciled eliminations share a sampled frame', () => {
    const reconciled = players.map(player => ({ ...player, expectedKills: player.team === 'ours' ? (player.name === 'Alpha' ? 1 : 0) : undefined, expectedDeaths: player.team === 'ours' ? (player.name === 'Bravo' ? 1 : 0) : undefined }));
    const result = aggregateVideoEvidence({ players: reconciled, durationMs: 60_000, killFeedSnapshots: [
      { timestampMs: 10_000, text: 'Alpha Vandal EnemyOne\nEnemyTwo Vandal Bravo', confidence: .9 },
    ] });
    expect(result.coverage.signals.eliminations).toBe('complete');
    expect(result.coverage.signals.trades).toBe('partial');
    expect(result.coverage.temporalAmbiguities).toBe(1);
  });

  it('uses score and buy-phase transitions as authoritative round boundaries', () => {
    const states = [
      parseRoundStateSnapshot({ timestampMs: 1_000, text: 'BUY PHASE 0 - 0 ROUND 1', confidence: .9 }),
      parseRoundStateSnapshot({ timestampMs: 75_000, text: 'BUY PHASE 1 - 0 ROUND 2', confidence: .9 }),
      parseRoundStateSnapshot({ timestampMs: 145_000, text: 'BUY PHASE 1 - 1 ROUND 3', confidence: .9 }),
    ];
    const result = buildRoundTimeline(states, [{ timestampMs: 30_000, kind: 'elimination' }, { timestampMs: 100_000, kind: 'elimination' }]);
    expect(result.mode).toBe('authoritative');
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds[1]).toMatchObject({ roundNumber: 2, boundarySource: 'round-state' });
  });

  it('tracks observer POV changes and attributes personal orb and ultimate evidence', () => {
    const result = aggregateVideoEvidence({ players, observerMode: true, durationMs: 90_000,
      povSnapshots: [{ timestampMs: 1_000, text: 'Alpha', confidence: .9 }, { timestampMs: 8_000, text: 'Alpha', confidence: .9 }],
      objectiveSnapshots: [{ timestampMs: 9_000, text: 'ULTIMATE ORB CAPTURED', confidence: .9 }],
      ultimateSnapshots: [{ timestampMs: 2_000, text: '7/7', confidence: .9 }, { timestampMs: 10_000, text: '0/7', confidence: .9 }],
    });
    expect(buildObserverSegments([{ timestampMs: 1_000, text: 'Alpha' }], players, null, true, 90_000)[0].player).toBe('Alpha');
    expect(result.playerMetrics.find((row: any) => row.playerName === 'Alpha')).toMatchObject({ orbCaptures: 1, ultimateUses: 1 });
  });

  it('extracts weapon, headshot and assistant detail while tracking a persistent feed row once', () => {
    const result = aggregateVideoEvidence({ players, durationMs: 30_000, killFeedSnapshots: [
      { timestampMs: 1_000, text: 'Alpha Bravo Vandal HEADSHOT EnemyOne', confidence: .8 },
      { timestampMs: 2_000, text: 'Alpha Bravo Vandal HEADSHOT EnemyOne', confidence: .9 },
    ] });
    expect(result.observations.filter((item: any) => item.kind === 'elimination')).toEqual([
      expect.objectContaining({ killer: 'Alpha', victim: 'EnemyOne', weapon: 'vandal', headshot: true, assistants: ['Bravo'], firstSeenMs: 1_000, lastSeenMs: 2_000 }),
    ]);
  });

  it('recognizes a learned visual icon only when one template wins clearly', () => {
    const labeled = applyVisualTemplates([{ timestampMs: 1, text: 'Alpha EnemyOne', visualSignature: '000000000000000f' }], [
      { id: 'hs-1', label: 'kill:headshot', signature: '000000000000000e', maxDistance: 2 },
      { id: 'op-1', label: 'weapon:operator', signature: 'ffffffffffffffff', maxDistance: 2 },
    ]);
    expect(labeled[0]).toMatchObject({ visualLabels: ['kill:headshot'], visualMatch: { templateId: 'hs-1', distance: 1 } });
  });

  it('fuses independent VOD sources without double-counting the same event', () => {
    const first = aggregateVideoEvidence({ players, durationMs: 30_000, killFeedSnapshots: [{ timestampMs: 1_000, text: 'Alpha Vandal EnemyOne' }] });
    const second = aggregateVideoEvidence({ players, durationMs: 30_000, killFeedSnapshots: [{ timestampMs: 2_000, text: 'Alpha Vandal EnemyOne' }, { timestampMs: 8_000, text: 'Bravo Phantom EnemyTwo' }] });
    first.source = { kind: 'youtube', sha256: 'a'.repeat(64), width: 1920, height: 1080, durationMs: 30_000, analyzedAt: new Date().toISOString() };
    second.source = { kind: 'local-file', sha256: 'b'.repeat(64), width: 1920, height: 1080, durationMs: 30_000, analyzedAt: new Date().toISOString() };
    const fused = fuseVodEvidence([first, second]);
    expect(fused.fusion.sourceCount).toBe(2);
    expect(fused.observations.filter((item: any) => item.kind === 'elimination')).toHaveLength(2);
    expect(fused.rounds).toHaveLength(1);
    expect(fused.rounds[0].events).toHaveLength(2);
  });

  it('accepts only supported YouTube URL forms and detects changed frames', () => {
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/live/6sx2Wpl0cHc?feature=share')).toBe('6sx2Wpl0cHc');
    expect(youtubeVideoId('youtube.com/live/6sx2Wpl0cHc?feature=share')).toBe('6sx2Wpl0cHc');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=-rYGPdX\\_NNU')).toBe('-rYGPdX_NNU');
    expect(youtubeVideoId('[player VOD](https://www.youtube.com/watch?v=-rYGPdX_NNU)')).toBe('-rYGPdX_NNU');
    expect(normalizeYoutubeUrl('<https://youtu.be/abcdefghijk?feature=share>')).toBe('https://youtu.be/abcdefghijk?feature=share');
    expect(normalizeYoutubeUrl('youtube.com/live/6sx2Wpl0cHc?feature=share')).toBe('https://youtube.com/live/6sx2Wpl0cHc?feature=share');
    expect(youtubeVideoId('https://youtube.example/watch?v=abcdefghijk')).toBeNull();
    expect(frameDifference(Buffer.from([0, 0, 0]), Buffer.from([255, 0, 0]))).toBe(1);
    expect(visualSignature(Buffer.alloc(128, 42))).toMatch(/^[a-f0-9]{16}$/);
  });

  it('ships the native image processor required by installed VOD discovery', async () => {
    const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'));
    expect(packageJson.dependencies.sharp).toBeTruthy();
    expect(packageJson.build.asarUnpack).toContain('node_modules/@img/**/*');
  });

  it('ranks repeated scoreboard row geometry above a blank video frame', () => {
    const width = 480; const height = 270; const blank = Buffer.alloc(width * height * 3, 20); const board = Buffer.from(blank);
    for (let row = 0; row <= 10; row += 1) { const y = Math.round((321 + row * 48) * height / 1080); for (let x = Math.round(430 * width / 1920); x <= Math.round(1740 * width / 1920); x += 1) for (let channel = 0; channel < 3; channel += 1) board[(y * width + x) * 3 + channel] = 220; }
    expect(scoreboardGeometryScore(board, width, height)).toBeGreaterThan(scoreboardGeometryScore(blank, width, height) + 20);
  });

  it('uses both lobby color and row geometry to choose the requested game starts', () => {
    const candidates = [
      { timestampMs: 300_000, score: 33, agentSelectScore: 70 }, { timestampMs: 500_000, score: 32, agentSelectScore: 72 },
      { timestampMs: 2_640_000, score: 8, agentSelectScore: 81 },
      { timestampMs: 3_864_000, score: 33, agentSelectScore: 71 }, { timestampMs: 7_488_000, score: 33, agentSelectScore: 71 },
      { timestampMs: 8_928_000, score: 4, agentSelectScore: 87 },
    ];
    expect(chooseGameBoundaries(candidates, 10_180_000, 3).map((item: any) => item.timestampMs)).toEqual([500_000, 3_864_000, 7_488_000]);
  });

  it('infers a stable player POV only when one roster name clearly dominates', () => {
    const snapshots = [1, 2, 3, 4].map(timestampMs => ({ timestampMs, text: 'Alpha SWITCH PLAYER' }));
    expect(inferPovPlayer(snapshots, players)).toBe('Alpha');
    expect(inferPovPlayer([...snapshots, ...snapshots.map(item => ({ ...item, text: 'Bravo SWITCH PLAYER' }))], players)).toBeNull();
    const width = 120; const height = 90; const blue = Buffer.alloc(width * height * 3); for (let index = 0; index < blue.length; index += 3) { blue[index] = 50; blue[index + 1] = 150; blue[index + 2] = 210; }
    expect(agentSelectGeometryScore(blue, width, height)).toBeGreaterThan(50);
  });

  it('cancels a long-running analysis before starting external video tools', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-cancel-'));
    const controller = new AbortController(); controller.abort(new Error('cancelled by test'));
    await expect(analyzeVodTimeline({ localPath: path.join(directory, 'missing.mp4'), players: [] }, { workRoot: directory, minimumFreeBytes: 1, signal: controller.signal })).rejects.toThrow('cancelled by test');
    expect(await fs.readdir(directory)).toEqual([]);
    await fs.rm(directory, { recursive: true, force: true });
  });

  // A synthetic end screen: dark overlay, two wide words and two short numbers between them; the
  // right number is dimmer, as the red digit is in grayscale.
  const bannerFrame = () => {
    const width = 400, height = 60, pixels = Buffer.alloc(width * height, 30);
    const block = (from: number, to: number, value: number) => { for (let y = 15; y < 45; y += 1) for (let x = from; x <= to; x += 1) pixels[y * width + x] = value; };
    block(20, 110, 230); block(160, 175, 210); block(220, 250, 110); block(290, 390, 230);
    return { pixels, width, height };
  };

  it('cuts the two end-screen scores out from between ALLIES and ENEMIES, dark on light', () => {
    const frame = bannerFrame(); const crop = bannerDigitCrop(frame.pixels, frame.width, frame.height);
    expect(crop).toMatchObject({ width: (289 - 111 + 1) + 20, height: 30 + 20 });
    // The red (dim) digit survives binarization as ink, the background is white.
    const inkColumns = new Set<number>(); for (let y = 0; y < crop.height; y += 1) for (let x = 0; x < crop.width; x += 1) if (crop.pixels[y * crop.width + x] === 0) inkColumns.add(x);
    expect(inkColumns.has(160 - 111 + 10)).toBe(true); expect(inkColumns.has(235 - 111 + 10)).toBe(true); expect(crop.pixels[0]).toBe(255);
    // A line without the two words around something narrower does not split.
    expect(bannerDigitCrop(Buffer.alloc(400 * 60, 30), 400, 60)).toBeNull();
  });

  // The end screen as the analyzer crops it (x 0.15-0.85, y 0.42-0.55 of the frame, 980x182), with
  // glyphs where the trial VOD showed them at 7-17: dim teal/red words, lit digits, a dark overlay.
  const endScreenFrame = () => {
    const width = 980, height = 182, pixels = Buffer.alloc(width * height, 25);
    const x = (value: number) => Math.round((value - .15) / .70 * width), y = (value: number) => Math.round((value - .42) / .13 * height);
    const block = (x0: number, x1: number, y0: number, y1: number, value: number) => { for (let row = y(y0); row <= y(y1); row += 1) for (let col = x(x0); col <= x(x1); col += 1) pixels[row * width + col] = value; };
    block(.195, .255, .47, .49, 140); block(.740, .812, .47, .49, 120);
    block(.267, .281, .457, .514, 210);
    block(.702, .711, .458, .514, 190); block(.714, .725, .458, .514, 190);
    return { pixels, width, height };
  };

  // A fake worker that answers by what it is shown: the stretched full line, a score box, or anything else.
  const fakeWorker = (answers: { line: string; boxLeft: string; boxRight: string; other?: string }) => {
    const frame = endScreenFrame(); const [left, right] = SCORE_BOXES.map((box: any) => scoreBoxCrop(frame.pixels, frame.width, frame.height, box));
    const calls: any[] = [];
    const worker = { calls, setParameters: vi.fn(async (params: any) => { calls.push(params); }), recognize: vi.fn(async (image: Buffer) => {
      const [, w, h] = String(image.subarray(0, 20)).split(/\s+/).map(Number);
      const text = w === 980 ? answers.line : w === left.width && h === left.height ? answers.boxLeft : w === right.width && h === right.height ? answers.boxRight : answers.other ?? '';
      return { data: { text } };
    }) };
    return worker;
  };

  it('stretches the dim end-screen words to black on white and cuts one crop per score', () => {
    const frame = bannerFrame(); const stretched = stretchedBanner(frame.pixels, frame.width, frame.height);
    expect(stretched.pixels[0]).toBe(255); expect(stretched.pixels[20 * 400 + 50]).toBe(0);
    const halves = splitDigitCrop(bannerDigitCrop(frame.pixels, frame.width, frame.height));
    expect(halves.map((half: any) => half.width)).toEqual([36, 51]);
    // A dash between the scores is where they split, never inside a two-digit score.
    const dashed = { width: 60, height: 20, pixels: Buffer.alloc(60 * 20, 255) };
    const ink = (from: number, to: number, top: number, bottom: number) => { for (let y = top; y <= bottom; y += 1) for (let x = from; x <= to; x += 1) dashed.pixels[y * 60 + x] = 0; };
    ink(2, 8, 2, 17); ink(20, 26, 9, 10); ink(32, 36, 2, 17); ink(40, 46, 2, 17);
    expect(splitDigitCrop(dashed).map((half: any) => half.width)).toEqual([7 + 20, 15 + 20]);
  });

  it('cuts each score from its fixed end-screen box, lit pixels only, scaled up 3x, without the words', () => {
    const frame = endScreenFrame(); const [left, right] = SCORE_BOXES.map((box: any) => scoreBoxCrop(frame.pixels, frame.width, frame.height, box));
    expect(left.glyphs).toHaveLength(1); expect(left.glyphs[0].width / left.glyphs[0].height).toBeGreaterThan(.35);
    expect(left.height % 3).toBe(0); expect(left.pixels[0]).toBe(255); expect(left.pixels.includes(0)).toBe(true);
    expect(right.glyphs).toHaveLength(2); expect(right.glyphs[0].width / right.glyphs[0].height).toBeLessThan(.35);
    // An empty box (no score there) gives nothing.
    expect(scoreBoxCrop(Buffer.alloc(980 * 182, 25), 980, 182, SCORE_BOXES[0])).toBeNull();
  });

  it('reads a wide lone glyph that Tesseract calls "1" as a 7, and leaves a narrow 1 alone', () => {
    expect(fixSevens('1', [{ width: 18, height: 41 }])).toBe('7');
    expect(fixSevens('11', [{ width: 11, height: 40 }, { width: 17, height: 40 }])).toBe('17');
    expect(fixSevens('1', [{ width: 11, height: 40 }])).toBe('1');
    expect(fixSevens('17\n', [{ width: 28, height: 40 }])).toBe('17');
    expect(fixSevens('', [])).toBeNull();
  });

  it('reads the end-screen words from the stretched line and each score from its own box, then restores the worker', async () => {
    const frame = endScreenFrame(); const worker = fakeWorker({ line: 'ALLIES | ENEMIES', boxLeft: '1', boxRight: '17', other: '717' });
    const snapshots = [{ timestampMs: 2_850_000, text: 'ALLIES | 1' }, { timestampMs: 2_900_000, text: 'spike planted' }]; const lines: string[] = [];
    const out = await readBannerDigits([{ ...frame, timestampMs: 2_800_000 }, { ...frame, timestampMs: 2_850_000 }, { ...frame, timestampMs: 2_900_000 }], snapshots, worker, (line: string) => lines.push(line), 40, null);
    expect(out.map((item: any) => [item.timestampMs, item.text])).toEqual([[2_800_000, 'ALLIES 7 - 17 ENEMIES'], [2_850_000, 'ALLIES 7 - 17 ENEMIES'], [2_900_000, 'ALLIES 7 - 17 ENEMIES']]);
    expect(lines.at(-1)).toBe('end-banner: frames 3, with text 2, anchor word 1, dark split 3, tried 3, anchor read 3, digits read 3');
    // One line per attempt with each crop's raw OCR text.
    expect(lines[0]).toMatch(/^end-banner attempt 2800s: crop (\d+x\d+|none), split .*, boxes \d+x\d+ \+ \d+x\d+\/\d+x\d+, line7 "ALLIES \| ENEMIES", line6 "ALLIES \| ENEMIES", boxLeft ".*box.*1.*", boxRight ".*"$/);
    expect(worker.calls).toEqual([{ tessedit_char_whitelist: '', tessedit_pageseg_mode: '7' }, { tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' }, { tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' }, { tessedit_char_whitelist: '', tessedit_pageseg_mode: '11' }]);
  });

  it('reads a two-digit score glyph by glyph, so the narrow leading 1 of "17" is never dropped', async () => {
    const frame = endScreenFrame(); const right = scoreBoxCrop(frame.pixels, frame.width, frame.height, SCORE_BOXES[1]);
    // Tesseract read the whole box as "7"; the narrow glyph is a 1 without OCR, the wide one reads "7".
    const seen: number[] = []; const text = async (image: any) => { seen.push(image.width); return '7'; };
    await expect(readScoreBox(right, text)).resolves.toMatchObject({ value: '17' });
    expect(seen).toEqual([right.glyphs[1].crop.width]);
    // Touching digits (no empty column between them) are split at the thinnest column.
    const touching = endScreenFrame(); const x = (value: number) => Math.round((value - .15) / .70 * 980), y = (value: number) => Math.round((value - .42) / .13 * 182);
    for (let row = y(.458); row <= y(.514); row += 1) for (let col = x(.711); col <= x(.714); col += 1) if (col !== x(.7125) || row % 3 === 0) touching.pixels[row * 980 + col] = 190;
    expect(scoreBoxCrop(touching.pixels, 980, 182, SCORE_BOXES[1]).glyphs).toHaveLength(2);
    // A lone wide glyph read as "1" is a 7.
    const left = scoreBoxCrop(frame.pixels, frame.width, frame.height, SCORE_BOXES[0]);
    await expect(readScoreBox(left, async () => '1')).resolves.toMatchObject({ value: '7' });
  });

  it('takes the scores from the stretched line when no score crop reads', async () => {
    const frame = endScreenFrame(); const worker = fakeWorker({ line: 'ALLIES 13 - 11 ENEMIES', boxLeft: '', boxRight: '' });
    expect((await readBannerDigits([{ ...frame, timestampMs: 5 }], [], worker, undefined, 40, null)).map((item: any) => item.text)).toEqual(['ALLIES 13 - 11 ENEMIES']);
  });

  it('never takes dark frames for the end screen when no frame of the game names a side (lobby, loading)', async () => {
    const frame = endScreenFrame(); const worker = fakeWorker({ line: '', boxLeft: '3', boxRight: '5', other: '3 5' });
    expect((await readBannerDigits([{ ...frame, timestampMs: 1 }, { ...frame, timestampMs: 2 }], [], worker, undefined, 40, null)).length).toBe(0);
  });

  it('uses confident digit OCR and repeated full geometry for a stylized defeat banner', async () => {
    const frame = endScreenFrame(); const worker = fakeWorker({ line: 'DEEEAT', boxLeft: '0', boxRight: '15', other: '' });
    let digitCall = 0; const digitReader = { read: async () => ({ text: digitCall++ % 2 === 0 ? '9' : '5', confidence: 95 }) };
    const out = await readBannerDigits([{ ...frame, timestampMs: 6_822_000 }, { ...frame, timestampMs: 6_842_000 }], [], worker, undefined, 40, digitReader);
    expect(out.map((item: any) => [item.timestampMs, item.text])).toEqual([[6_822_000, 'ALLIES 9 - 15 ENEMIES'], [6_842_000, 'ALLIES 9 - 15 ENEMIES']]);
  });

  it('keeps a short middle-of-window score banner when a later dark lobby fills the candidate tail', () => {
    const banner = endScreenFrame(); const lobbyPixels = Buffer.alloc(banner.width * banner.height, 25);
    const candidates = [
      ...Array.from({ length: 20 }, (_, index) => ({ frame: { width: banner.width, height: banner.height, pixels: lobbyPixels, timestampMs: 3_900_000 + index * 10_000 }, crop: null, snapshot: null, word: false })),
      ...[6_822_000, 6_842_000].map(timestampMs => ({ frame: { ...banner, timestampMs }, crop: bannerDigitCrop(banner.pixels, banner.width, banner.height), snapshot: null, word: false })),
      ...Array.from({ length: 60 }, (_, index) => ({ frame: { width: banner.width, height: banner.height, pixels: lobbyPixels, timestampMs: 6_900_000 + index * 10_000 }, crop: null, snapshot: null, word: false })),
    ];
    expect(selectBannerCandidates(candidates, 10).map((item: any) => item.frame.timestampMs)).toEqual(expect.arrayContaining([6_822_000, 6_842_000]));
  });

  it('crops the kill feed to its own box, which holds the coach-view rows measured at 720p', () => {
    expect(killFeedCrop()).toBe('crop=iw*0.25:ih*0.215:iw*0.74:ih*0.085');
    for (const row of [{ x0: .746, x1: .988, y0: .090, y1: .121 }, { x0: .762, x1: .990, y0: .088, y1: .121 }]) expect(row.x0 >= KILL_FEED_BOX.x0 && row.x1 <= KILL_FEED_BOX.x1 && row.y0 >= KILL_FEED_BOX.y0 && row.y1 <= KILL_FEED_BOX.y1).toBe(true);
    // Six rows at the measured pitch fit.
    expect(KILL_FEED_BOX.y0 + 6 * .033).toBeLessThanOrEqual(KILL_FEED_BOX.y1);
  });

  it('keeps a frame every few seconds of a static HUD, so the last score before a disconnect is read', () => {
    const spec = { key: 'roundStateSnapshots', label: 'hud', fps: 1, width: 2, height: 1, threshold: .5, burstFrames: 0, maxCandidates: 1000, everySeconds: 10 };
    const collector = createChangeCollector(spec, 100, { startSeconds: 0, sampledDuration: 100 }, null, undefined);
    collector.push(Buffer.alloc(2 * 60, 7)); // 60 identical frames
    expect(collector.frames().map((frame: any) => frame.timestampMs)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000]);
    const gated = createChangeCollector({ ...spec, everySeconds: 0 }, 100, { startSeconds: 0, sampledDuration: 100 }, null, undefined);
    gated.push(Buffer.alloc(2 * 60, 7)); expect(gated.frames()).toHaveLength(1);
  });

  it('logs kill-feed counts that show whether rows were read but named nobody of ours', () => {
    const line = killFeedSummary([{ text: 'Ana vandal Zed\nQuux phantom Bar' }, { text: '' }], [{ name: 'Ana', team: 'ours' }], { observations: [{ kind: 'elimination' }], playerMetrics: [{ team: 'ours', kills: 1, deaths: 0 }] });
    expect(line).toBe('kill-feed: frames 2, rows 2, rows with two names 2, rows naming ours 1, eliminations 1, our kills 1, our deaths 0');
  });

  // The coach-view TAB board crop (x 0.297-0.702 over most of the height): darker rows (teal or grey),
  // and in each of the ten rows lit digits in the K, D and A cells; shift moves the board up or down.
  const tabFrame = (shift = 0, rowValue = 30, rows = [...TAB_OUR_ROWS, ...TAB_OUR_ROWS.map(centre => centre + .2165)]) => {
    const { width, height } = TAB_FRAME, pixels = Buffer.alloc(width * height, 120);
    const x = (value: number) => Math.round((value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * width), y = (value: number) => Math.round((value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * height);
    const block = (x0: number, x1: number, y0: number, y1: number, value: number) => { for (let row = y(y0); row <= y(y1); row += 1) for (let col = x(x0); col <= x(x1); col += 1) pixels[row * width + col] = value; };
    for (const measured of rows) {
      const centre = measured + shift;
      block(TAB_BOX.x0, TAB_BOX.x1, centre - .015, centre + .015, rowValue);
      for (const cell of [TAB_CELLS.kills, TAB_CELLS.deaths, TAB_CELLS.assists]) block(cell.x0 + .003, cell.x0 + .008, centre - .006, centre + .006, 230);
      block(TAB_CELLS.name.x0 + .01, TAB_CELLS.name.x0 + .05, centre - .005, centre + .005, 220);
    }
    return { pixels, width, height };
  };

  it('tells a coach TAB board from gameplay before any OCR', () => {
    const frame = tabFrame(); expect(tabBoardRows(frame.pixels, frame.width, frame.height)).toBe(5);
    expect(tabBoardRows(Buffer.alloc(TAB_FRAME.width * TAB_FRAME.height, 120), TAB_FRAME.width, TAB_FRAME.height)).toBe(0);
  });

  it('finds the TAB board a few pixels off, on teal rows, and nowhere else', () => {
    for (const shift of [-.008, .008]) { const frame = tabFrame(shift); const fit = tabBoardFit(frame.pixels, frame.width, frame.height); expect(isTabBoard(fit)).toBe(true); }
    // The coach view always puts the board at the same height: rows like it far above or below are gameplay.
    for (const shift of [-.2, .15]) { const frame = tabFrame(shift); expect(isTabBoard(tabBoardFit(frame.pixels, frame.width, frame.height))).toBe(false); }
    // Our five rows alone are not the board; both teams' rows show when TAB is held.
    const half = tabFrame(0, 30, TAB_OUR_ROWS); expect(isTabBoard(tabBoardFit(half.pixels, half.width, half.height))).toBe(false);
    // Bright texture in the ULTIMATE-K gap between rows (not inside them) is gameplay too.
    const between = tabFrame(); const bx = (value: number) => Math.round((value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * between.width), by = (value: number) => Math.round((value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * between.height);
    for (let row = by(.5); row <= by(.53); row += 1) for (let col = bx(.474); col <= bx(.486); col += 4) between.pixels[row * between.width + col] = 240;
    expect(isTabBoard(tabBoardFit(between.pixels, between.width, between.height))).toBe(false);
    const teal = tabFrame(0, 95); expect(tabBoardRows(teal.pixels, teal.width, teal.height)).toBe(5);
    // Gameplay: bright texture also between ULTIMATE and K, where a board row is empty.
    const busy = tabFrame(); const x = (value: number) => Math.round((value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * busy.width);
    for (let row = 0; row < busy.height; row += 3) for (let col = x(.474); col <= x(.486); col += 4) busy.pixels[row * busy.width + col] = 240;
    expect(tabBoardRows(busy.pixels, busy.width, busy.height)).toBeLessThan(4);
  });

  it('knows where the result-word end screen puts its digits', () => {
    const [left, right] = analyzerModule.RESULT_SCORE_BOXES;
    expect(left.x0).toBeLessThanOrEqual(.331); expect(left.x1).toBeGreaterThanOrEqual(.345); expect(left.x1).toBeLessThan(.375);
    expect(right.x0).toBeGreaterThan(.625); expect(right.x0).toBeLessThanOrEqual(.654); expect(right.x1).toBeGreaterThanOrEqual(.678);
    for (const box of [left, right]) { expect(box.y0).toBeLessThanOrEqual(.431); expect(box.y1).toBeGreaterThanOrEqual(.475); }
  });

  it('keeps a TAB board that is up for one sampled frame instead of the frame that closes it', () => {
    const board = tabFrame().pixels, gameplay = Buffer.alloc(TAB_FRAME.width * TAB_FRAME.height, 120), dark = Buffer.alloc(TAB_FRAME.width * TAB_FRAME.height, 10);
    const spec = { key: 'tabBoardSnapshots', label: 'TAB board', fps: 4, width: TAB_FRAME.width, height: TAB_FRAME.height, threshold: .2, burstFrames: 1, maxCandidates: 1, rank: tabBoardRows, rankKeep: 4 };
    const collector = createChangeCollector(spec, 10, { startSeconds: 0, sampledDuration: 10 }, null, undefined);
    collector.push(Buffer.concat([gameplay, gameplay, board, dark, gameplay]));
    const kept = collector.frames();
    expect(kept).toHaveLength(1);
    expect(tabBoardRows(kept[0].pixels, TAB_FRAME.width, TAB_FRAME.height)).toBe(5);
    expect(kept[0].timestampMs).toBe(500);
  });

  it('reads K, D and A of our five TAB rows with the digit reader, then the names, and restores the worker', async () => {
    const frame = tabFrame(); const calls: any[] = []; let names = 0;
    const worker = { setParameters: vi.fn(async (params: any) => { calls.push(params); }), recognize: vi.fn(async () => ({ data: { text: ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'][names++ % 5] } })) };
    const reader = { read: vi.fn(async () => ({ text: '8', confidence: 95 })) };
    const lines: string[] = [];
    const boards = await readCoachTabBoards([{ ...frame, timestampMs: 2_782_000 }, { ...frame, timestampMs: 2_782_500 }, { pixels: Buffer.alloc(TAB_FRAME.width * TAB_FRAME.height, 120), width: TAB_FRAME.width, height: TAB_FRAME.height, timestampMs: 10 }], worker, (line: string) => lines.push(line), 12, reader);
    expect(boards).toHaveLength(1);
    expect(boards[0].rows.map((row: any) => [row.name, row.kills, row.deaths, row.assists])).toEqual(['Ana', 'Ben', 'Cy', 'Dee', 'Eli'].map(name => [name, 8, 8, 8]));
    expect(lines).toEqual(['tab-board: frames 3, looked like a board 2, tried 1, boards read 1, last at 2782s; cells 15, numbers read 15 (0 as 1s), reader paddle']);
    expect(calls.at(-1)).toEqual({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '11' });
  });

  it('keeps an unsure digit read blank and reads a cell of narrow glyphs as 1s', async () => {
    const frame = tabFrame();
    const worker = { setParameters: vi.fn(async () => {}), recognize: vi.fn(async () => ({ data: { text: 'Ana' } })) };
    const unsure = await readCoachTabBoards([{ ...frame, timestampMs: 1000 }], worker, () => {}, 12, { read: async () => ({ text: '7', confidence: 69 }) });
    expect(unsure).toEqual([]);
    const { width, height } = TAB_FRAME, pixels = Buffer.alloc(width * height, 40);
    const x = (value: number) => Math.round((value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * width), y = (value: number) => Math.round((value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * height);
    for (let row = y(.323); row <= y(.335); row += 1) for (let col = x(.496); col <= x(.4975); col += 1) pixels[row * width + col] = 230;
    const cell = tabCellImage(pixels, width, height, { x0: .489, x1: .506, y0: .318, y1: .340 });
    expect(cell.glyphs).toHaveLength(1);
    expect(cell.glyphs[0].width / cell.glyphs[0].height).toBeLessThan(.35);
  });

  it('trusts a sure digit read over the narrow-glyph rule, which only fills a blank read', async () => {
    const frame = tabFrame(); const worker = { setParameters: vi.fn(async () => {}), recognize: vi.fn(async () => ({ data: { text: '' } })) };
    const lines: string[] = [];
    const sure = await readCoachTabBoards([{ ...frame, timestampMs: 1000 }], worker, (line: string) => lines.push(line), Infinity, { read: async () => ({ text: '4', confidence: 95 }) });
    expect(sure[0].rows.every((row: any) => row.kills === 4 && row.deaths === 4 && row.assists === 4)).toBe(true);
    expect(lines[0]).toContain('(0 as 1s)');
  });

  it('puts kill-feed words back into rows so killer and victim share a line', () => {
    const word = (text: string, x0: number, y0: number) => ({ text, bbox: { x0, y0, x1: x0 + 40, y1: y0 + 14 } });
    const data = { blocks: [{ paragraphs: [{ lines: [{ words: [word('Ana', 10, 10), word('Bob', 200, 12)] }, { words: [word('Cy', 12, 40)] }, { words: [word('Dee', 210, 41)] }] }] }] };
    expect(rowText(data)).toBe('Ana Bob\nCy Dee');
    expect(rowText({ blocks: null })).toBe('');
  });

  it('deletes a completed downloaded VOD but never deletes a coach-selected local file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-release-')); const downloaded = path.join(root, 'downloaded'); await fs.mkdir(downloaded); const downloadedFile = path.join(downloaded, 'vod.mp4'); await fs.writeFile(downloadedFile, 'video');
    await expect(releaseVodSource({ downloaded: true, directory: downloaded, file: downloadedFile }, true)).resolves.toBe(false); await expect(fs.stat(downloaded)).rejects.toThrow();
    const localFile = path.join(root, 'coach.mp4'); await fs.writeFile(localFile, 'video'); await expect(releaseVodSource({ downloaded: false, directory: root, file: localFile }, true)).resolves.toBe(true); expect(await fs.readFile(localFile, 'utf8')).toBe('video'); await fs.rm(root, { recursive: true, force: true });
  });

  it('removes a completed local VOD job frame folder but keeps the coach file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-frames-')); const frames = path.join(root, 'source-frames'); await fs.mkdir(frames);
    await fs.writeFile(path.join(frames, 'scoreboard-01.png'), 'png'); const localFile = path.join(root, 'coach.mp4'); await fs.writeFile(localFile, 'video');
    await expect(releaseVodSource({ downloaded: false, directory: frames, file: localFile }, true)).resolves.toBe(true);
    await expect(fs.stat(frames)).rejects.toThrow(); expect(await fs.readFile(localFile, 'utf8')).toBe('video');
    const paused = path.join(root, 'source-paused'); await fs.mkdir(paused);
    await expect(releaseVodSource({ downloaded: false, directory: paused, file: localFile }, false)).resolves.toBe(true); expect((await fs.stat(paused)).isDirectory()).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('sweeps work folders no restartable job references, including crashed downloads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-sweep-'));
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    for (const n of [1, 2, 3, 4]) await fs.mkdir(path.join(root, `source-${id(n)}`));
    await fs.writeFile(path.join(root, 'jobs.json'), '[]'); await fs.mkdir(path.join(root, 'unrelated'));
    const jobs = [
      { status: 'paused', resumable: true, checkpoint: { stage: 'import-paused', cacheId: id(1) } },
      { status: 'ready', cacheId: id(2), sourcePath: path.join(root, `source-${id(2)}`, 'vod.mp4') },
      { status: 'failed', resumable: false, stage: 'source-unavailable', cacheId: id(3) },
      { status: 'completed', cacheId: id(4) },
    ];
    expect((await sweepOrphanedVodDirectories(root, jobs)).sort()).toEqual([`source-${id(3)}`, `source-${id(4)}`]);
    expect((await fs.readdir(root)).sort()).toEqual(['jobs.json', `source-${id(1)}`, `source-${id(2)}`, 'unrelated']);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reconciles as complete only when every player row was checked', () => {
    const scoreboard = (names: readonly string[]) => [{ timestampMs: 5_000, text: names.map(name => `${name} 0 0 0`).join('\n'), confidence: .9 }];
    const fiveRows = aggregateVideoEvidence({ players, scoreboardSnapshots: scoreboard(players.slice(0, 5).map(player => player.name)) });
    expect(fiveRows.reconciliation).toMatchObject({ status: 'partial', comparedFields: 10 });
    const allRows = aggregateVideoEvidence({ players, scoreboardSnapshots: scoreboard(players.map(player => player.name)) });
    expect(allRows.reconciliation).toMatchObject({ status: 'matched', comparedFields: 20 });
    expect(allRows.coverage.signals.eliminations).toBe('complete');
  });

  it('counts our eliminations against unresolved opponents when no scoreboard named them', () => {
    const ours = players.filter(player => player.team === 'ours');
    const evidence = aggregateVideoEvidence({ players: ours, killFeedSnapshots: [
      { timestampMs: 1_000, text: 'Alpha Vandal Zorro99', confidence: .9 },
      { timestampMs: 2_000, text: 'KnightX Phantom Bravo', confidence: .9 },
      { timestampMs: 3_000, text: 'Charlie', confidence: .9 },
    ] });
    expect(evidence.playerMetrics.find((metric: any) => metric.playerName === 'Alpha')).toMatchObject({ kills: 1, deaths: 0 });
    expect(evidence.playerMetrics.find((metric: any) => metric.playerName === 'Bravo')).toMatchObject({ kills: 0, deaths: 1 });
    expect(evidence.observations.filter((item: any) => item.kind === 'elimination').map((item: any) => [item.killerTeam, item.victimTeam])).toEqual([['ours', 'theirs'], ['theirs', 'ours']]);
    // With named opponents, a one-name row stays unresolved rather than guessed.
    expect(parseKillFeedSnapshot({ timestampMs: 1_000, text: 'Alpha Vandal Zorro99', confidence: .9 }, players)).toEqual([]);
  });

  it('serves discovered candidate frames by name instead of inlining them in the discovery reply', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-frames-')); await fs.writeFile(path.join(directory, 'scoreboard-01.png'), 'png-bytes');
    await expect(readVodFrame(directory, 'scoreboard-01.png')).resolves.toEqual({ mediaType: 'image/png', base64: Buffer.from('png-bytes').toString('base64') });
    for (const frame of ['../scoreboard-01.png', 'vod.mp4', 'scoreboard-1.png']) await expect(readVodFrame(directory, frame)).rejects.toThrow('Unknown VOD frame.');
    // Only the window that ran the discovery can read its frames.
    const sources = new Map([['cache-1', { directory, owner: 7 }]]);
    await expect(readOwnedVodFrame(sources, 7, { cacheId: 'cache-1', frame: 'scoreboard-01.png' })).resolves.toMatchObject({ mediaType: 'image/png' });
    await expect(readOwnedVodFrame(sources, 8, { cacheId: 'cache-1', frame: 'scoreboard-01.png' })).rejects.toThrow('expired');
    await expect(readOwnedVodFrame(sources, 7, { cacheId: 'cache-2', frame: 'scoreboard-01.png' })).rejects.toThrow('expired');
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('resumes a retained download in its own directory and still deletes it once completed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-vod-resume-')); const directory = path.join(root, 'source-original'); await fs.mkdir(directory);
    const retained = path.join(directory, 'vod.mp4'); await fs.writeFile(retained, 'not a video');
    // A failed resumed discovery must never delete the retained source it reopened.
    await expect(discoverVodGames({ localPath: retained }, { workRoot: root, minimumFreeBytes: 1, resume: { cacheId: 'original', directory, downloaded: true } })).rejects.toThrow();
    expect(await fs.readFile(retained, 'utf8')).toBe('not a video');
    expect(await fs.readdir(root)).toEqual(['source-original']);
    const ffmpeg = (await import('ffmpeg-static')).default as unknown as string; const { execFileSync } = await import('node:child_process');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=4:duration=3', '-pix_fmt', 'yuv420p', '-y', retained]);
    const result = await discoverVodGames({ localPath: retained }, { workRoot: root, minimumFreeBytes: 1, resume: { cacheId: 'original', directory, downloaded: true } });
    expect(result).toMatchObject({ cacheId: 'original', directory: path.resolve(directory), downloaded: true, file: path.resolve(retained) });
    expect(await fs.readdir(root)).toEqual(['source-original']);
    await expect(releaseVodSource({ downloaded: true, directory, file: retained }, true)).resolves.toBe(false); await expect(fs.stat(directory)).rejects.toThrow();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('never treats a VOD uploader as a teammate and reuses only proven opponent identities', () => {
    const roster = [{ displayName: 'Alpha' }, { displayName: 'Bravo' }];
    const linked = { screenshotEvidence: { scoreboardPlayers: [
      { name: 'Alpha', allied: true }, { name: 'EnemyOne', allied: false }, { name: 'EnemyTwo', allied: false },
    ] } };
    expect(boundaryTimelinePlayers(roster, linked)).toEqual([
      { name: 'Alpha', team: 'ours' },
      { name: 'EnemyOne', team: 'theirs' }, { name: 'EnemyTwo', team: 'theirs' },
    ]);
    expect(boundaryTimelinePlayers(roster, null)).toEqual([]);
  });
});
