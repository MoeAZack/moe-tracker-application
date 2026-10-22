// npm run ocr:engines — compares the number-reading engines on the committed
// timeline fixtures (270 labelled HUD numbers at 1080p, 900p and 720p).
// Prints counts only. Tesseract reads each crop the way the app reads a K/D/A
// number (grayscale, enlarged, single word, digit whitelist); PaddleOCR reads
// it through lib/ocrEngines.ts exactly as the app does. ensemble+templates
// starts with no templates and learns them as the app does
// (glyphLearningLabel), so early numbers have only two voters; "ensemble,
// warm" reads the same numbers again with what the templates learned.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agreeingNumberRead, createPaddleDigitRecognizer, unanimousNumberRead, type NumberRead, type RgbaImage } from '../lib/ocrEngines';
import { classifyGlyphs, glyphLearningLabel, emptyGlyphTemplateSet, glyphFeatures, learnGlyphs } from '../lib/glyphTemplates';
import { KDA_CONFIDENCE_FLOOR } from '../lib/localOcrEngine';
import { loadOnnxRuntimeWeb, loadPaddleAssets, numberCrop, timelineNumberCrops } from './ocrEngineFixtures.mts';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = require('sharp'); const Tesseract = require('tesseract.js');

const worker = await Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, { langPath: path.join(root, 'node_modules/@tesseract.js-data/eng/4.0.0'), cacheMethod: 'none' });
await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD, tessedit_char_whitelist: '0123456789' });
const tesseract = async (image: RgbaImage): Promise<NumberRead> => {
  const scale = Math.max(4, Math.ceil(96 / image.height)); const padding = 12;
  const png = await sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length), { raw: { width: image.width, height: image.height, channels: 4 } })
    .resize({ width: image.width * scale, height: image.height * scale, kernel: 'cubic' }).extend({ top: padding, bottom: padding, left: padding, right: padding, background: '#ffffff' }).png().toBuffer();
  const result = await worker.recognize(png);
  return { text: String(result.data.text || '').trim(), confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : null };
};
const { model, dictionary } = loadPaddleAssets();
const paddle = await createPaddleDigitRecognizer(loadOnnxRuntimeWeb(), model, dictionary);

const rows: string[] = [];
for (const height of [1080, 900, 720]) {
  const crops = await timelineNumberCrops(height);
  const tally = { tesseract: { ok: 0, wrong: 0, wrongKept: 0, ms: 0 }, paddle: { ok: 0, wrong: 0, wrongKept: 0, ms: 0 }, ensemble: { ok: 0, wrong: 0, wrongKept: 0, ms: 0 }, 'ensemble+templates': { ok: 0, wrong: 0, wrongKept: 0, ms: 0 }, 'ensemble, warm': { ok: 0, wrong: 0, wrongKept: 0, ms: 0 } };
  const reads: Array<{ label: string; t: NumberRead; p: NumberRead; glyphs: ReturnType<typeof glyphFeatures> }> = [];
  const templates = emptyGlyphTemplateSet(); const resolution = `${height}p`;
  for (const crop of crops) {
    const image = numberCrop(crop);
    let started = performance.now(); const t = await tesseract(image); tally.tesseract.ms += performance.now() - started;
    started = performance.now(); const p = await paddle.readDigits(image); tally.paddle.ms += performance.now() - started;
    tally.ensemble.ms += 0;
    const e = agreeingNumberRead([t, p]);
    const glyphs = glyphFeatures(image);
    const voted = unanimousNumberRead([t, p, classifyGlyphs(templates, resolution, glyphs)]);
    reads.push({ label: crop.label, t, p, glyphs });
    const teach = glyphLearningLabel(t, p); if (teach) learnGlyphs(templates, resolution, glyphs, teach);
    for (const [engine, read] of [['tesseract', t], ['paddle', p], ['ensemble', e], ['ensemble+templates', voted]] as const) {
      const entry = tally[engine];
      if (read.text === crop.label) entry.ok += 1;
      else if (read.text) { entry.wrong += 1; if ((read.confidence ?? 0) >= KDA_CONFIDENCE_FLOOR) entry.wrongKept += 1; }
    }
  }
  // A second pass over the same numbers with the templates the first pass learned: the steady state after a few scrims.
  for (const { label, t, p, glyphs } of reads) {
    const read = unanimousNumberRead([t, p, classifyGlyphs(templates, resolution, glyphs)]); const entry = tally['ensemble, warm'];
    if (read.text === label) entry.ok += 1; else if (read.text) { entry.wrong += 1; if ((read.confidence ?? 0) >= KDA_CONFIDENCE_FLOOR) entry.wrongKept += 1; }
  }
  tally.ensemble.ms = tally['ensemble+templates'].ms = tally['ensemble, warm'].ms = tally.tesseract.ms + tally.paddle.ms;
  for (const [engine, entry] of Object.entries(tally)) rows.push(`${String(height).padStart(4)}p  ${engine.padEnd(18)}  correct ${String(entry.ok).padStart(3)}/${crops.length}  wrong ${String(entry.wrong).padStart(2)}  wrong at/above floor ${KDA_CONFIDENCE_FLOOR}: ${String(entry.wrongKept).padStart(2)}  ${(entry.ms / crops.length).toFixed(1)} ms/number`);
}
await worker.terminate(); await paddle.release();
console.log(rows.join('\n'));
