import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { resolveReplayRuntime } = require('../desktop/replay-runtime.cjs');

describe('desktop replay runtime selection', () => {
  it('ignores a partial bundled parser and selects a complete fallback runtime', () => {
    const applicationRoot = path.resolve('C:/Program Files/Moe Tracker Application/resources');
    const collectorRoot = path.resolve('C:/Users/test/AppData/Local/MoeTracker/ReplayCollector');
    const localAppData = path.resolve('C:/Users/test/AppData/Local');
    const fallbackRoot = path.join(collectorRoot, 'runtime', 'vrfkit-v0.2.5');
    const existing = new Set([
      path.join(applicationRoot, 'replay-runtime', 'vrfkit', 'vrfkit.exe'),
      path.join(fallbackRoot, 'vrfkit.exe'),
      path.join(fallbackRoot, 'build-info.json'),
      path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(collectorRoot, 'app', 'normalize-vrfkit-export.py'),
    ]);
    const runtime = resolveReplayRuntime({ applicationRoot, collectorRoot, localAppData, exists: (file: string) => existing.has(file) });
    expect(runtime).toMatchObject({ binaryPath: path.join(fallbackRoot, 'vrfkit.exe'), ready: true });
  });

  it('does not mark a parser ready when every executable lacks build metadata', () => {
    const applicationRoot = path.resolve('C:/app'); const collectorRoot = path.resolve('C:/collector'); const localAppData = path.resolve('C:/local');
    const existing = new Set([path.join(applicationRoot, 'replay-runtime', 'vrfkit', 'vrfkit.exe'), path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'), path.join(collectorRoot, 'app', 'normalize-vrfkit-export.py')]);
    expect(resolveReplayRuntime({ applicationRoot, collectorRoot, localAppData, exists: (file: string) => existing.has(file) }).ready).toBe(false);
  });
});
