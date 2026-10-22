// npm run ocr:engines — compares the number-reading engines on the committed
// timeline fixtures (270 labelled HUD numbers at 1080p, 900p and 720p).
// Prints counts only. Tesseract reads each crop the way the app reads a K/D/A
// number (grayscale, enlarged, single word, digit whitelist); PaddleOCR reads
// it through lib/ocrEngines.ts exactly as the app does.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agreeingNumberRead, createPaddleDigitRecognizer, type NumberRead, type RgbaImage } from '../lib/ocrEngines';
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
  const tally = { tesseract: { ok: 0, wrong: 0, wrongKept: 0, ms: 0 }, paddle: { ok: 0, wrong: 0, wrongKept: 0, ms: 0 }, ensemble: { ok: 0, wrong: 0, wrongKept: 0, ms: 0 } };
  for (const crop of crops) {
    const image = numberCrop(crop);
    let started = performance.now(); const t = await tesseract(image); tally.tesseract.ms += performance.now() - started;
    started = performance.now(); const p = await paddle.readDigits(image); tally.paddle.ms += performance.now() - started;
    tally.ensemble.ms += 0;
    const e = agreeingNumberRead([t, p]);
    for (const [engine, read] of [['tesseract', t], ['paddle', p], ['ensemble', e]] as const) {
      const entry = tally[engine];
      if (read.text === crop.label) entry.ok += 1;
      else if (read.text) { entry.wrong += 1; if ((read.confidence ?? 0) >= KDA_CONFIDENCE_FLOOR) entry.wrongKept += 1; }
    }
  }
  tally.ensemble.ms = tally.tesseract.ms + tally.paddle.ms;
  for (const [engine, entry] of Object.entries(tally)) rows.push(`${String(height).padStart(4)}p  ${engine.padEnd(9)}  correct ${String(entry.ok).padStart(3)}/${crops.length}  wrong ${String(entry.wrong).padStart(2)}  wrong at/above floor ${KDA_CONFIDENCE_FLOOR}: ${String(entry.wrongKept).padStart(2)}  ${(entry.ms / crops.length).toFixed(1)} ms/number`);
}
await worker.terminate(); await paddle.release();
console.log(rows.join('\n'));
