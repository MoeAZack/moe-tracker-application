import { describe, expect, it } from 'vitest';
import { OCR_LEARNING_VERSION, applyLearnedCorrections, type LocalCorrectionModel } from '../lib/ocrLearning';
import { correctionModelFingerprint } from '../src/utils/localScoreboard';

const rule = (extra: Partial<LocalCorrectionModel['rules'][number]> = {}) => ({ field: 'kills' as const, predicted: 7, corrected: 17, confirmations: 2, sourceModel: 'local-v1', layout: 'custom', resolution: '1920x1080', sourceRegion: 'player.1.kills', ...extra });
const model = (rules = [rule()]): LocalCorrectionModel => ({ version: OCR_LEARNING_VERSION, rules });
const rows = [{ extractedName: 'Player1', kills: 7, deaths: 3 }, { extractedName: 'Player2', kills: 7, deaths: 3 }];
const context = { sourceModel: 'local-v1', layout: 'custom', resolution: '1920x1080' };

describe('learned corrections on any scoreboard read', () => {
  it('corrects only the cell the rule was learned on', () => {
    expect(applyLearnedCorrections(rows, model(), context).map(row => row.kills)).toEqual([7, 17]);
  });
  it('leaves rows untouched for another resolution, layout or OCR model, and without rules', () => {
    for (const other of [{ ...context, resolution: '1600x900' }, { ...context, layout: 'competitive' }, { ...context, sourceModel: 'local-v2' }]) expect(applyLearnedCorrections(rows, model(), other).map(row => row.kills)).toEqual([7, 7]);
    expect(applyLearnedCorrections(rows, undefined, context)).toEqual(rows);
    expect(applyLearnedCorrections(rows, model([]), context)).not.toBe(rows);
  });
  it('does not change the rows it was given', () => {
    const input = structuredClone(rows); applyLearnedCorrections(input, model(), context);
    expect(input).toEqual(rows);
  });
  it('changes the cache fingerprint when the rules change, and keeps one value without rules', () => {
    expect(correctionModelFingerprint(undefined)).toBe('none');
    expect(correctionModelFingerprint(model([]))).toBe('none');
    expect(correctionModelFingerprint(model())).not.toBe(correctionModelFingerprint(model([rule({ corrected: 18 })])));
  });
});

describe('single uploaded screenshot', () => {
  it('applies the learned corrections to a fresh read, and skips them for a hand-drawn selection', async () => {
    const { vi } = await import('vitest');
    vi.resetModules();
    vi.doMock('../src/utils/ocrLearningStore', () => ({ learnedExtractionRoster: async (roster: unknown) => roster, getOcrLearningState: async () => ({ model: model() }) }));
    vi.doMock('../lib/localOcrEngine', () => ({
      createValorantEndScreenProfile: () => ({ dimensions: { width: 1920, height: 1080 } }),
      createSelectedScoreboardProfile: () => ({ dimensions: { width: 1920, height: 1080 } }),
      measureScoreDigitBoxes: () => null, measureScoreboardRowOffset: () => 0,
      createBrowserLocalTesseractAdapter: async () => ({ terminate: async () => {} }),
      extractLocalScoreboardDraft: async () => ({ sourceMetadata: { model: 'local-v1' }, stats: structuredClone(rows) }),
    }));
    vi.stubGlobal('FileReader', class { result = 'data:image/png;base64,AA=='; onload: (() => void) | null = null; readAsDataURL() { queueMicrotask(() => this.onload?.()); } });
    vi.stubGlobal('Image', class { naturalWidth = 1920; naturalHeight = 1080; src = ''; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({}) }) }) });
    try {
      const { extractScoreboardLocally } = await import('../src/utils/localScoreboard');
      const file = (bytes: number[]) => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as File;
      expect((await extractScoreboardLocally(file([1]), [], undefined, { trackJob: false })).draft.stats.map((row: any) => row.kills)).toEqual([7, 17]);
      const selection = { names: { left: 0, top: 0, width: 1, height: 1 }, kda: { left: 0, top: 0, width: 1, height: 1 } };
      expect((await extractScoreboardLocally(file([2]), [], selection, { trackJob: false })).draft.stats.map((row: any) => row.kills)).toEqual([7, 7]);
    } finally { vi.unstubAllGlobals(); vi.doUnmock('../src/utils/ocrLearningStore'); vi.doUnmock('../lib/localOcrEngine'); vi.resetModules(); }
  });
});
