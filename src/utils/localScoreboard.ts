import type { ScoreboardSelection } from '../../lib/localOcrEngine';

export async function extractScoreboardLocally(file: File, rosterPlayers: Array<{ id?: string; displayName: string }>, selection?: ScoreboardSelection) {
  const buffer = await file.arrayBuffer();
  const imageSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join('');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The scoreboard image could not be read locally.')); reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = dataUrl; await image.decode();
  const localOcr = await import('../../lib/localOcrEngine');
  const profile = selection ? localOcr.createSelectedScoreboardProfile(image.naturalWidth, image.naturalHeight, selection) : localOcr.createValorantEndScreenProfile(image.naturalWidth, image.naturalHeight);
  const adapter = await localOcr.createBrowserLocalTesseractAdapter();
  try {
    return { imageSha256, draft: await localOcr.extractLocalScoreboardDraft(adapter, image, profile.dimensions, { capturedAt: new Date().toISOString(), rosterPlayers }, profile) };
  } finally { await adapter.terminate(); }
}
