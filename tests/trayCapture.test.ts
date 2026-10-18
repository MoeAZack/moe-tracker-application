import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('S6 tray-first capture contract', () => {
  it('exposes pause, preferences and disconnect through the isolated desktop bridge', () => {
    const preload = read('desktop/preload.cjs'); const main = read('desktop/main.cjs');
    for (const channel of ['desktop:set-capture-paused', 'desktop:set-capture-preferences', 'desktop:disconnect-device']) { expect(preload).toContain(channel); expect(main).toContain(channel); }
    expect(main).toContain("if (runtime.config.capturePaused) throw new Error('Capture is paused.");
    expect(main).toContain("safety: 'post-match-only'");
  });

  it('exposes a trusted manual recovery point and reports verified backup freshness', () => {
    const preload = read('desktop/preload.cjs'); const main = read('desktop/main.cjs');
    expect(preload).toContain('desktop:create-recovery-backup');
    expect(main).toContain("handleTrusted('desktop:create-recovery-backup'");
    expect(main).toContain('createRecoveryBackup(true)');
    expect(main).toContain('verifiedRecent: recoveryVerified');
  });

  it('passes the bounded window/display profile into the post-match helper and records it in the manifest', () => {
    const main = read('desktop/main.cjs'); const script = read('scripts/scrim-capture.ps1');
    expect(main).toContain('MOE_CAPTURE_PROFILE'); expect(main).toContain('MOE_CAPTURE_DISPLAY');
    expect(script).toContain("[ValidateSet('fullscreen', 'fullscreen-windowed', 'windowed')]");
    expect(script).toContain("[ValidatePattern('^(primary|display:\\d{1,2})$')]");
    expect(script).toContain('captureProfile = $CaptureProfile'); expect(script).toContain('detected = "display:$screenIndex"');
  });

  it('keeps capture explicitly post-match and refuses hidden live-process access', () => {
    const script = read('scripts/scrim-capture.ps1');
    expect(script).toContain('post-match capture card'); expect(script).toContain('does not inspect VALORANT memory or automate gameplay'); expect(script).toContain('Confirm-ValorantForeground');
    expect(script).not.toMatch(/ReadProcessMemory|WriteProcessMemory|CreateRemoteThread/);
  });
});
