'use strict';

// Ordinary rights by default: a UAC prompt on every capture is only needed
// when VALORANT itself runs as administrator, which the coach opts into.
function captureLaunchCommand(elevated) {
  return elevated
    ? "$process = Start-Process -FilePath $env:MOE_CAPTURE_LAUNCHER -Verb RunAs -ArgumentList @($env:MOE_CAPTURE_ROUNDS, 'elevated', $env:MOE_CAPTURE_PROFILE, $env:MOE_CAPTURE_DISPLAY) -PassThru; if (-not $process) { exit 1 }"
    : "$process = Start-Process -FilePath $env:MOE_CAPTURE_LAUNCHER -ArgumentList @($env:MOE_CAPTURE_ROUNDS, 'standard', $env:MOE_CAPTURE_PROFILE, $env:MOE_CAPTURE_DISPLAY) -PassThru; if (-not $process) { exit 1 }";
}

/** Start the capture helper through PowerShell; resolves once Windows has launched it. */
function launchScrimCapture({ launcher, roundCount, preferences, env = process.env }, spawnImpl) {
  const elevated = preferences?.elevated === true;
  return new Promise((resolve, reject) => {
    const child = spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', captureLaunchCommand(elevated)], {
      windowsHide: true,
      env: { ...env, MOE_CAPTURE_LAUNCHER: launcher, MOE_CAPTURE_ROUNDS: String(roundCount), MOE_CAPTURE_PROFILE: preferences?.profile, MOE_CAPTURE_DISPLAY: preferences?.display },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', value => { stderr += String(value); });
    child.on('error', reject);
    child.on('exit', code => { if (code === 0) resolve({ elevated }); else reject(new Error(stderr.trim() || 'Windows did not start the capture helper.')); });
  });
}

module.exports = { captureLaunchCommand, launchScrimCapture };
