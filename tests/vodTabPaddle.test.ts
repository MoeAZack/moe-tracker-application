import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import analyzerModule from '../desktop/vod-timeline-analyzer.cjs';

const { TAB_BOX, TAB_FRAME, TAB_OUR_ROWS, TAB_CELLS, tabCellImage, loadPaddleDigitReader } = analyzerModule;

// The real PP-OCR reader on rendered TAB cells: white bold digits ~9 px tall over a dark row, as a
// 720p coach VOD shows them. Mostly single digits, which a loose crop leaves blank or unsure.
describe('the TAB cell digit reader', () => {
  beforeAll(() => { execFileSync(process.execPath, ['scripts/stage-local-ocr-assets.mjs'], { stdio: 'ignore' }); });

  const cell = async (digits: string) => {
    const { width, height } = TAB_FRAME, centre = TAB_OUR_ROWS[0];
    const x = (value: number) => (value - TAB_BOX.x0) / (TAB_BOX.x1 - TAB_BOX.x0) * width, y = (value: number) => (value - TAB_BOX.y0) / (TAB_BOX.y1 - TAB_BOX.y0) * height;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="rgb(60,60,60)"/><text x="${x((TAB_CELLS.kills.x0 + TAB_CELLS.kills.x1) / 2)}" y="${y(centre) + 5}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="13" fill="white" text-anchor="middle">${digits}</text></svg>`;
    const { data } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
    return tabCellImage(data, width, height, { x0: TAB_CELLS.kills.x0, x1: TAB_CELLS.kills.x1, y0: centre - .0105, y1: centre + .0105 });
  };

  it('reads lone digits and two-digit numbers at the K/D/A floor or above', async () => {
    const reader = await loadPaddleDigitReader();
    expect(reader).not.toBeNull();
    for (const digits of ['0', '2', '3', '4', '5', '6', '7', '8', '9', '12', '16', '20']) {
      const image = await cell(digits);
      expect(image.tight).toBeDefined();
      const read = await reader.read(image.tight);
      expect([digits, read.text]).toEqual([digits, digits]);
      expect(read.confidence).toBeGreaterThanOrEqual(70);
    }
  }, 60_000);
});
