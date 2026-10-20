import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release runtime pins', () => {
  it('verifies exact application runtime package versions and available Windows binaries', () => {
    const output = execFileSync(process.execPath, ['scripts/verify-release-runtime.mjs'], { encoding: 'utf8' });
    expect(JSON.parse(output)).toMatchObject({ passed: true, versions: { appVersion: '0.2.0', electron: '41.10.7', sharp: '0.35.5' } });
  });

  it('pins and verifies Python and PyArrow artifacts before installation', () => {
    const stage = fs.readFileSync('scripts/stage-replay-runtime.ps1', 'utf8');
    const replayPin = JSON.parse(fs.readFileSync('scripts/replay-runtime-pin.json', 'utf8'));
    expect(replayPin.python.windowsX64EmbedZipSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(replayPin.python.windowsX64ExeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(replayPin.pyarrow.windowsCp312X64WheelSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stage).toContain('pyarrow wheel hash mismatch');
    expect(stage).toContain('Embedded Python ZIP hash mismatch');
    expect(stage).toContain('runtime-manifest.json');
  });
});
