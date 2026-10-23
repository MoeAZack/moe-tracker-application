import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlyphFeature } from '../lib/glyphTemplates';

// One board's K/D/A glyphs must never be labelled with another board's saved values.

type OnKdaGlyphs = (regionId: string, resolution: string, numbers: GlyphFeature[][]) => void;
const hooks: { onKdaGlyphs?: OnKdaGlyphs } = {};
vi.mock('../lib/localOcrEngine', () => ({
  createBrowserLocalTesseractAdapter: async (options: { onKdaGlyphs?: OnKdaGlyphs }) => {
    hooks.onKdaGlyphs = options.onKdaGlyphs;
    return { engine: 'tesseract', recognize: async () => [], terminate: async () => {} };
  },
}));

const storage = new Map<string, string>();
beforeEach(() => {
  storage.clear(); hooks.onKdaGlyphs = undefined;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

const glyph = (marker: number): GlyphFeature[][] => [[{ vector: new Float32Array([marker]), aspect: 1 }], [], []];

describe('the scoreboard glyph buffer', () => {
  it('row 0 starts a new scoreboard: rows from the previous board do not carry over', async () => {
    const { createConfiguredOcrAdapter } = await import('../src/utils/ocrEngineSetting');
    const adapter = await createConfiguredOcrAdapter();
    hooks.onKdaGlyphs!('player.0.kda', '1080p', glyph(1));
    hooks.onKdaGlyphs!('player.7.kda', '1080p', glyph(2));
    hooks.onKdaGlyphs!('player.0.kda', '1080p', glyph(3));
    hooks.onKdaGlyphs!('player.1.kda', '1080p', glyph(4));
    const taken = adapter.takeScoreboardGlyphs()!;
    expect(Object.keys(taken.rows).map(Number)).toEqual([0, 1]);
    expect(taken.rows[0][0][0].vector[0]).toBe(3);
  });

  it('a new resolution starts a new scoreboard too, and non-K/D/A regions are ignored', async () => {
    const { createConfiguredOcrAdapter } = await import('../src/utils/ocrEngineSetting');
    const adapter = await createConfiguredOcrAdapter();
    hooks.onKdaGlyphs!('player.3.kda', '1080p', glyph(1));
    hooks.onKdaGlyphs!('player.4.kda', '900p', glyph(2));
    hooks.onKdaGlyphs!('player.5.name', '900p', glyph(3));
    const taken = adapter.takeScoreboardGlyphs()!;
    expect(taken).toMatchObject({ resolution: '900p' });
    expect(Object.keys(taken.rows).map(Number)).toEqual([4]);
  });

  it('taking the glyphs empties the buffer, so a later save cannot reuse them', async () => {
    const { createConfiguredOcrAdapter } = await import('../src/utils/ocrEngineSetting');
    const adapter = await createConfiguredOcrAdapter();
    hooks.onKdaGlyphs!('player.0.kda', '1080p', glyph(1));
    expect(adapter.takeScoreboardGlyphs()).not.toBeNull();
    expect(adapter.takeScoreboardGlyphs()).toBeNull();
  });
});

describe('Scrim import clears glyphs from an earlier capture', () => {
  const source = fs.readFileSync('src/components/ScrimImport.tsx', 'utf8');
  const body = (name: string) => {
    const start = source.indexOf(`const ${name} = async () => {`);
    expect(start, name).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('\n  };\n', start));
  };

  it('a server-side import drops the previous capture\'s glyphs before it starts', () => {
    const runImport = body('runImport');
    expect(runImport).toMatch(/scoreboardGlyphs\.current = null;/);
    expect(runImport.indexOf('scoreboardGlyphs.current = null;')).toBeLessThan(runImport.indexOf("apiFetch('/api/import-scrim'"));
  });

  it('a capture read drops them before reading and keeps only what this read produced', () => {
    const load = body('loadLatestCapture');
    expect(load.indexOf('scoreboardGlyphs.current = null;')).toBeGreaterThanOrEqual(0);
    expect(load.indexOf('scoreboardGlyphs.current = null;')).toBeLessThan(load.indexOf('createConfiguredOcrAdapter()'));
    expect(load).toMatch(/scoreboardGlyphs\.current = adapter\.takeScoreboardGlyphs\(\);/);
  });
});
