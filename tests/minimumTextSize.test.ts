import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : /\.(tsx?|css)$/.test(entry.name) ? [path.join(dir, entry.name)] : []);

// A style contract, like the in-app dialog lint rule: nothing in the app is set below 12 px.
describe('minimum text size', () => {
  it('uses no Tailwind text size or CSS font size below 12 px anywhere in the app', () => {
    const offenders: string[] = [];
    for (const file of files('src')) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) if (Number(match[1]) < 12) offenders.push(`${file}: ${match[0]}`);
      for (const match of source.matchAll(/font-size:\s*(\d*\.?\d+)(rem|px)/g)) if ((match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1])) < 12) offenders.push(`${file}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});
