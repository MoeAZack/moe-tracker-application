import { describe, expect, it, vi } from 'vitest';
import {
  createValorantEndScreenProfile,
  isBelowCalibratedResolution,
  parseLocalScoreboardRecognitions,
  preprocessRegionPixels,
  readSegmentedKda,
  segmentKdaNumberRectangles,
  type KdaNumberRead,
  type KdaNumberRectangle,
} from '../lib/localOcrEngine';

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

/** A synthetic "12/4/3" K/D/A row as the game draws it: light glyphs on a dark row, at 1920x1080 size. */
function syntheticKdaRow(): Pixels {
  const width = 108; const height = 45; const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) { data[index * 4] = data[index * 4 + 1] = data[index * 4 + 2] = 24; data[index * 4 + 3] = 255; }
  const ink = (x: number, y: number) => { const offset = (y * width + x) * 4; data[offset] = data[offset + 1] = data[offset + 2] = 235; };
  const block = (left: number, right: number) => { for (let y = 13; y <= 31; y += 1) for (let x = left; x <= right; x += 1) ink(x, y); };
  const slash = (x: number) => { for (let y = 12; y <= 32; y += 1) for (let dx = 0; dx < 2; dx += 1) ink(x + dx - Math.floor((y - 12) / 4), y); };
  block(6, 11); block(14, 20); // "12": two glyphs with a narrow gap
  slash(38);
  block(50, 57); // "4"
  slash(76);
  block(88, 95); // "3"
  return { width, height, data };
}

/** Box-filter downscale, the way a 1600x900 render shrinks the same row. */
function downscale(image: Pixels, factor: number): Pixels {
  const width = Math.round(image.width * factor); const height = Math.round(image.height * factor); const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const x0 = Math.floor(x / factor); const x1 = Math.max(x0 + 1, Math.floor((x + 1) / factor)); const y0 = Math.floor(y / factor); const y1 = Math.max(y0 + 1, Math.floor((y + 1) / factor));
    let sum = 0; let count = 0;
    for (let sy = y0; sy < Math.min(y1, image.height); sy += 1) for (let sx = x0; sx < Math.min(x1, image.width); sx += 1) { sum += image.data[(sy * image.width + sx) * 4]; count += 1; }
    const value = Math.round(sum / count); const offset = (y * width + x) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value; data[offset + 3] = 255;
  }
  return { width, height, data };
}

const segmentedAt = (factor: number) => {
  const row = factor === 1 ? syntheticKdaRow() : downscale(syntheticKdaRow(), factor);
  const processed = preprocessRegionPixels(row, { left: 0, top: 0, width: row.width, height: row.height });
  return { processed, rectangles: segmentKdaNumberRectangles(processed) };
};

/** Readers that return the digit for each number, by its position; the middle (deaths) one can be misread. */
function readers(rectangles: KdaNumberRectangle[], primaryDeaths: KdaNumberRead, secondaryDeaths: KdaNumberRead) {
  const truth = ['12', '4', '3'];
  const at = (rectangle: KdaNumberRectangle) => rectangles.indexOf(rectangle);
  return {
    primary: vi.fn(async (rectangle: KdaNumberRectangle) => (at(rectangle) === 1 ? primaryDeaths : { text: truth[at(rectangle)], confidence: 93 })),
    secondary: vi.fn(async (rectangle: KdaNumberRectangle) => (at(rectangle) === 1 ? secondaryDeaths : { text: truth[at(rectangle)], confidence: 90 })),
  };
}

describe('K/D/A below the calibrated resolution', () => {
  it('only full 16:9 scoreboards smaller than 1920x1080 take the stricter path', () => {
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(1600, 900))).toBe(true);
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(1280, 720, 'competitive'))).toBe(true);
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(1920, 1080))).toBe(false);
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(1920, 1080, 'competitive'))).toBe(false);
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(2560, 1440))).toBe(false);
    // Cropped player tables and the older cropped end screen keep their own calibration.
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(1016, 405))).toBe(false);
    expect(isBelowCalibratedResolution(createValorantEndScreenProfile(1839, 821))).toBe(false);
  });

  it('a synthetic row downscaled to 1600x900 still segments into three numbers, so the cross-check runs on it', () => {
    const full = segmentedAt(1); const small = segmentedAt(900 / 1080);
    expect(full.rectangles).toHaveLength(3);
    expect(small.rectangles).toHaveLength(3);
    expect(small.rectangles![0].height).toBeLessThan(full.rectangles![0].height);
  });

  it('abstains on the whole line when the second read of a downscaled digit is a different number, even at high confidence', async () => {
    const { rectangles } = segmentedAt(900 / 1080);
    const read = readers(rectangles!, { text: '6', confidence: 91 }, { text: '4', confidence: 88 });
    expect(await readSegmentedKda(rectangles!, read, true)).toEqual({ text: '', confidence: 91, reads: '12@93|12@90 6@91|4@88' });
  });

  it('keeps the line when the second read agrees, whatever its confidence (the usual K/D/A floor still applies later)', async () => {
    const { rectangles } = segmentedAt(900 / 1080);
    const read = readers(rectangles!, { text: '4', confidence: 74 }, { text: '4', confidence: 52 });
    expect(await readSegmentedKda(rectangles!, read, true)).toEqual({ text: '12/4/3', confidence: 74, reads: '12@93|12@90 4@74|4@52 3@93|3@90' });
    expect(read.secondary).toHaveBeenCalledTimes(3);
  });

  it('a second read that finds no number does not overrule the first', async () => {
    const { rectangles } = segmentedAt(900 / 1080);
    const read = readers(rectangles!, { text: '4', confidence: 88 }, { text: '', confidence: 30 });
    expect((await readSegmentedKda(rectangles!, read, true)).text).toBe('12/4/3');
  });

  it('the parser keeps the reads trace next to the raw K/D/A, and only when there is one', () => {
    const recognitions = [{ regionId: 'player.0.kda', text: '12/4/3', confidence: 90, reads: '12@93|12@90 4@90|4@85 3@93|3@90' }, { regionId: 'player.1.kda', text: '5/5/5', confidence: 90 }];
    const draft = parseLocalScoreboardRecognitions(recognitions, { capturedAt: '2026-10-22T00:00:00.000Z', rosterPlayers: [] });
    const players = (draft as any).stats as Array<{ rawMetrics?: Record<string, string> }>;
    expect(players[0].rawMetrics?.kdaReads).toBe('12@93|12@90 4@90|4@85 3@93|3@90');
    expect(players[1].rawMetrics && 'kdaReads' in players[1].rawMetrics).toBe(false);
  });

  it('at 1920x1080 reads each number once, exactly as before, and never runs the second read', async () => {
    const { rectangles } = segmentedAt(1);
    const read = readers(rectangles!, { text: '6', confidence: 91 }, { text: '4', confidence: 88 });
    expect(await readSegmentedKda(rectangles!, read, false)).toEqual({ text: '12/6/3', confidence: 91 });
    expect(read.primary).toHaveBeenCalledTimes(3);
    expect(read.secondary).not.toHaveBeenCalled();
  });

  it('still drops the line when a primary read is not a number, at any resolution', async () => {
    const { rectangles } = segmentedAt(1);
    const read = readers(rectangles!, { text: '', confidence: 40 }, { text: '4', confidence: 88 });
    expect(await readSegmentedKda(rectangles!, read, false)).toEqual({ text: '', confidence: 93 });
  });
});
