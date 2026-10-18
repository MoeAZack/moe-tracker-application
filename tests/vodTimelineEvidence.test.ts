import { describe, expect, it } from 'vitest';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import analyzerModule from '../desktop/vod-timeline-analyzer.cjs';

const { aggregateVideoEvidence, parseKillFeedSnapshot, parseUltimateSnapshots } = evidenceModule;
const { youtubeVideoId, frameDifference } = analyzerModule;
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

  it('accepts only supported YouTube URL forms and detects changed frames', () => {
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://youtube.example/watch?v=abcdefghijk')).toBeNull();
    expect(frameDifference(Buffer.from([0, 0, 0]), Buffer.from([255, 0, 0]))).toBe(255);
  });
});
