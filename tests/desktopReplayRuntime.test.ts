import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import runtimePin from '../scripts/replay-runtime-pin.json';

const require = createRequire(import.meta.url);
const { resolveReplayRuntime } = require('../desktop/replay-runtime.cjs');

describe('desktop replay runtime selection', () => {
  it('packages the runtime pin beside the installed collector script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const scripts = pkg.build.extraResources.find((item: any) => item.from === 'scripts');
    expect(scripts?.filter).toContain('replay-runtime-pin.json');
  });
  it('ignores a partial bundled parser and selects a complete fallback runtime', () => {
    const applicationRoot = path.resolve('C:/Program Files/Moe Tracker Application/resources');
    const collectorRoot = path.resolve('C:/Users/test/AppData/Local/MoeTracker/ReplayCollector');
    const localAppData = path.resolve('C:/Users/test/AppData/Local');
    const fallbackRoot = path.join(collectorRoot, 'runtime', `vrfkit-${runtimePin.version}`);
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

  it('prefers the application normalizer over a stale collector copy', () => {
    const applicationRoot = path.resolve('C:/app'); const collectorRoot = path.resolve('C:/collector'); const localAppData = path.resolve('C:/local');
    const bundled = path.join(applicationRoot, 'replay-runtime', 'vrfkit');
    const appNormalizer = path.join(applicationRoot, 'scripts', 'normalize-vrfkit-export.py');
    const existing = new Set([path.join(bundled, 'vrfkit.exe'), path.join(bundled, 'build-info.json'), path.join(applicationRoot, 'replay-runtime', 'python', 'python.exe'), appNormalizer, path.join(collectorRoot, 'app', 'normalize-vrfkit-export.py')]);
    expect(resolveReplayRuntime({ applicationRoot, collectorRoot, localAppData, exists: (file: string) => existing.has(file) }).normalizerPath).toBe(appNormalizer);
  });
});
