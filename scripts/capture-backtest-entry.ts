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

(window as any).__runCaptureBacktest = async (payload: { captures: CaptureImage[]; rosterPlayers?: Array<{ id?: string; displayName: string }> }) => {
  const adapter = await createBrowserLocalTesseractAdapter();
  try {
    return await extractCaptureSession({ captures: payload.captures, rosterPlayers: payload.rosterPlayers || [], adapter, loadImage });
  } finally { await adapter.terminate(); }
};
