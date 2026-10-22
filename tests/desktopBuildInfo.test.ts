import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { bundledRevision } = require('../desktop/build-info.cjs');
let root: string;

describe('desktop build revision', () => {
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-build-info-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('reads the commit the packaged renderer was built from', async () => {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'build.json'), JSON.stringify({ version: '0.2.1', revision: '7536c626cb6e' }) + '\n');
    expect(bundledRevision(root)).toBe('7536c626cb6e');
    // A build from a tree with local changes keeps its marker.
    await fs.writeFile(path.join(root, 'dist', 'build.json'), JSON.stringify({ version: '0.2.1', revision: '7536c626cb6e-dirty' }));
    expect(bundledRevision(root)).toBe('7536c626cb6e-dirty');
  });

  it('gives no revision when the bundle has none or it is not a commit', async () => {
    expect(bundledRevision(root)).toBeNull();
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'build.json'), JSON.stringify({ version: '0.2.1', revision: 'development' }));
    expect(bundledRevision(root)).toBeNull();
  });
});
