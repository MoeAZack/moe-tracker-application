import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

async function collectorWith(files: Array<{ name: string; unsupportedBuild?: string }>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moe-process-latest-')); dirs.push(root);
  const app = path.join(root, 'MoeTracker', 'ReplayCollector'); const demos = path.join(root, 'Demos');
  await fs.mkdir(app, { recursive: true }); await fs.mkdir(demos, { recursive: true });
  const manifest: any = { schemaVersion: 1, files: {}, approved: [], scoreboardApprovals: [] };
  for (const [index, file] of files.entries()) {
    const full = path.join(demos, file.name); await fs.writeFile(full, `replay-${index}`);
    const stat = await fs.stat(full);
    manifest.files[full.toLowerCase()] = { path: full, size: stat.size, mtimeMs: stat.mtimeMs, stableSince: 1, status: 'parser-attention-required', sha256: String(index).repeat(64).slice(0, 64), ...(file.unsupportedBuild ? { unsupportedBuild: file.unsupportedBuild } : {}) };
  }
  await fs.writeFile(path.join(app, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(app, 'config.json'), JSON.stringify({ schemaVersion: 2, deviceId: 'desktop-test', replayPaths: [], autoProcess: false, autoUpload: false, ingestionMode: 'local-evidence', localRuntime: { binaryPath: '', pythonPath: '', normalizerPath: '' } }));
  return { env: { ...process.env, LOCALAPPDATA: root } };
}

describe('process latest replay', () => {
  it('reports unsupported VALORANT patches as a status instead of a raw parser error', async () => {
    const { env } = await collectorWith([{ name: 'a.vrf', unsupportedBuild: '++Ares-Core+release-13.08' }, { name: 'b.vrf', unsupportedBuild: '++Ares-Core+release-13.08' }]);
    const { stdout } = await run(process.execPath, ['scripts/replay-collector.mjs', 'process-latest'], { env });
    const result = JSON.parse(stdout);
    expect(result.state).toBe('unsupported-patch');
    expect(result.message).toMatch(/All 2 replays are from VALORANT patch 13\.08.*screenshot capture/);
  });
  it('skips unsupported replays and tries the newest readable one', async () => {
    const { env } = await collectorWith([{ name: 'old-supported.vrf' }, { name: 'new.vrf', unsupportedBuild: '++Ares-Core+release-13.08' }]);
    const failure = await run(process.execPath, ['scripts/replay-collector.mjs', 'process-latest'], { env }).catch(error => error);
    // No parser runtime in tests: the supported replay is attempted (runtime error), not the 13.08 one.
    expect(String(failure.stderr)).toMatch(/binaryPath is not configured/);
  });
});

describe('collector lock recovery', () => {
  it('releases a lock left by a killed watcher instead of waiting out the stale window', async () => {
    const { env } = await collectorWith([{ name: 'a.vrf', unsupportedBuild: '++Ares-Core+release-13.08' }]);
    const lock = path.join(env.LOCALAPPDATA!, 'MoeTracker', 'ReplayCollector', 'collector.lock');
    const dead = await run(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
    await fs.mkdir(lock); await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: Number(dead.stdout), acquiredAt: new Date().toISOString() }));
    const old = new Date(Date.now() - 10_000); await fs.utimes(lock, old, old);
    const started = Date.now();
    const { stdout } = await run(process.execPath, ['scripts/replay-collector.mjs', 'process-latest'], { env, timeout: 20_000 });
    expect(JSON.parse(stdout).state).toBe('unsupported-patch');
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
