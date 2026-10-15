const fs = require('node:fs');
const path = require('node:path');

function completeVrfkitRoot(root, exists = fs.existsSync) {
  const binaryPath = path.join(root, 'vrfkit.exe');
  const buildInfoPath = path.join(root, 'build-info.json');
  return exists(binaryPath) && exists(buildInfoPath) ? binaryPath : null;
}

function resolveReplayRuntime({ applicationRoot, collectorRoot, localAppData = '', exists = fs.existsSync }) {
  const bundledRoot = path.join(applicationRoot, 'replay-runtime');
  const bundledBinary = completeVrfkitRoot(path.join(bundledRoot, 'vrfkit'), exists);
  const fallbackBinary = completeVrfkitRoot(path.join(collectorRoot, 'runtime', 'vrfkit-v0.2.5'), exists);
  const binaryPath = bundledBinary || fallbackBinary || path.join(bundledRoot, 'vrfkit', 'vrfkit.exe');
  const pythonCandidates = [path.join(bundledRoot, 'python', 'python.exe'), path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe')];
  const normalizerCandidates = [path.join(collectorRoot, 'app', 'normalize-vrfkit-export.py'), path.join(applicationRoot, 'scripts', 'normalize-vrfkit-export.py')];
  const firstExisting = candidates => candidates.find(file => exists(file)) || candidates[0];
  const runtime = { binaryPath, pythonPath: firstExisting(pythonCandidates), normalizerPath: firstExisting(normalizerCandidates) };
  return { ...runtime, ready: Object.values(runtime).every(file => path.isAbsolute(file) && exists(file)) && !!(bundledBinary || fallbackBinary) };
}

module.exports = { completeVrfkitRoot, resolveReplayRuntime };
