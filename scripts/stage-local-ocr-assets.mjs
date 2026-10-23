import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'public', 'ocr-assets');
const collectorDestination = path.join(root, 'public', 'collector');

const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js', '576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d'],
  ['node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz', 'lang/eng.traineddata.gz', 'ed350f3752f81ee8f38769edc14d92d997dababe23b565c59879372cc46a2468'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js', 'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js', '861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd.wasm.js', 'core/tesseract-core-relaxedsimd.wasm.js', '843074aa5bad1cc6421b74a86201768ced9f244795e4d81435435a61a40ce535'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js', 'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38'],
  ['node_modules/tesseract.js-core/tesseract-core-simd.wasm.js', 'core/tesseract-core-simd.wasm.js', '6b61ef4e911b5cf57e656bbfe983d6e2b3711a02dd164154ddda064566e8e09d'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'core/tesseract-core.wasm.js', '0bc6ce3e5fbbd0cd89706cf2fd70960e3372f4f01ee24265b26990808aaeb286'],
  // Optional PaddleOCR number engine (lib/ocrEngines.ts): ONNX Runtime 1.30.0 WebAssembly and the PP-OCRv4 recognition model.
  // The ES modules the desktop VOD analyzer imports in Node to read TAB-board cells (desktop/vod-timeline-analyzer.cjs);
  // under Node the bundle loads its WebAssembly glue from the separate .mjs.
  ['node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs', 'onnx/ort.wasm.bundle.min.mjs', '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'onnx/ort-wasm-simd-threaded.mjs', 'e13f7f94fc51b4ca72b12faeb1ee95f4ace6dfbc8939bc718aabdc0a27c4299b'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'onnx/ort-wasm-simd-threaded.wasm', '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2'],
  ['node_modules/@gutenye/ocr-models/assets/ch_PP-OCRv4_rec_infer.onnx', 'paddle/ch_PP-OCRv4_rec_infer.onnx', '06b3e6af6c59a1ba5d53790ed8c2e4b2de389870b6cf5a97f349f3412cb269c0'],
  ['node_modules/@gutenye/ocr-models/assets/ppocr_keys_v1.txt', 'paddle/ppocr_keys_v1.txt', '28b2362ad4ab2dc38769aa72feb535e3a9ddb3fd2a7585a05920e6393b1dc7f7'],
];

for (const [sourceRelative, destinationRelative, expectedSha256] of assets) {
  const source = path.join(root, sourceRelative);
  const bytes = await readFile(source);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Refusing to stage unexpected OCR asset ${sourceRelative}: ${actualSha256}`);
  }
  const target = path.join(destination, destinationRelative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

console.log(`Staged ${assets.length} verified local OCR assets.`);

await mkdir(collectorDestination, { recursive: true });
for (const name of ['setup-replay-collector.ps1', 'install-replay-collector.ps1', 'replay-collector-launch.ps1', 'replay-collector.mjs', 'replay-runtime-pin.json', 'normalize-vrfkit-export.py']) {
  await copyFile(path.join(root, 'scripts', name), path.join(collectorDestination, name));
}
console.log('Staged the Windows replay collector setup package.');
