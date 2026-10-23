import { createBrowserLocalTesseractAdapter } from '../lib/localOcrEngine';
import { loadBrowserPaddleDigitRecognizer } from '../lib/ocrEngines';

const result = { status: 'running', error: '' };
(window as any).__ocrWorkerSmoke = result;

try {
  const adapter = await createBrowserLocalTesseractAdapter();
  await adapter.terminate();
  // The optional PaddleOCR number engine must start from same-origin assets
  // under the same CSP, and read a drawn number.
  const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 24;
  const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 40, 24);
  context.fillStyle = '#000'; context.font = 'bold 18px sans-serif'; context.textBaseline = 'middle'; context.fillText('27', 8, 13);
  const recognizer = await loadBrowserPaddleDigitRecognizer();
  const read = await recognizer.readDigits(context.getImageData(0, 0, 40, 24));
  await recognizer.release();
  if (read.text !== '27') throw new Error(`PaddleOCR read ${read.text || 'nothing'} instead of 27.`);
  const paddleAdapter = await createBrowserLocalTesseractAdapter({ engine: 'paddle' });
  await paddleAdapter.terminate();
  if (paddleAdapter.engine !== 'paddle') throw new Error('The adapter did not start the PaddleOCR engine.');
  result.status = 'ok';
  document.body.dataset.ocrWorker = 'ok';
} catch (error) {
  result.status = 'error';
  result.error = error instanceof Error ? error.message : String(error);
  document.body.dataset.ocrWorker = 'error';
}
