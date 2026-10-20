import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Windows scrim capture visibility', () => {
  it('hides its elevated console before reading or capturing the VALORANT summary', () => {
    const script = fs.readFileSync(path.resolve('scripts/scrim-capture.ps1'), 'utf8');
    expect(script).toContain('GetConsoleWindow');
    expect(script).toContain('function Hide-CaptureConsole');
    expect(script).toContain('function Show-CaptureConsole');
    expect(script.indexOf('Hide-CaptureConsole', script.indexOf('try {')))
      .toBeLessThan(script.indexOf('$window = Find-ValorantRenderArea'));
    expect(script.indexOf('Show-CaptureConsole', script.indexOf('catch {')))
      .toBeLessThan(script.indexOf('Capture failed:'));
  });

  it('supports automatic round discovery while retaining a bounded manual override', () => {
    const script = fs.readFileSync(path.resolve('scripts/scrim-capture.ps1'), 'utf8');
    expect(script).toContain('[ValidateRange(0, 32)]');
    expect(script).toContain('automaticRoundDetection = $RoundCount -eq 0');
    expect(script).toContain("$tailCount = if ($RoundCount -eq 0 -and $leftTiles.Count -ge 24) { 8 }");
    expect(script).toContain('TimelineDifferenceRatio');
    expect(script).toContain("reason = 'timeline-did-not-scroll'");
    expect(script).toContain("if ($RoundCount -gt 0 -and $detectedRoundCount -ne $RoundCount)");
  });

  // Windows-only launch path; these checks pin the launch commands because
  // cmd.exe and UAC cannot run on the Linux test runner.
  it('starts capture with ordinary rights unless the coach opted into elevation', () => {
    const main = fs.readFileSync(path.resolve('desktop/main.cjs'), 'utf8');
    const launcher = fs.readFileSync(path.resolve('scripts/start-scrim-capture.cmd'), 'utf8');
    const ordinary = /: "(\$process = Start-Process[^"]*)";/.exec(main)?.[1] || '';
    expect(ordinary).toContain("'standard'"); expect(ordinary).not.toContain('RunAs');
    expect(main).toContain("elevated: false, ...(config.capturePreferences || {})");
    expect(launcher).toContain('if /I not "%~2"=="elevate" goto run_capture');
    expect(launcher).toContain('if "%ROUNDS%"=="" set "ROUNDS=0"');
  });
});

