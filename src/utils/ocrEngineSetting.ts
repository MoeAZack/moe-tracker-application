import { DEFAULT_OCR_ENGINE, normalizeOcrEngineId, type OcrEngineId } from '../../lib/ocrEngines';
import { createBrowserLocalTesseractAdapter, type LocalOcrAdapter } from '../../lib/localOcrEngine';
import { emptyGlyphTemplateSet, parseGlyphTemplates, serializeGlyphTemplates, type GlyphTemplateSet } from '../../lib/glyphTemplates';

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

export function resetGlyphTemplates() {
  try { localStorage.removeItem(GLYPH_STORAGE_KEY); } catch { /* nothing stored */ }
}

/**
 * The OCR adapter for this PC's chosen number reader. In Ensemble mode it
 * carries the learned digit templates and saves what it learned when it is
 * terminated.
 */
export async function createConfiguredOcrAdapter(): Promise<LocalOcrAdapter> {
  const engine = getOcrEngineSetting();
  const glyphTemplates = engine === 'ensemble' ? loadGlyphTemplates() : undefined;
  const adapter = await createBrowserLocalTesseractAdapter({ engine, glyphTemplates });
  return { ...adapter, async terminate() { await adapter.terminate(); if (glyphTemplates && adapter.engine === 'ensemble') saveGlyphTemplates(glyphTemplates); } };
}
