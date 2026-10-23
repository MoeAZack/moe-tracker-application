import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_OCR_ENGINE,
  PADDLE_FLOOR_PROBABILITY,
  agreeingNumberRead,
  calibratedPaddleConfidence,
  createPaddleDigitRecognizer,
  decodeDigitsCtc,
  normalizeOcrEngineId,
  numberReaderFor,
  ocrEngineModelSuffix,
  paddleCharacters,
  paddleRecognitionTensor,
} from '../lib/ocrEngines';
import { KDA_CONFIDENCE_FLOOR, parseLocalScoreboardRecognitions } from '../lib/localOcrEngine';
import { recognitionCacheKey } from '../lib/ocrAutonomy';
import { OCR_LEARNING_VERSION, applyLocalCorrection, correctionSamplesFromAcceptedEdit, learningModelForField, type LocalCorrectionModel } from '../lib/ocrLearning';
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
    // Every other field is Tesseract's read in every mode, so its rules keep firing.
    for (const engine of ['paddle', 'ensemble'] as const) {
      const plants: LocalCorrectionModel = { version: OCR_LEARNING_VERSION, rules: [{ field: 'plants', predicted: 1, corrected: 4, confirmations: 3, sourceModel: draft(), layout: 'custom', resolution: '1920x1080', sourceRegion: 'row-0' }] };
      expect(applyLocalCorrection(plants, 'plants', 1, { ...context, sourceModel: draft(engine) })).toBe(4);
      expect(learningModelForField(draft(engine), 'plants')).toBe(draft());
      expect(learningModelForField(draft(engine), 'deaths')).toBe(draft(engine));
    }
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

  it('feeds the model blue, green, red planes in that order', () => {
    // A pure red crop: PaddleOCR models were trained on BGR, so red is the third plane.
    const red = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
    for (let index = 0; index < 64; index += 1) { red.data[index * 4] = 255; red.data[index * 4 + 3] = 255; }
    const { tensor, width } = paddleRecognitionTensor(red);
    const centre = (plane: number) => tensor[plane * 48 * width + 24 * width + Math.floor(width / 2)];
    expect([centre(0), centre(1), centre(2)]).toEqual([-1, -1, 1]);
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

describe('PaddleOCR confidence calibration', () => {
  it('maps the softmax probability onto the 0..100 scale the K/D/A floor and learned-rule ceiling use', () => {
    expect(calibratedPaddleConfidence(PADDLE_FLOOR_PROBABILITY)).toBe(70);
    expect(calibratedPaddleConfidence(1)).toBe(100);
    expect(calibratedPaddleConfidence(0)).toBe(0);
    expect(calibratedPaddleConfidence(.67)).toBeLessThan(KDA_CONFIDENCE_FLOOR);
    expect(calibratedPaddleConfidence(.5)).toBeLessThan(calibratedPaddleConfidence(.9));
    expect(calibratedPaddleConfidence(7)).toBe(100);
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
          // The wider framing the low-resolution second read uses must not be confidently wrong either.
          const second = await recognizer.readDigits(numberCrop(crop), .5);
          if (second.text && second.text !== crop.label && (second.confidence ?? 0) >= KDA_CONFIDENCE_FLOOR) confidentWrong += 1;
        }
        expect({ height, confidentWrong }).toEqual({ height, confidentWrong: 0 });
        expect(correct, `${height}p`).toBeGreaterThanOrEqual(88);
      }
    } finally { await recognizer.release(); }
  }, 120_000);
});

describe('licences', () => {
  it('ships third-party notices naming every OCR component in the installer', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.build.files).toContain('THIRD-PARTY-NOTICES.md');
    expect(pkg.build.extraResources.some((item: { from: string }) => item.from === 'THIRD-PARTY-NOTICES.md')).toBe(true);
    const notices = readFileSync('THIRD-PARTY-NOTICES.md', 'utf8');
    for (const name of ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng', 'ONNX Runtime Web', 'PP-OCRv4', 'Apache-2.0']) expect(notices).toContain(name);
  });
});

describe('where PaddleOCR reads', () => {
  const scoreboards = ['valorant-post-match-scoreboard-v1', 'valorant-post-match-scoreboard-competitive-v1'];
  it('reads only the full scoreboard K/D/A; every other number stays with Tesseract in every mode', () => {
    for (const engine of ['paddle', 'ensemble'] as const) {
      for (const profile of scoreboards) expect(numberReaderFor(engine, profile, 'kda')).toBe(engine);
      // Plants, defuses, first kills/deaths, scores: integer cells on the scoreboard.
      for (const profile of scoreboards) expect(numberReaderFor(engine, profile, undefined)).toBe('tesseract');
      // Round screens (banks, loadouts, kill distances), performance, head-to-head and the player table.
      for (const profile of ['valorant-round-summary-v1', 'valorant-performance-v1', 'valorant-head-to-head-v1', 'valorant-player-table-v1']) {
        expect(numberReaderFor(engine, profile, undefined)).toBe('tesseract');
        expect(numberReaderFor(engine, profile, 'kda')).toBe('tesseract');
        expect(numberReaderFor(engine, profile, 'timestamp')).toBe('tesseract');
      }
    }
    for (const profile of scoreboards) expect(numberReaderFor('tesseract', profile, 'kda')).toBe('tesseract');
  });

  it('the browser adapter calls PaddleOCR only from the segmented K/D/A reader', () => {
    const source = readFileSync('lib/localOcrEngine.ts', 'utf8');
    expect(source.match(/paddle!?\.readDigits\(/g)).toHaveLength(1);
    const start = source.indexOf('const readNumber = async');
    const call = source.indexOf('paddle.readDigits(');
    expect(call).toBeGreaterThan(start);
    expect(call).toBeLessThan(source.indexOf('const grayscaleNumber =', start));
    expect(source.slice(start, call)).toContain("if (!paddle || reader === 'tesseract') return readTesseractNumber(");
  });
});

describe('corrections recorded in PaddleOCR or Ensemble mode', () => {
  it('key K/D/A on the engine\'s model and every other field on Tesseract\'s', () => {
    const model = '7.0.0/eng-1.0.0/parser-v1+numbers:ensemble(tesseract,ppocrv4-rec-digits-v1,glyph-templates-v1)';
    const match = { id: 'm1', source: 'scrim-import', sourceMetadata: { method: 'screenshot', model: `${model}+review` }, screenshotEvidence: { captureId: 'cap-1', diagnostics: { layout: 'custom', resolution: '1920x1080' } } };
    const samples = correctionSamplesFromAcceptedEdit({
      beforeMatch: match, beforeStats: [{ extractedName: 'Row 0', kills: 1, plants: 1 }], nextMatch: match,
      nextStats: [{ player: 'Row 0', kills: 7, plants: 4 }], nextScoreboardRows: [0], recordedAt: '2026-10-23T00:00:00.000Z',
    });
    expect(Object.fromEntries(samples.map(sample => [sample.field, sample.modelVersion]))).toEqual({ kills: model, plants: '7.0.0/eng-1.0.0/parser-v1' });
  });
});
