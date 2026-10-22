// Browser entry for the offline capture backtest. It runs the exact pipeline
// the desktop importer runs (lib/captureSessionPipeline.ts) so measured
// accuracy is the accuracy coaches get.
import { createBrowserLocalTesseractAdapter } from '../lib/localOcrEngine';
import { extractCaptureSession, type CaptureImage } from '../lib/captureSessionPipeline';

const loadImage = async (capture: CaptureImage) => {
  const image = new Image();
  image.src = `data:${capture.mediaType};base64,${capture.base64}`;
  await image.decode();
  return image;
};

/**
 * Coverage for resolutions the corpus was not captured at: every image is
 * redrawn at the target size (smoothed, as a scaled game render would be)
 * and re-encoded as PNG before the unchanged pipeline reads it. A real
 * client at that resolution renders text natively, so this approximates it.
 */
export async function resampleCapture(capture: CaptureImage, width: number, height: number): Promise<CaptureImage> {
  const image = await loadImage(capture);
  if (image.naturalWidth === width && image.naturalHeight === height) return capture;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable for resampling.');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return { ...capture, mediaType: 'image/png', base64: canvas.toDataURL('image/png').split(',')[1] };
}

(window as any).__runCaptureBacktest = async (payload: { captures: CaptureImage[]; rosterPlayers?: Array<{ id?: string; displayName: string }>; resample?: { width: number; height: number } | null }) => {
  const adapter = await createBrowserLocalTesseractAdapter();
  try {
    const captures = payload.resample ? await Promise.all(payload.captures.map(capture => resampleCapture(capture, payload.resample!.width, payload.resample!.height))) : payload.captures;
    return await extractCaptureSession({ captures, rosterPlayers: payload.rosterPlayers || [], adapter, loadImage });
  } finally { await adapter.terminate(); }
};
