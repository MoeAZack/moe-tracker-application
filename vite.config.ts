import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {buildRevision} from './scripts/build-revision.mjs';

// Every static bundle names its build at /build.json, so a deployment can be
// identified without logging in.
const buildManifest = (): Plugin => ({
  name: 'moe-build-manifest',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify({ version: appVersion, revision: appRevision }) + '\n' });
  },
});

// ONNX Runtime's bundle points at its WebAssembly with new URL(..., import.meta.url),
// which makes Vite emit a second 14 MB copy. The app always loads the
// hash-checked copy staged in /ocr-assets/onnx/ (lib/ocrEngines.ts sets
// wasmPaths), so the bundle's reference is pointed there instead.
const onnxRuntimeStagedWasm = (): Plugin => ({
  name: 'moe-onnx-runtime-staged-wasm',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').includes('/onnxruntime-web/dist/')) return null;
    const replaced = code.replaceAll('new URL("ort-wasm-simd-threaded.wasm",import.meta.url)', 'new URL("/ocr-assets/onnx/ort-wasm-simd-threaded.wasm",self.location.href)');
    return replaced === code ? null : { code: replaced, map: null };
  },
});

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;
const appRevision = buildRevision();

export default defineConfig(() => {
  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_REVISION__: JSON.stringify(appRevision),
    },
    plugins: [react(), tailwindcss(), buildManifest(), onnxRuntimeStagedWasm()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      // HTTP tests replace process-level auth and database settings. Separate
      // processes keep those credentials isolated when files run in parallel.
      pool: 'forks',
    },
  };
});
