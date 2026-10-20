import type { ScoreboardSelection } from '../../lib/localOcrEngine';
import { LOCAL_SCOREBOARD_CACHE_VERSION, localScoreboardCacheKey, pruneOcrResultCache } from '../../lib/ocrResultCache';

const CACHE_STORAGE_KEY = 'moetracker.local-scoreboard-cache/v2';
const memoryCache = new Map<string, any>();
const storedCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY) || '{}'); } catch { return {}; } };
const remember = (key: string, draft: any) => {
  memoryCache.set(key, structuredClone(draft));
  try { const entries = storedCache(); entries[key] = { version: LOCAL_SCOREBOARD_CACHE_VERSION, usedAt: new Date().toISOString(), draft }; localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(pruneOcrResultCache(entries))); } catch { /* Private storage or quota limits only disable persistence. */ }
};

export async function extractScoreboardLocally(file: File, rosterPlayers: Array<{ id?: string; displayName: string }>, selection?: ScoreboardSelection, options: { trackJob?: boolean } = {}) {
  const ingestionJobId = options.trackJob === false ? '' : (await window.moeDesktop?.beginIngestionJob({ source: 'screenshot' }).catch(() => null))?.id || '';
  const updateJob = (status: 'running' | 'ready' | 'failed', stage: string, percent: number | null, message: string) => ingestionJobId ? window.moeDesktop?.updateIngestionJob({ id: ingestionJobId, status, stage, percent, message }).catch(() => null) : null;
  try {
  const buffer = await file.arrayBuffer();
  const imageSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(value => value.toString(16).padStart(2, '0')).join(''); await updateJob('running', 'cache-check', 10, 'Checking the local OCR cache…');
  const cacheKey = localScoreboardCacheKey({ imageSha256, rosterPlayers, selection });
  const memory = memoryCache.get(cacheKey); if (memory) { await updateJob('ready', 'review', 100, 'Reused the unchanged screenshot extraction.'); return { imageSha256, draft: structuredClone(memory), cache: 'memory' as const, ingestionJobId }; }
  const persisted = storedCache()[cacheKey]; if (persisted?.version === LOCAL_SCOREBOARD_CACHE_VERSION && persisted?.draft) { memoryCache.set(cacheKey, persisted.draft); await updateJob('ready', 'review', 100, 'Reused the unchanged screenshot extraction.'); return { imageSha256, draft: structuredClone(persisted.draft), cache: 'disk' as const, ingestionJobId }; }
  await updateJob('running', 'ocr', 25, 'Reading scoreboard text and geometry locally…');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The scoreboard image could not be read locally.')); reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = dataUrl; await image.decode();
  const localOcr = await import('../../lib/localOcrEngine');
  let profile;
  if (selection) profile = localOcr.createSelectedScoreboardProfile(image.naturalWidth, image.naturalHeight, selection);
  else {
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Scoreboard layout detection is unavailable.');
    context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    profile = localOcr.createValorantEndScreenProfile(image.naturalWidth, image.naturalHeight, 'custom', localOcr.measureScoreDigitBoxes(pixels), localOcr.measureScoreboardRowOffset(pixels));
  }
  const adapter = await localOcr.createBrowserLocalTesseractAdapter();
  try {
    const draft = await localOcr.extractLocalScoreboardDraft(adapter, image, profile.dimensions, { capturedAt: new Date().toISOString(), rosterPlayers }, profile); remember(cacheKey, draft); await updateJob('ready', 'review', 100, 'Scoreboard extraction is ready for review.'); return { imageSha256, draft, cache: 'fresh' as const, ingestionJobId };
  } finally { await adapter.terminate(); }
  } catch (error) { await updateJob('failed', 'ocr-failed', null, error instanceof Error ? error.message : 'Screenshot OCR failed.'); throw error; }
}
