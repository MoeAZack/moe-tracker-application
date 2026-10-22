import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OCR_ENGINE,
  agreeingNumberRead,
  createPaddleDigitRecognizer,
  decodeDigitsCtc,
  normalizeOcrEngineId,
  ocrEngineModelSuffix,
  paddleCharacters,
  paddleRecognitionTensor,
} from '../lib/ocrEngines';
import { KDA_CONFIDENCE_FLOOR, parseLocalScoreboardRecognitions } from '../lib/localOcrEngine';
import { recognitionCacheKey } from '../lib/ocrAutonomy';
import { OCR_LEARNING_VERSION, applyLocalCorrection, type LocalCorrectionModel } from '../lib/ocrLearning';
import { loadOnnxRuntimeWeb, loadPaddleAssets, numberCrop, timelineNumberCrops } from '../scripts/ocrEngineFixtures.mts';

describe('engine selection', () => {
  it('defaults to Tesseract for missing or unknown values', () => {
    expect(DEFAULT_OCR_ENGINE).toBe('tesseract');
    for (const value of [undefined, null, '', 'Paddle', 'onnx', 42]) expect(normalizeOcrEngineId(value)).toBe('tesseract');
    expect(normalizeOcrEngineId('paddle')).toBe('paddle');
    expect(normalizeOcrEngineId('ensemble')).toBe('ensemble');
  });

  it('keeps the Tesseract source model, cache key and learned-rule scope unchanged', () => {
    expect(ocrEngineModelSuffix('tesseract')).toBe('');
    expect(ocrEngineModelSuffix(undefined)).toBe('');
    const profile = { id: 'p', version: 1, status: 'accepted' as const, dimensions: { width: 10, height: 10 }, regions: [{ id: 'r', kind: 'integer' as const, rectangle: { left: 0, top: 0, width: 1, height: 1 } }] };
    expect(recognitionCacheKey('AB', profile, 'tesseract')).toBe(recognitionCacheKey('AB', profile));
    expect(recognitionCacheKey('AB', profile, 'paddle')).not.toBe(recognitionCacheKey('AB', profile));
    expect(recognitionCacheKey('AB', profile, 'ensemble')).not.toBe(recognitionCacheKey('AB', profile, 'paddle'));
    const draft = (engine?: 'tesseract' | 'paddle' | 'ensemble') => parseLocalScoreboardRecognitions([], { capturedAt: '2026-10-22T00:00:00.000Z', rosterPlayers: [], engine }).sourceMetadata.model;
    expect(draft()).toBe('7.0.0/eng-1.0.0/parser-v1');
    expect(draft('tesseract')).toBe('7.0.0/eng-1.0.0/parser-v1');
    expect(draft('paddle')).not.toBe(draft());
    // A rule learned from Tesseract's reads does not fire on another engine's reads.
    const model: LocalCorrectionModel = { version: OCR_LEARNING_VERSION, rules: [{ field: 'kills', predicted: 1, corrected: 7, confirmations: 3, sourceModel: draft(), layout: 'custom', resolution: '1920x1080', sourceRegion: 'row-0' }] };
    const context = { layout: 'custom', resolution: '1920x1080', sourceRegion: 'row-0' };
    expect(applyLocalCorrection(model, 'kills', 1, { ...context, sourceModel: draft() })).toBe(7);
    expect(applyLocalCorrection(model, 'kills', 1, { ...context, sourceModel: draft('paddle') })).toBe(1);
  });
});

describe('ensemble vote', () => {
  it('keeps a number only when every engine reads the same digits, with the lower confidence', () => {
    expect(agreeingNumberRead([{ text: '17', confidence: 91 }, { text: ' 17 ', confidence: 84 }])).toEqual({ text: '17', confidence: 84, agreed: true });
  });

  it('abstains on any disagreement, even a confident one', () => {
    expect(agreeingNumberRead([{ text: '24', confidence: 99 }, { text: '2', confidence: 98 }])).toMatchObject({ text: '', agreed: false, confidence: 98 });
  });

  it('abstains when one engine finds no number or a non-number', () => {
    expect(agreeingNumberRead([{ text: '', confidence: null }, { text: '6', confidence: 99 }])).toMatchObject({ text: '', agreed: false, confidence: null });
    expect(agreeingNumberRead([{ text: 'l7', confidence: 90 }, { text: 'l7', confidence: 90 }])).toMatchObject({ text: '', agreed: false });
    expect(agreeingNumberRead([])).toMatchObject({ text: '', agreed: false, confidence: null });
  });
});

describe('PaddleOCR decoding', () => {
  const characters = paddleCharacters('a\n1\n2\n0\n3\n4\n5\n6\n7\n8\n9\n');
  const step = (index: number, probability = .9) => Array.from({ length: characters.length }, (_, position) => position === index ? probability : (1 - probability) / (characters.length - 1));

  it('reads the dictionary as blank + characters + space', () => {
    expect(characters[0]).toBe('');
    expect(characters.at(-1)).toBe(' ');
    expect(characters).toHaveLength(13);
  });

  it('collapses repeats, splits on blanks and reports the weakest digit', () => {
    const one = characters.indexOf('1'); const seven = characters.indexOf('7');
    const probabilities = [...step(one, .95), ...step(one, .9), ...step(0), ...step(one, .8), ...step(seven, .6), ...step(0)];
    expect(decodeDigitsCtc(probabilities, 6, characters.length, characters)).toEqual({ text: '117', confidence: .6 });
  });

  it('never emits a letter: only blank and digits compete', () => {
    const letter = characters.indexOf('a'); const two = characters.indexOf('2');
    const mostlyLetter = Array.from({ length: characters.length }, (_, position) => position === letter ? .7 : position === two ? .2 : .1 / (characters.length - 2));
    expect(decodeDigitsCtc(mostlyLetter, 1, characters.length, characters).text).toBe('2');
    expect(decodeDigitsCtc(step(0), 1, characters.length, characters)).toEqual({ text: '', confidence: null });
  });

  it('refuses a dictionary that does not match the model', () => {
    expect(() => decodeDigitsCtc(step(0), 1, characters.length + 1, characters)).toThrow(/dictionary/);
    expect(() => decodeDigitsCtc([1, 0, 0], 1, 3, ['', 'a', ' '])).toThrow(/ten digits/);
  });

  it('builds a 48-pixel BGR tensor padded with white', () => {
    const image = { width: 4, height: 8, data: new Uint8ClampedArray(4 * 8 * 4).fill(255) };
    image.data[0] = 0; // one red-channel-dark pixel
    const { tensor, width, height } = paddleRecognitionTensor(image);
    expect(height).toBe(48);
    expect(width).toBe(Math.max(16, Math.round((4 + 4) * 48 / (8 + 4))));
    expect(tensor).toHaveLength(3 * 48 * width);
    expect(tensor[0]).toBe(1); // padded corner is white
    expect(() => paddleRecognitionTensor({ width: 2, height: 2, data: new Uint8ClampedArray(3) })).toThrow();
  });
});

describe('PaddleOCR on the committed HUD-digit fixtures', () => {
  // 90 round numbers per resolution from tests/fixtures/timeline, read the way the app reads a number.
  it('reads every number at 1080p, 900p and 720p, with no wrong number above the K/D/A floor', async () => {
    const { model, dictionary } = loadPaddleAssets();
    const recognizer = await createPaddleDigitRecognizer(loadOnnxRuntimeWeb(), model, dictionary);
    try {
      for (const height of [1080, 900, 720]) {
        const crops = await timelineNumberCrops(height);
        expect(crops).toHaveLength(90);
        let correct = 0; let confidentWrong = 0;
        for (const crop of crops) {
          const read = await recognizer.readDigits(numberCrop(crop));
          if (read.text === crop.label) correct += 1;
          else if (read.text && (read.confidence ?? 0) >= KDA_CONFIDENCE_FLOOR) confidentWrong += 1;
        }
        expect({ height, confidentWrong }).toEqual({ height, confidentWrong: 0 });
        expect(correct, `${height}p`).toBeGreaterThanOrEqual(88);
      }
    } finally { await recognizer.release(); }
  }, 120_000);
});
