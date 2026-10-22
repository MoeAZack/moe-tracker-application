import { describe, expect, it } from 'vitest';
import progressModule from '../desktop/vod-progress.cjs';
import { nextVodProgress, overallVodPercent, type VodProgress } from '../src/utils/vodImportRunner';

const { gameProgressReporter, regionProgress } = progressModule;

describe('one game of timeline scan as a single percentage', () => {
  it('never goes backwards across stages, region restarts and a decode fallback', () => {
    const seen: any[] = [];
    const report = gameProgressReporter((update: any) => seen.push(update));
    report({ stage: 'probe', percent: 100, message: 'probe' });
    for (const percent of [0, 30, 60, 99]) report({ stage: 'sampling', percent, message: 'one decode' });
    report({ stage: 'sampling', percent: null, message: 'Combined decode failed' });
    // Fallback: six regions, each reporting 0-99 on its own decode.
    for (let region = 0; region < 6; region += 1) {
      const scaled = regionProgress((update: any) => report(update), region, 6);
      for (const percent of [0, 50, 99]) scaled({ stage: 'sampling', percent, message: `region ${region}` });
    }
    for (const percent of [0, 25, 74, 100]) report({ stage: 'ocr', percent, message: 'reading' });
    report({ stage: 'complete', percent: 100, message: 'done' });
    const percents = seen.map(update => update.gamePercent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
    expect(seen.map(update => update.stageIndex)).toEqual([1, ...Array(5 + 18).fill(2), ...Array(5).fill(3)]);
    expect(seen.every(update => update.stageCount === 3)).toBe(true);
    expect(seen.at(-2)).toMatchObject({ stageLabel: 'Reading HUD text', percent: 100 });
  });

  it('scales a region into its slice of the sampling stage', () => {
    const seen: number[] = [];
    const scaled = regionProgress((update: any) => seen.push(update.percent), 2, 4);
    scaled({ stage: 'sampling', percent: 0 }); scaled({ stage: 'sampling', percent: 100 });
    expect(seen).toEqual([50, 75]);
    expect(regionProgress(null, 0, 6)).toBeNull();
  });

  it('passes other stages through untouched', () => {
    const seen: any[] = [];
    gameProgressReporter((update: any) => seen.push(update))({ stage: 'download', percent: 40, message: 'dl' });
    expect(seen).toEqual([{ stage: 'download', percent: 40, message: 'dl' }]);
  });
});

describe('import progress only moves forward', () => {
  const at = (step: number, stepPercent: number | null, status: VodProgress['status'] = 'working'): VodProgress => ({ owner: 'batch', step, stepPercent, message: `${step}:${stepPercent}`, status });

  it('keeps the higher percent within a step and refuses an earlier step', () => {
    expect(nextVodProgress(at(3, 60), at(3, 20))).toMatchObject({ step: 3, stepPercent: 60, message: '3:20' });
    expect(nextVodProgress(at(3, 60), at(3, null))).toMatchObject({ stepPercent: 60 });
    expect(nextVodProgress(at(4, 50), at(3, 90))).toMatchObject({ step: 4, stepPercent: 50, message: '3:90' });
    expect(nextVodProgress(at(3, 90), at(4, 0))).toMatchObject({ step: 4, stepPercent: 0 });
  });

  it('starts fresh after a run ends or for another owner', () => {
    expect(nextVodProgress(at(4, 100, 'done'), at(0, 0))).toMatchObject({ step: 0, stepPercent: 0 });
    expect(nextVodProgress(at(3, 90), { ...at(1, 10), owner: 'personal' })).toMatchObject({ step: 1, stepPercent: 10 });
    expect(nextVodProgress(at(3, 90), at(3, 10, 'error'))).toMatchObject({ status: 'error', stepPercent: 10 });
  });

  it('weights analysis as most of the overall bar and reaches 100 only when done', () => {
    expect(overallVodPercent(at(0, 100))).toBe(15);
    expect(overallVodPercent(at(3, 50))).toBe(63);
    expect(overallVodPercent(at(4, 100))).toBe(100);
    expect(overallVodPercent(at(4, 50, 'done'))).toBe(100);
  });
});
