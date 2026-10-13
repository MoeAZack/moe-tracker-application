import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Windows application branding', () => {
  it('ships valid PNG and ICO assets and configures the Windows build to use them', async () => {
    const [png, ico, packageText] = await Promise.all([
      readFile(new URL('../desktop/assets/app-icon.png', import.meta.url)),
      readFile(new URL('../desktop/assets/app-icon.ico', import.meta.url)),
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ]);
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(JSON.parse(packageText).build.win.icon).toBe('desktop/assets/app-icon.ico');
  });
});
