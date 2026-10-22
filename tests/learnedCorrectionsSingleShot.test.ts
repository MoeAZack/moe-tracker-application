import { describe, expect, it } from 'vitest';
import { OCR_LEARNING_VERSION, applyLearnedCorrections, buildLocalCorrectionModel, correctionSamplesFromAcceptedEdit, type LocalCorrectionModel } from '../lib/ocrLearning';
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

describe('where the rules come from', () => {
  const edit = (captureId: string, source: Record<string, unknown> = { source: 'scrim-import', sourceMetadata: { method: 'screenshot', model: 'local-v1' } }) => correctionSamplesFromAcceptedEdit({
    beforeMatch: { id: `m-${captureId}`, map: 'Ascent', screenshotEvidence: { captureId, diagnostics: { layout: 'custom', resolution: '1920x1080' } }, ...source },
    beforeStats: [{ player: 'Player1', kills: 20 }, { player: 'Player2', kills: 7 }],
    nextMatch: { id: `m-${captureId}`, map: 'Ascent' },
    nextStats: [{ player: 'Player1', kills: 20 }, { player: 'Player2', kills: 17 }],
    nextScoreboardRows: [0, 1],
  });
  it('applies a correction only once a coach has accepted the same fix on three captures', () => {
    const twice = buildLocalCorrectionModel([...edit('c1'), ...edit('c2')]);
    expect(applyLearnedCorrections(rows, twice, context).map(row => row.kills)).toEqual([7, 7]);
    const thrice = buildLocalCorrectionModel([...edit('c1'), ...edit('c2'), ...edit('c3')]);
    expect(applyLearnedCorrections(rows, thrice, context).map(row => row.kills)).toEqual([7, 17]);
  });
  it('learns nothing from edits to a match that was not read by OCR', () => {
    const manual = ['c1', 'c2', 'c3'].flatMap(id => edit(id, { source: 'manual', sourceMetadata: { method: 'manual' }, screenshotEvidence: undefined }));
    expect(manual).toEqual([]);
    expect(applyLearnedCorrections(rows, buildLocalCorrectionModel(manual), context)).toEqual(rows);
  });
});

describe('single upload cache and learned rules', () => {
  it('re-reads the same screenshot once a new rule is learned, and keeps the old cache key while there are no rules', async () => {
    const { vi } = await import('vitest');
    const { createHash } = await import('node:crypto');
    const { localScoreboardCacheKey } = await import('../lib/ocrResultCache');
    vi.resetModules();
    let current: LocalCorrectionModel = model([]);
    let reads = 0;
    vi.doMock('../src/utils/ocrLearningStore', () => ({ learnedExtractionRoster: async (roster: unknown) => roster, getOcrLearningState: async () => ({ model: current }) }));
    vi.doMock('../lib/localOcrEngine', () => ({
      createValorantEndScreenProfile: () => ({ dimensions: { width: 1920, height: 1080 } }),
      createSelectedScoreboardProfile: () => ({ dimensions: { width: 1920, height: 1080 } }),
      measureScoreDigitBoxes: () => null, measureScoreboardRowOffset: () => 0,
      createBrowserLocalTesseractAdapter: async () => ({ terminate: async () => {} }),
      extractLocalScoreboardDraft: async () => { reads += 1; return { sourceMetadata: { model: 'local-v1' }, stats: [{ extractedName: 'Player1', kills: 7, deaths: 3 }, { extractedName: 'Player2', kills: 7, deaths: 3 }, { extractedName: 'Player3', kills: 9, deaths: 3 }] }; },
    }));
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
    vi.stubGlobal('FileReader', class { result = 'data:image/png;base64,AA=='; onload: (() => void) | null = null; readAsDataURL() { queueMicrotask(() => this.onload?.()); } });
    vi.stubGlobal('Image', class { naturalWidth = 1920; naturalHeight = 1080; src = ''; async decode() {} });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({}) }) }) });
    try {
      const { extractScoreboardLocally } = await import('../src/utils/localScoreboard');
      const bytes = [9, 9, 9];
      const file = { arrayBuffer: async () => new Uint8Array(bytes).buffer } as unknown as File;
      const kills = (result: any) => result.draft.stats.map((row: any) => row.kills);

      // No rules: the cache key is exactly the one used before learned rules existed.
      const plain = await extractScoreboardLocally(file, [], undefined, { trackJob: false });
      const imageSha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
      expect(Object.keys(JSON.parse(stored.get('moetracker.local-scoreboard-cache/v2')!))).toEqual([localScoreboardCacheKey({ imageSha256, rosterPlayers: [], selection: undefined })]);
      expect([plain.cache, kills(plain), reads]).toEqual(['fresh', [7, 7, 9], 1]);
      expect((await extractScoreboardLocally(file, [], undefined, { trackJob: false })).cache).toBe('memory');

      // Model A (one rule): the same file is read again and corrected.
      current = model();
      const withA = await extractScoreboardLocally(file, [], undefined, { trackJob: false });
      expect([withA.cache, kills(withA), reads]).toEqual(['fresh', [7, 17, 9], 2]);
      expect((await extractScoreboardLocally(file, [], undefined, { trackJob: false })).cache).toBe('memory');

      // Model B (one more rule): fresh again, with both corrections.
      current = model([rule(), rule({ predicted: 9, corrected: 19, sourceRegion: 'player.2.kills' })]);
      const withB = await extractScoreboardLocally(file, [], undefined, { trackJob: false });
      expect([withB.cache, kills(withB), reads]).toEqual(['fresh', [7, 17, 19], 3]);
    } finally { vi.unstubAllGlobals(); vi.doUnmock('../src/utils/ocrLearningStore'); vi.doUnmock('../lib/localOcrEngine'); vi.resetModules(); }
  });
});
