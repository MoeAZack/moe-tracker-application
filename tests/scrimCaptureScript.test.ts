import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import captureLaunch from '../desktop/capture-launch.cjs';

const { launchScrimCapture } = captureLaunch;

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

  it('starts capture with ordinary rights unless the coach opted into elevation', async () => {
    const calls: Array<{ file: string; args: string[]; options: any }> = [];
    const spawnImpl = (file: string, args: string[], options: any) => {
      calls.push({ file, args, options });
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      setImmediate(() => child.emit('exit', 0));
      return child;
    };
    const preferences = { profile: 'scrim', display: 'primary' };
    await expect(launchScrimCapture({ launcher: 'C:/MoeTracker/start-scrim-capture.cmd', roundCount: 0, preferences, env: {} }, spawnImpl)).resolves.toEqual({ elevated: false });
    await expect(launchScrimCapture({ launcher: 'C:/MoeTracker/start-scrim-capture.cmd', roundCount: 13, preferences: { ...preferences, elevated: true }, env: {} }, spawnImpl)).resolves.toEqual({ elevated: true });
    const [ordinary, elevated] = calls.map(call => call.args[call.args.indexOf('-Command') + 1]);
    expect(calls.every(call => call.file === 'powershell.exe' && call.options.windowsHide === true)).toBe(true);
    expect(ordinary).not.toContain('RunAs'); expect(ordinary).toContain("'standard'");
    expect(elevated).toContain('-Verb RunAs'); expect(elevated).toContain("'elevated'");
    expect(calls[0].options.env).toMatchObject({ MOE_CAPTURE_LAUNCHER: 'C:/MoeTracker/start-scrim-capture.cmd', MOE_CAPTURE_ROUNDS: '0', MOE_CAPTURE_PROFILE: 'scrim', MOE_CAPTURE_DISPLAY: 'primary' });
    expect(fs.readFileSync(path.resolve('desktop/main.cjs'), 'utf8')).toContain("elevated: false, ...(config.capturePreferences || {})");
  });

  it('reports the helper error when Windows does not start capture', async () => {
    const spawnImpl = () => {
      const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
      setImmediate(() => { child.stderr.emit('data', 'The operation was canceled by the user.'); child.emit('exit', 1); });
      return child;
    };
    await expect(launchScrimCapture({ launcher: 'x.cmd', roundCount: 0, preferences: { elevated: true }, env: {} }, spawnImpl)).rejects.toThrow('canceled by the user');
  });

  // cmd.exe cannot run on the Linux test runner, so the launcher's own
  // defaults are pinned by source.
  it('keeps the standalone launcher unelevated with automatic rounds', () => {
    const launcher = fs.readFileSync(path.resolve('scripts/start-scrim-capture.cmd'), 'utf8');
    expect(launcher).toContain('if /I not "%~2"=="elevate" goto run_capture');
    expect(launcher).toContain('if "%ROUNDS%"=="" set "ROUNDS=0"');
  });
});

