import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyGlyphs,
  emptyGlyphTemplateSet,
  glyphFeatures,
  learnGlyphs,
  learnGlyphsFromCorrections,
  mergeGlyphTemplates,
  serializeGlyphTemplates,
  type ScoreboardGlyphs,
} from '../lib/glyphTemplates';
import type { OcrCorrectionSample } from '../lib/ocrLearning';
import { numberCrop, timelineNumberCrops } from '../scripts/ocrEngineFixtures.mts';

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

const sample = (field: OcrCorrectionSample['field'], rowIndex: number | null, corrected: string | number | null): OcrCorrectionSample => ({
  id: `${field}-${rowIndex}`, captureId: 'cap', matchId: 'match', playerId: null, field,
  predicted: null, corrected, modelVersion: 'test', recordedAt: '2026-10-23T00:00:00.000Z', rowIndex,
});

async function cropsByLabel(height = 1080) {
  const crops = await timelineNumberCrops(height);
  const features = (label: string) => glyphFeatures(numberCrop(crops.find(crop => crop.label === label)!));
  return { crops, features };
}

describe('learning digit templates from a saved review', () => {
  it('labels each row\'s K/D/A glyphs with the saved values, and nothing else', async () => {
    const { features } = await cropsByLabel();
    const glyphs: ScoreboardGlyphs = { resolution: '1080p', rows: { 0: [features('7'), features('12'), features('3')], 1: [features('5'), features('9'), features('1')] } };
    const set = emptyGlyphTemplateSet();
    const learned = learnGlyphsFromCorrections(set, glyphs, [
      sample('kills', 0, 7), sample('deaths', 0, 12), sample('assists', 1, 1),
      sample('deaths', 1, 19), // two digits for one glyph: skipped
      sample('name', 0, 'someone'), sample('kills', 4, 3), // not K/D/A / no glyphs for that row
      sample('kills', null, 5), sample('assists', 0, null), sample('assists', 0, -1), sample('assists', 0, 2.5),
    ]);
    expect(learned).toBe(3);
    expect(set.byResolution['1080p'].map(template => template.digit).sort()).toEqual(['1', '1', '2', '7']);
    expect(learnGlyphsFromCorrections(set, null, [sample('kills', 0, 7)])).toBe(0);
  });

  it('a corrected digit teaches the templates to read it next time', async () => {
    const { features } = await cropsByLabel();
    const set = emptyGlyphTemplateSet();
    expect(classifyGlyphs(set, '1080p', features('7')).text).toBe('');
    for (let game = 0; game < 3; game += 1) {
      learnGlyphsFromCorrections(set, { resolution: '1080p', rows: { [game]: [features('7'), features('8'), features('4')] } }, [sample('kills', game, 7), sample('deaths', game, 8), sample('assists', game, 4)]);
    }
    expect(classifyGlyphs(set, '1080p', features('7')).text).toBe('7');
  });
});

describe('merging and importing templates', () => {
  it('merges every template, keeps the per-digit cap, and the source\'s newest stays newest', async () => {
    const { crops } = await cropsByLabel();
    const source = emptyGlyphTemplateSet();
    for (const crop of crops) learnGlyphs(source, '1080p', glyphFeatures(numberCrop(crop)), crop.label);
    const target = emptyGlyphTemplateSet();
    const added = mergeGlyphTemplates(target, source);
    expect(added).toBe(source.byResolution['1080p'].length);
    expect(target.byResolution['1080p'].map(template => template.digit)).toEqual(source.byResolution['1080p'].map(template => template.digit));
    mergeGlyphTemplates(target, source);
    const perDigit = new Map<string, number>(); for (const template of target.byResolution['1080p']) perDigit.set(template.digit, (perDigit.get(template.digit) || 0) + 1);
    expect(Math.max(...perDigit.values())).toBeLessThanOrEqual(12);
  });

  it('imports a saved templates file into this PC\'s templates and refuses a file without any', async () => {
    vi.resetModules();
    const settings = await import('../src/utils/ocrEngineSetting');
    const { crops } = await cropsByLabel();
    const source = emptyGlyphTemplateSet();
    for (const crop of crops.slice(0, 40)) learnGlyphs(source, '1080p', glyphFeatures(numberCrop(crop)), crop.label);
    const added = settings.importGlyphTemplates(serializeGlyphTemplates(source));
    expect(added).toBeGreaterThan(0);
    expect(settings.loadGlyphTemplates().byResolution['1080p']).toHaveLength(added);
    expect(() => settings.importGlyphTemplates('{"version":"other"}')).toThrow(/no digit templates/);
    expect(settings.loadGlyphTemplates().byResolution['1080p']).toHaveLength(added);
  });

  it('learning from a review is skipped while OCR learning is paused', async () => {
    vi.resetModules();
    const settings = await import('../src/utils/ocrEngineSetting');
    const { features } = await cropsByLabel();
    const glyphs: ScoreboardGlyphs = { resolution: '1080p', rows: { 0: [features('7'), features('8'), features('4')] } };
    expect(settings.learnGlyphsFromReview(glyphs, [sample('kills', 0, 7)], false)).toBe(0);
    expect(settings.loadGlyphTemplates().byResolution).toEqual({});
    expect(settings.learnGlyphsFromReview(glyphs, [sample('kills', 0, 7)], true)).toBe(1);
    expect(settings.loadGlyphTemplates().byResolution['1080p']).toHaveLength(1);
  });
});

describe('capture backtest --save-templates', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/backtest-capture-browser.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8' });

  it('refuses to write templates inside the repository, and needs Ensemble', () => {
    const inside = run('--engine', 'ensemble', '--save-templates', 'tmp-templates.json', 'out', 'folder');
    expect(inside.status).not.toBe(0);
    expect(inside.stderr).toMatch(/outside the repository/);
    const wrongEngine = run('--save-templates', path.join(os.tmpdir(), 'templates.json'), 'out', 'folder');
    expect(wrongEngine.status).not.toBe(0);
    expect(wrongEngine.stderr).toMatch(/needs --engine ensemble/);
  });
});
