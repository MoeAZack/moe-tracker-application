// Labelled number crops from the committed timeline fixtures, shared by
// tests/ocrEngines.test.ts and `npm run ocr:engines`. The round numbers above
// each tile are real VALORANT HUD digits; resampled copies stand in for
// 1600x900 and 1280x720 clients. Crops are made in memory, never written.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { preprocessNumericGrayscale } from '../lib/localOcrEngine';
import type { RgbaImage } from '../lib/ocrEngines';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDirectory = path.join(root, 'tests', 'fixtures', 'timeline');

export interface LabelledNumberCrop { fixture: string; height: number; label: string; source: RgbaImage; rectangle: { left: number; top: number; width: number; height: number } }

/** Number crops at a client height (1080, 900 or 720), labelled left to right. */
export async function timelineNumberCrops(clientHeight = 1080): Promise<LabelledNumberCrop[]> {
  const sharp = require('sharp');
  const labels = JSON.parse(fs.readFileSync(path.join(fixtureDirectory, 'round-numbers.json'), 'utf8')).fixtures as Record<string, { first: number; count: number }>;
  const scale = clientHeight / 1080; const crops: LabelledNumberCrop[] = [];
  for (const [fixture, { first, count }] of Object.entries(labels)) {
    let pipeline = sharp(path.join(fixtureDirectory, `${fixture}.png`));
    if (scale !== 1) pipeline = pipeline.resize({ width: Math.round(1920 * scale), height: clientHeight, kernel: 'lanczos3' });
    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const source: RgbaImage = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
    // Columns of light, unsaturated pixels in the band that holds the round numbers.
    const top = Math.round(289 * scale); const bottom = Math.round(307 * scale); const from = Math.round(340 * scale); const to = Math.round(1740 * scale);
    const groups: Array<[number, number]> = []; let start = -1; let last = -1;
    for (let x = from; x < to; x += 1) {
      let light = 0;
      for (let y = top; y < bottom; y += 1) {
        const index = (y * source.width + x) * 4; const high = Math.max(source.data[index], source.data[index + 1], source.data[index + 2]); const low = Math.min(source.data[index], source.data[index + 1], source.data[index + 2]);
        if (high > 120 && high - low < 60) light += 1;
      }
      if (!light) continue;
      if (start < 0) start = x; else if (x - last > 8 * scale) { groups.push([start, last]); start = x; }
      last = x;
    }
    if (start >= 0) groups.push([start, last]);
    if (groups.length !== count) throw new Error(`${fixture} at ${clientHeight}p: found ${groups.length} round numbers, expected ${count}.`);
    const pad = Math.max(2, Math.round(3 * scale));
    groups.forEach(([left, right], index) => crops.push({ fixture, height: clientHeight, label: String(first + index), source, rectangle: { left: left - pad, top: top - 1, width: right - left + 1 + pad * 2, height: bottom - top + 2 } }));
  }
  return crops;
}

/** The dark-on-white grayscale crop every engine reads (the app's numeric preprocessing). */
export const numberCrop = (crop: LabelledNumberCrop) => preprocessNumericGrayscale(crop.source, crop.rectangle);

export function loadPaddleAssets() {
  const directory = path.join(root, 'node_modules', '@gutenye', 'ocr-models', 'assets');
  return { model: fs.readFileSync(path.join(directory, 'ch_PP-OCRv4_rec_infer.onnx')), dictionary: fs.readFileSync(path.join(directory, 'ppocr_keys_v1.txt'), 'utf8') };
}

export function loadOnnxRuntimeWeb() {
  const ort = require('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  return ort;
}
