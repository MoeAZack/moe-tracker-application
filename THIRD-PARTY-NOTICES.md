# Third-party notices

Moe Tracker Application bundles the third-party components below. Each one keeps its own licence. The full licence texts ship inside the packages, under `node_modules/<package>/` in the installed app's `app.asar`. Electron and Chromium include their own notices (`LICENSE` and `LICENSES.chromium.html` in the install folder).

## OCR (reads screenshots locally; nothing is sent anywhere)

| Component | Version | Licence | Source |
| --- | --- | --- | --- |
| tesseract.js | 7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js |
| tesseract.js-core (Tesseract OCR compiled to WebAssembly) | 7.0.0 | Apache-2.0 | https://github.com/naptha/tesseract.js-core, https://github.com/tesseract-ocr/tesseract |
| @tesseract.js-data/eng (English trained data, from tesseract-ocr/tessdata) | 1.0.0 | MIT package; trained data Apache-2.0 | https://github.com/naptha/tessdata, https://github.com/tesseract-ocr/tessdata |
| ONNX Runtime Web (WebAssembly runtime, `ort-wasm-simd-threaded.wasm`) | 1.30.0 | MIT | https://github.com/microsoft/onnxruntime |
| PaddleOCR PP-OCRv4 recognition model `ch_PP-OCRv4_rec_infer.onnx` and `ppocr_keys_v1.txt`, via @gutenye/ocr-models | 1.4.2 | MIT package; PaddleOCR models Apache-2.0 | https://github.com/gutenye/ocr, https://github.com/PaddlePaddle/PaddleOCR |

## Desktop runtime

| Component | Version | Licence | Source |
| --- | --- | --- | --- |
| Electron | 41.x | MIT | https://github.com/electron/electron |
| sharp (with libvips) | 0.35.x | Apache-2.0; libvips LGPL-3.0-or-later | https://github.com/lovell/sharp, https://github.com/libvips/libvips |
| ffmpeg-static (FFmpeg binary) | 5.3.0 | GPL-3.0-or-later | https://github.com/eugeneware/ffmpeg-static, https://ffmpeg.org |
| ffprobe-static | 3.1.0 | MIT package; FFmpeg's ffprobe binary is GPL-3.0-or-later | https://github.com/joshwnj/ffprobe-static |
| youtube-dl-exec (with the yt-dlp binary) | 3.1.x | MIT; yt-dlp is Unlicense | https://github.com/microlinkhq/youtube-dl-exec, https://github.com/yt-dlp/yt-dlp |
| express, react, react-dom, zod and the other npm dependencies in `package.json` | see `package-lock.json` | MIT unless stated in their package | npm registry |

Before a public installer ships, someone still has to review the GPL obligations of the bundled FFmpeg binaries: the written offer of corresponding source, or a link to it.
