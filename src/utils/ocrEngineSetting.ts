import { DEFAULT_OCR_ENGINE, normalizeOcrEngineId, type OcrEngineId } from '../../lib/ocrEngines';

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
