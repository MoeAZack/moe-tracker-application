/**
 * Number-reading engines for the local scoreboard recognizer.
 *
 * Tesseract stays the default and reads everything exactly as before. The
 * optional PaddleOCR engine (PP-OCRv4 recognition model, run fully offline in
 * ONNX Runtime WebAssembly) only reads the numeric cells: K/D/A numbers,
 * scores and other integer cells. Names, maps and labels stay with Tesseract.
 *
 * Ensemble reads every number with both engines. A number is kept only when
 * both engines read the same digits; any disagreement, or one engine finding
 * no number, leaves the cell unknown. Its confidence is the lower of the two.
 * A coach fills an empty cell in; a plausible wrong one gets saved.
 */

export type OcrEngineId = 'tesseract' | 'paddle' | 'ensemble';

export const OCR_ENGINE_IDS: readonly OcrEngineId[] = ['tesseract', 'paddle', 'ensemble'];
export const DEFAULT_OCR_ENGINE: OcrEngineId = 'tesseract';

export const OCR_ENGINE_LABELS: Readonly<Record<OcrEngineId, { label: string; detail: string }>> = Object.freeze({
  tesseract: { label: 'Tesseract', detail: 'The original reader. Reads names and numbers.' },
  paddle: { label: 'PaddleOCR numbers', detail: 'PP-OCRv4 reads K/D/A and other numbers; Tesseract still reads names.' },
  ensemble: { label: 'Ensemble (both must agree)', detail: 'Both engines read every number. Any disagreement leaves the cell empty for you to fill in.' },
});

/** Pinned offline runtime: served from the app's own origin like the Tesseract assets. */
export const PADDLE_OCR_RUNTIME = Object.freeze({
  onnxRuntimeWebVersion: '1.30.0',
  modelPackage: '@gutenye/ocr-models@1.4.2',
  model: 'ch_PP-OCRv4_rec_infer.onnx',
  recognitionVersion: 'ppocrv4-rec-digits-v1',
  wasmFile: '/ocr-assets/onnx/ort-wasm-simd-threaded.wasm',
  modelPath: '/ocr-assets/paddle/ch_PP-OCRv4_rec_infer.onnx',
  dictionaryPath: '/ocr-assets/paddle/ppocr_keys_v1.txt',
  inputHeight: 48,
});

/** Scale for PaddleOCR's 0..1 character probabilities so they compare with Tesseract's 0..100 floors. */
export const PADDLE_CONFIDENCE_SCALE = 100;

export function normalizeOcrEngineId(value: unknown): OcrEngineId {
  return OCR_ENGINE_IDS.includes(value as OcrEngineId) ? value as OcrEngineId : DEFAULT_OCR_ENGINE;
}

/**
 * The source-model suffix for an engine. Empty for Tesseract, so default
 * reads keep the exact model string, cache keys and learned-rule scope they
 * always had. Other engines get their own learned rules: a rule learned from
 * Tesseract's mistakes does not describe PaddleOCR's.
 */
export function ocrEngineModelSuffix(engine: OcrEngineId | undefined): string {
  const id = normalizeOcrEngineId(engine);
  if (id === 'tesseract') return '';
  return id === 'paddle' ? `+numbers:${PADDLE_OCR_RUNTIME.recognitionVersion}` : `+numbers:ensemble(tesseract,${PADDLE_OCR_RUNTIME.recognitionVersion})`;
}

export interface NumberRead { text: string; confidence: number | null }

const DIGITS = /^\d{1,5}$/;

/**
 * Ensemble rule: every engine must return the same digit string, otherwise
 * the cell abstains (empty text). Confidence is the minimum, carried even on
 * abstention so diagnostics can show why a cell was dropped.
 */
export function agreeingNumberRead(reads: readonly NumberRead[], pattern: RegExp = DIGITS): NumberRead & { agreed: boolean } {
  const cleaned = reads.map(read => ({ text: String(read.text || '').trim(), confidence: Number.isFinite(read.confidence) ? Number(read.confidence) : null }));
  const confidences = cleaned.map(read => read.confidence).filter((value): value is number => value !== null);
  const confidence = confidences.length === cleaned.length && confidences.length ? Math.min(...confidences) : null;
  const agreed = cleaned.length > 0 && cleaned.every(read => pattern.test(read.text) && read.text === cleaned[0].text);
  return { text: agreed ? cleaned[0].text : '', confidence, agreed };
}

export interface RgbaImage { width: number; height: number; data: Uint8ClampedArray }

/**
 * PP-OCR recognition input: the dark-on-white crop padded with white (a
 * quarter of its height by default), bilinear-resized to 48 px high, BGR, scaled to -1..1.
 */
export function paddleRecognitionTensor(image: RgbaImage, inputHeight: number = PADDLE_OCR_RUNTIME.inputHeight, padFraction = .25) {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data.length !== image.width * image.height * 4) throw new Error('The number crop is invalid.');
  const pad = Math.max(1, Math.round(image.height * padFraction));
  const sourceWidth = image.width + pad * 2; const sourceHeight = image.height + pad * 2;
  const sample = (x: number, y: number, channel: number) => {
    const ix = x - pad; const iy = y - pad;
    if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) return 255;
    return image.data[(iy * image.width + ix) * 4 + channel];
  };
  const height = inputHeight; const width = Math.max(16, Math.round(sourceWidth * height / sourceHeight));
  const plane = width * height; const tensor = new Float32Array(3 * plane);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.max(0, Math.min(sourceHeight - 1, (y + .5) * sourceHeight / height - .5)); const y0 = Math.floor(sy); const y1 = Math.min(sourceHeight - 1, y0 + 1); const fy = sy - y0;
    for (let x = 0; x < width; x += 1) {
      const sx = Math.max(0, Math.min(sourceWidth - 1, (x + .5) * sourceWidth / width - .5)); const x0 = Math.floor(sx); const x1 = Math.min(sourceWidth - 1, x0 + 1); const fx = sx - x0;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = (sample(x0, y0, channel) * (1 - fx) + sample(x1, y0, channel) * fx) * (1 - fy) + (sample(x0, y1, channel) * (1 - fx) + sample(x1, y1, channel) * fx) * fy;
        // PaddleOCR models were trained on BGR input.
        tensor[(2 - channel) * plane + y * width + x] = (value / 255 - .5) / .5;
      }
    }
  }
  return { tensor, width, height };
}

/** Character list for a PP-OCR dictionary: index 0 is the CTC blank, the last entry a space. */
export function paddleCharacters(dictionary: string) {
  const lines = dictionary.split(/\r?\n/); if (lines[lines.length - 1] === '') lines.pop();
  return ['', ...lines, ' '];
}

/**
 * Greedy CTC decode limited to digits: at each step only the blank and the
 * ten digit classes compete, the same restriction Tesseract's digit
 * whitelist applies. Confidence is the lowest probability of any emitted
 * digit (0..1), so one unsure digit makes the whole number unsure.
 */
export function decodeDigitsCtc(probabilities: ArrayLike<number>, steps: number, classes: number, characters: readonly string[]): NumberRead {
  if (characters.length !== classes) throw new Error(`The PaddleOCR dictionary has ${characters.length} classes but the model emits ${classes}.`);
  const digitClasses = characters.map((character, index) => /^[0-9]$/.test(character) ? index : -1).filter(index => index > 0);
  if (digitClasses.length !== 10) throw new Error('The PaddleOCR dictionary does not contain the ten digits.');
  let text = ''; let previous = -1; let confidence = Number.POSITIVE_INFINITY;
  for (let step = 0; step < steps; step += 1) {
    const offset = step * classes; let best = 0; let probability = Number(probabilities[offset]);
    for (const index of digitClasses) if (Number(probabilities[offset + index]) > probability) { probability = Number(probabilities[offset + index]); best = index; }
    if (best !== 0 && best !== previous) { text += characters[best]; confidence = Math.min(confidence, probability); }
    previous = best;
  }
  return { text, confidence: text ? confidence : null };
}

/** The slice of onnxruntime-web (or -node, in tests) this module needs. */
export interface OnnxRuntimeLike {
  InferenceSession: { create(model: Uint8Array | ArrayBuffer | string, options?: unknown): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { dims: readonly number[]; data: unknown }>>; release?(): Promise<void> }> };
  Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => unknown;
}

export interface PaddleDigitRecognizer {
  /**
   * Reads digits from a dark-on-white crop. Confidence is on Tesseract's
   * 0..100 scale. `padFraction` changes the white margin, which gives the
   * model a second, differently framed view of the same number.
   */
  readDigits(image: RgbaImage, padFraction?: number): Promise<NumberRead>;
  release(): Promise<void>;
}

export async function createPaddleDigitRecognizer(ort: OnnxRuntimeLike, model: Uint8Array | ArrayBuffer, dictionary: string): Promise<PaddleDigitRecognizer> {
  const characters = paddleCharacters(dictionary);
  const session = await ort.InferenceSession.create(model instanceof Uint8Array ? model : new Uint8Array(model));
  return {
    async readDigits(image, padFraction = .25) {
      const { tensor, width, height } = paddleRecognitionTensor(image, PADDLE_OCR_RUNTIME.inputHeight, padFraction);
      const outputs = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, height, width]) });
      const output = outputs[session.outputNames[0]];
      const [, steps, classes] = output.dims;
      const read = decodeDigitsCtc(output.data as ArrayLike<number>, steps, classes, characters);
      return { text: read.text, confidence: read.confidence === null ? null : read.confidence * PADDLE_CONFIDENCE_SCALE };
    },
    async release() { await session.release?.(); },
  };
}

/**
 * Browser loader: ONNX Runtime's WebAssembly build and the PP-OCRv4 model,
 * both served from the app's own /ocr-assets/ (staged and hash-checked by
 * scripts/stage-local-ocr-assets.mjs). No request leaves the app.
 */
export async function loadBrowserPaddleDigitRecognizer(): Promise<PaddleDigitRecognizer> {
  const imported = await import('onnxruntime-web/wasm');
  const ort = ((imported as any).default?.InferenceSession ? (imported as any).default : imported) as any;
  // Only the .wasm is fetched; the JavaScript glue is inside the bundled module.
  ort.env.wasm.wasmPaths = { wasm: PADDLE_OCR_RUNTIME.wasmFile };
  // One thread: threads need cross-origin isolation, and the renderer is not isolated.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const [model, dictionary] = await Promise.all([
    fetch(PADDLE_OCR_RUNTIME.modelPath).then(response => { if (!response.ok) throw new Error('The PaddleOCR model is missing from this build.'); return response.arrayBuffer(); }),
    fetch(PADDLE_OCR_RUNTIME.dictionaryPath).then(response => { if (!response.ok) throw new Error('The PaddleOCR dictionary is missing from this build.'); return response.text(); }),
  ]);
  return createPaddleDigitRecognizer(ort, model, dictionary);
}
