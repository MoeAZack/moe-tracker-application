import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import analyzerModule from '../desktop/vod-timeline-analyzer.cjs';

const { aggregateVideoEvidence, parseKillFeedSnapshot, parseUltimateSnapshots } = evidenceModule;
const { youtubeVideoId, frameDifference, scoreboardGeometryScore, agentSelectGeometryScore, chooseGameBoundaries, inferPovPlayer, analyzeVodTimeline } = analyzerModule;
const players = [
  { name: 'Alpha', team: 'ours' }, { name: 'Bravo', team: 'ours' }, { name: 'Charlie', team: 'ours' }, { name: 'Delta', team: 'ours' }, { name: 'Echo', team: 'ours' },
  { name: 'EnemyOne', team: 'theirs' }, { name: 'EnemyTwo', team: 'theirs' }, { name: 'EnemyThree', team: 'theirs' }, { name: 'EnemyFour', team: 'theirs' }, { name: 'EnemyFive', team: 'theirs' },
] as const;

describe('VOD timeline evidence', () => {
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

  it('accepts only supported YouTube URL forms and detects changed frames', () => {
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/live/6sx2Wpl0cHc?feature=share')).toBe('6sx2Wpl0cHc');
    expect(youtubeVideoId('https://youtube.example/watch?v=abcdefghijk')).toBeNull();
    expect(frameDifference(Buffer.from([0, 0, 0]), Buffer.from([255, 0, 0]))).toBe(255);
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
});
