import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import analyzerModule from '../desktop/vod-timeline-analyzer.cjs';

const { aggregateVideoEvidence, parseKillFeedSnapshot, parseUltimateSnapshots, parseRoundStateSnapshot, buildRoundTimeline, buildObserverSegments, applyVisualTemplates, fuseVodEvidence } = evidenceModule;
const { normalizeYoutubeUrl, youtubeVideoId, frameDifference, visualSignature, scoreboardGeometryScore, agentSelectGeometryScore, chooseGameBoundaries, inferPovPlayer, analyzeVodTimeline } = analyzerModule;
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
    expect(frameDifference(Buffer.from([0, 0, 0]), Buffer.from([255, 0, 0]))).toBe(255);
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
});
