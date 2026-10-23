import { DEFAULT_OCR_ENGINE, normalizeOcrEngineId, type OcrEngineId } from '../../lib/ocrEngines';
import { createBrowserLocalTesseractAdapter, type LocalOcrAdapter } from '../../lib/localOcrEngine';
import { emptyGlyphTemplateSet, learnGlyphsFromCorrections, mergeGlyphTemplates, parseGlyphTemplates, serializeGlyphTemplates, type GlyphTemplateSet, type ScoreboardGlyphs } from '../../lib/glyphTemplates';
import type { OcrCorrectionSample } from '../../lib/ocrLearning';

/** Per-PC choice of number-reading engine. Unset, unreadable or unknown means Tesseract. */
const STORAGE_KEY = 'moetracker.ocr-engine/v1';

export function getOcrEngineSetting(): OcrEngineId {
  try { return normalizeOcrEngineId(localStorage.getItem(STORAGE_KEY)); } catch { return DEFAULT_OCR_ENGINE; }
}

export function setOcrEngineSetting(engine: OcrEngineId) {
  const value = normalizeOcrEngineId(engine);
  try {
    if (value === DEFAULT_OCR_ENGINE) localStorage.removeItem(STORAGE_KEY); else localStorage.setItem(STORAGE_KEY, value);
  } catch { /* Private storage only keeps the default. */ }
  return value;
}

const GLYPH_STORAGE_KEY = 'moetracker.glyph-templates/v1';

export function loadGlyphTemplates() {
  try { return parseGlyphTemplates(localStorage.getItem(GLYPH_STORAGE_KEY)); } catch { return emptyGlyphTemplateSet(); }
}

export function saveGlyphTemplates(set: GlyphTemplateSet) {
  try { localStorage.setItem(GLYPH_STORAGE_KEY, serializeGlyphTemplates(set)); } catch { /* Storage limits only stop the templates from persisting. */ }
}

/** Adds templates exported by the capture backtest (--save-templates). Returns how many examples were added. */
export function importGlyphTemplates(text: string) {
  const incoming = parseGlyphTemplates(text);
  if (!Object.keys(incoming.byResolution).length) throw new Error('That file holds no digit templates.');
  const set = loadGlyphTemplates(); const added = mergeGlyphTemplates(set, incoming); saveGlyphTemplates(set);
  return added;
}

export function resetGlyphTemplates() {
  try { localStorage.removeItem(GLYPH_STORAGE_KEY); } catch { /* nothing stored */ }
}

/**
 * The OCR adapter for this PC's chosen number reader. In Ensemble mode it
 * carries the learned digit templates and saves what it learned when it is
 * terminated. With any engine it keeps the K/D/A glyphs of the last full
 * scoreboard it read, for learnGlyphsFromReview.
 */
export async function createConfiguredOcrAdapter(): Promise<LocalOcrAdapter & { takeScoreboardGlyphs(): ScoreboardGlyphs | null }> {
  const engine = getOcrEngineSetting();
  const glyphTemplates = engine === 'ensemble' ? loadGlyphTemplates() : undefined;
  let glyphs: ScoreboardGlyphs | null = null;
  const adapter = await createBrowserLocalTesseractAdapter({
    engine, glyphTemplates,
    onKdaGlyphs: (regionId, resolution, numbers) => {
      const row = Number(/^player\.(\d+)\.kda$/.exec(regionId)?.[1]); if (!Number.isInteger(row)) return;
      // A new resolution or row 0 starts a new scoreboard.
      if (!glyphs || glyphs.resolution !== resolution || row === 0) glyphs = { resolution, rows: {} };
      glyphs.rows[row] = numbers;
    },
  });
  return {
    ...adapter,
    async terminate() { await adapter.terminate(); if (glyphTemplates && adapter.engine === 'ensemble') saveGlyphTemplates(glyphTemplates); },
    takeScoreboardGlyphs() { const taken = glyphs; glyphs = null; return taken; },
  };
}

/** After a review is saved: the coach's corrected and kept K/D/A cells teach the digit templates. */
export function learnGlyphsFromReview(glyphs: ScoreboardGlyphs | null | undefined, samples: readonly OcrCorrectionSample[], learningEnabled: boolean) {
  if (!learningEnabled || !glyphs) return 0;
  const set = loadGlyphTemplates(); const learned = learnGlyphsFromCorrections(set, glyphs, samples);
  if (learned) saveGlyphTemplates(set);
  return learned;
}
