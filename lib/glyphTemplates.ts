/**
 * The third number voter: digit templates of VALORANT's own K/D/A font.
 *
 * Nothing is shipped pre-trained. In Ensemble mode, every K/D/A number that
 * PaddleOCR reads at or above GLYPH_LEARNING_CONFIDENCE, and that Tesseract
 * does not read differently, teaches the templates what each digit looks
 * like at this client resolution. Once a digit has enough examples the templates
 * vote too: each glyph is matched to its nearest template, and a number is
 * read only when every glyph wins clearly; otherwise the templates abstain.
 *
 * Templates are kept per scoreboard image height, since the same font is
 * drawn differently at 1080p and 900p, and capped per digit, newest first.
 */
import type { NumberRead, RgbaImage } from './ocrEngines';
import type { OcrCorrectionSample } from './ocrLearning';

export const GLYPH_TEMPLATE_VERSION = 'glyph-templates-v1';
const WIDTH = 12; const HEIGHT = 16; const SIZE = WIDTH * HEIGHT;
/** PaddleOCR must be at least this sure (calibrated scale; a probability of about 0.97) before a number teaches the templates. */
export const GLYPH_LEARNING_CONFIDENCE = 96;
/** Examples kept per digit per resolution. */
export const GLYPH_TEMPLATES_PER_DIGIT = 12;
/** Examples a digit needs before the templates will name it. */
export const GLYPH_MIN_EXAMPLES = 3;
/** Best-template correlation a glyph needs, and its lead over the best other digit. */
const MIN_SCORE = .8; const MIN_MARGIN = .05;
const INK = 110;

export interface GlyphFeature { vector: Float32Array; aspect: number }
export interface GlyphTemplate { digit: string; vector: Float32Array; aspect: number }
export interface GlyphTemplateSet { version: typeof GLYPH_TEMPLATE_VERSION; byResolution: Record<string, GlyphTemplate[]> }

export const emptyGlyphTemplateSet = (): GlyphTemplateSet => ({ version: GLYPH_TEMPLATE_VERSION, byResolution: {} });

/** Splits a dark-on-white number crop into glyphs at empty columns; each becomes a zero-mean, unit-length 12x16 vector. */
export function glyphFeatures(image: RgbaImage): GlyphFeature[] {
  const { width, height, data } = image;
  const ink = (x: number, y: number) => 255 - data[(y * width + x) * 4];
  const runs: Array<[number, number]> = []; let start = -1;
  for (let x = 0; x <= width; x += 1) {
    let column = false;
    if (x < width) for (let y = 0; y < height && !column; y += 1) column = ink(x, y) > INK;
    if (column && start < 0) start = x;
    if (!column && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  return runs.map(([left, right]) => {
    let top = height; let bottom = -1;
    for (let y = 0; y < height; y += 1) for (let x = left; x <= right; x += 1) if (ink(x, y) > INK) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    const glyphWidth = right - left + 1; const glyphHeight = bottom - top + 1;
    const vector = new Float32Array(SIZE); let mean = 0;
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const sx = left + Math.min(glyphWidth - 1, Math.floor((x + .5) * glyphWidth / WIDTH)); const sy = top + Math.min(glyphHeight - 1, Math.floor((y + .5) * glyphHeight / HEIGHT));
      vector[y * WIDTH + x] = ink(sx, sy) / 255; mean += vector[y * WIDTH + x];
    }
    mean /= SIZE; let norm = 0;
    for (let index = 0; index < SIZE; index += 1) { vector[index] -= mean; norm += vector[index] ** 2; }
    norm = Math.sqrt(norm) || 1;
    for (let index = 0; index < SIZE; index += 1) vector[index] /= norm;
    return { vector, aspect: glyphWidth / glyphHeight };
  });
}

/**
 * The label a read teaches, or null. PaddleOCR has to be very sure, and
 * Tesseract must not have read a different number (finding none is fine:
 * the templates are most useful exactly where Tesseract misses).
 */
export function glyphLearningLabel(tesseract: NumberRead, paddle: NumberRead): string | null {
  const label = String(paddle.text || '').trim(); const other = String(tesseract.text || '').trim();
  if (!/^\d{1,3}$/.test(label) || (paddle.confidence ?? 0) < GLYPH_LEARNING_CONFIDENCE) return null;
  return !other || other === label ? label : null;
}

/** Adds one labelled number. Ignored unless the crop splits into exactly one glyph per digit. */
export function learnGlyphs(set: GlyphTemplateSet, resolution: string, features: readonly GlyphFeature[], digits: string): boolean {
  if (!/^\d{1,3}$/.test(digits) || features.length !== digits.length) return false;
  const templates = set.byResolution[resolution] ||= [];
  features.forEach((feature, index) => templates.unshift({ digit: digits[index], vector: feature.vector, aspect: feature.aspect }));
  const kept: GlyphTemplate[] = []; const counts = new Map<string, number>();
  for (const template of templates) {
    const count = counts.get(template.digit) || 0;
    if (count < GLYPH_TEMPLATES_PER_DIGIT) { kept.push(template); counts.set(template.digit, count + 1); }
  }
  set.byResolution[resolution] = kept;
  return true;
}

/**
 * Reads a number from its glyphs, or abstains (empty text) when any glyph's
 * best digit is weak, too close to another digit, or has too few examples.
 * Confidence is the weakest glyph's correlation on Tesseract's 0..100 scale.
 */
export function classifyGlyphs(set: GlyphTemplateSet, resolution: string, features: readonly GlyphFeature[]): NumberRead {
  const templates = set.byResolution[resolution] || [];
  if (!features.length || features.length > 3 || !templates.length) return { text: '', confidence: null };
  const examples = new Map<string, number>(); for (const template of templates) examples.set(template.digit, (examples.get(template.digit) || 0) + 1);
  let text = ''; let confidence = 1;
  for (const feature of features) {
    const best = new Map<string, number>();
    for (const template of templates) {
      let score = 0; for (let index = 0; index < SIZE; index += 1) score += feature.vector[index] * template.vector[index];
      score -= Math.abs(Math.log(feature.aspect / template.aspect)) * .5;
      if (score > (best.get(template.digit) ?? -Infinity)) best.set(template.digit, score);
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    const [digit, score] = ranked[0]; const runnerUp = ranked[1]?.[1] ?? -1;
    if (score < MIN_SCORE || score - runnerUp < MIN_MARGIN || (examples.get(digit) || 0) < GLYPH_MIN_EXAMPLES) return { text: '', confidence: null };
    text += digit; confidence = Math.min(confidence, score);
  }
  return { text, confidence: Math.round(confidence * 100) };
}

/** Compact storage: each vector quantized to bytes, base64. */
export function serializeGlyphTemplates(set: GlyphTemplateSet): string {
  const encode = (vector: Float32Array) => { let binary = ''; for (const value of vector) binary += String.fromCharCode(Math.max(0, Math.min(255, Math.round((value + 1) * 127.5)))); return btoa(binary); };
  return JSON.stringify({ version: set.version, byResolution: Object.fromEntries(Object.entries(set.byResolution).map(([key, templates]) => [key, templates.map(template => [template.digit, Number(template.aspect.toFixed(4)), encode(template.vector)])])) });
}

export function parseGlyphTemplates(text: string | null | undefined): GlyphTemplateSet {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (parsed?.version !== GLYPH_TEMPLATE_VERSION || typeof parsed.byResolution !== 'object' || !parsed.byResolution) return emptyGlyphTemplateSet();
    const set = emptyGlyphTemplateSet();
    for (const [key, rows] of Object.entries(parsed.byResolution)) {
      if (!/^\d{3,4}p$/.test(key) || !Array.isArray(rows)) continue;
      set.byResolution[key] = rows.flatMap((row: unknown) => {
        if (!Array.isArray(row) || !/^\d$/.test(String(row[0])) || !Number.isFinite(row[1]) || Number(row[1]) <= 0 || typeof row[2] !== 'string') return [];
        const binary = atob(row[2]); if (binary.length !== SIZE) return [];
        const vector = new Float32Array(SIZE); for (let index = 0; index < SIZE; index += 1) vector[index] = binary.charCodeAt(index) / 127.5 - 1;
        return [{ digit: String(row[0]), aspect: Number(row[1]), vector }];
      }).slice(0, 10 * GLYPH_TEMPLATES_PER_DIGIT);
    }
    return set;
  } catch { return emptyGlyphTemplateSet(); }
}

export function glyphTemplateCounts(set: GlyphTemplateSet) {
  return Object.fromEntries(Object.entries(set.byResolution).map(([key, templates]) => [key, new Set(templates.filter((template, _index, all) => all.filter(other => other.digit === template.digit).length >= GLYPH_MIN_EXAMPLES).map(template => template.digit)).size]));
}

/** K/D/A glyphs of one full scoreboard read, by scoreboard row: [kills, deaths, assists] glyphs. */
export interface ScoreboardGlyphs { resolution: string; rows: Record<number, GlyphFeature[][]> }

const KDA_INDEX: Record<string, number> = { kills: 0, deaths: 1, assists: 2 };

/**
 * Teaches the templates from a saved review: every K/D/A cell the coach
 * corrected or kept, at a scoreboard row, labels that number's glyphs with
 * the saved value. These are the most useful examples there are: a
 * correction is exactly a digit the engines got wrong. A value whose digit
 * count doesn't match the glyphs found is skipped.
 */
export function learnGlyphsFromCorrections(set: GlyphTemplateSet, glyphs: ScoreboardGlyphs | null | undefined, samples: readonly OcrCorrectionSample[]) {
  if (!glyphs) return 0;
  let learned = 0;
  for (const sample of samples) {
    const index = KDA_INDEX[sample.field];
    if (index === undefined || !Number.isInteger(sample.rowIndex) || typeof sample.corrected !== 'number' || !Number.isInteger(sample.corrected) || sample.corrected < 0) continue;
    const features = glyphs.rows[sample.rowIndex!]?.[index];
    if (features && learnGlyphs(set, glyphs.resolution, features, String(sample.corrected))) learned += 1;
  }
  return learned;
}

/** Adds every template of `source` to `target` (newest-first caps still apply). Returns the number added. */
export function mergeGlyphTemplates(target: GlyphTemplateSet, source: GlyphTemplateSet) {
  let added = 0;
  for (const [resolution, templates] of Object.entries(source.byResolution)) {
    // Oldest first, so the source's newest examples end up newest in the target.
    for (const template of [...templates].reverse()) if (learnGlyphs(target, resolution, [{ vector: template.vector, aspect: template.aspect }], template.digit)) added += 1;
  }
  return added;
}
