import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelVodImport, startVodBatchImport, vodImportStore, type VodBatchImportInput, type VodImportDeps } from '../src/utils/vodImportRunner';
import VodImportStatus from '../src/components/VodImportStatus';

const frame = { base64: Buffer.from('frame').toString('base64'), mediaType: 'image/png' };
const boundary = (timestampMs: number, map: string) => ({ timestampMs, score: 1, agentSelectScore: 1, map, mediaType: 'image/png', frame: `f-${timestampMs}` });
const discovery = { cacheId: 'cache-1', uploadDate: '2026-10-20', uploader: null, vodUrl: 'https://youtu.be/abc', videoId: 'abc', durationMs: 600_000, width: 1920, height: 1080, games: [], boundaries: [boundary(0, 'Ascent'), boundary(300_000, 'Bind')] };
const input = (overrides: Partial<VodBatchImportInput> = {}): VodBatchImportInput => ({ vodUrl: 'https://youtu.be/abc', local: null, expectedGames: 2, date: '2026-10-20', perspective: 'coach', povPlayerName: null, mapNames: ['Ascent', 'Bind'], roster: [{ id: 'p1', displayName: 'Alpha' }], matches: [], playerStats: [], ...overrides });

function harness(options: { failOnPost?: number } = {}) {
  let emit: ((progress: { stage: string; percent: number | null; message: string }) => void) | null = null;
  let releaseAnalysis: (() => void) | null = null; let posts = 0;
  const desktop = {
    discoverVodGames: vi.fn(async () => discovery),
    readVodFrame: vi.fn(async () => frame),
    analyzeVod: vi.fn(() => new Promise(resolve => { releaseAnalysis = () => resolve({ observations: [], rawText: 'private' }); })),
    releaseVodAnalysis: vi.fn(async () => ({ released: true })),
    cancelVodAnalysis: vi.fn(async () => ({ cancelled: true })),
    onVodAnalysisProgress: vi.fn((callback: any) => { emit = callback; return () => { emit = null; }; }),
  };
  const apiFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    posts += 1; const body = JSON.parse(String(init?.body));
    expect(JSON.stringify(body)).not.toContain('private');
    if (options.failOnPost === posts) return new Response(JSON.stringify({ error: 'Server refused game 2.' }), { status: 500 });
    return new Response(JSON.stringify({ submission: { linkMode: 'new-match' } }), { status: 200 });
  });
  const deps = { desktop, apiFetch, extractScoreboard: vi.fn(async () => { throw new Error('not a scoreboard'); }) } as unknown as VodImportDeps;
  const finishAnalysis = async () => { for (let i = 0; i < 20 && !releaseAnalysis; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); const release = releaseAnalysis; releaseAnalysis = null; release?.(); };
  return { deps, desktop, apiFetch, emit: (progress: { stage: string; percent: number | null; message: string }) => emit?.(progress), finishAnalysis };
}

afterEach(() => vodImportStore.reset());

describe('VOD import runner survives leaving the VOD tab', () => {
  it('keeps running and keeps progress with no component subscribed, then finishes and refreshes data', async () => {
    const h = harness(); const onSaved = vi.fn();
    // A tab subscribes, then unmounts (tab change) right after starting the import.
    const unsubscribe = vodImportStore.subscribe(() => {});
    const run = startVodBatchImport(input({ onSaved }), h.deps);
    unsubscribe();
    await h.finishAnalysis();
    h.emit({ stage: 'analyze', percent: 50, message: 'Reading kill feed…' });
    expect(vodImportStore.getSnapshot()).toMatchObject({ running: true, progress: { owner: 'batch', step: 3, message: 'Reading kill feed…', status: 'working' } });
    await h.finishAnalysis();
    await expect(run).resolves.toBe(true);
    const state = vodImportStore.getSnapshot();
    expect(state.running).toBe(false); expect(state.progress?.status).toBe('done'); expect(state.batchResult.map(game => game.map)).toEqual(['Ascent', 'Bind']); expect(state.runCount).toBe(1);
    expect(h.apiFetch).toHaveBeenCalledTimes(2); expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.desktop.releaseVodAnalysis).toHaveBeenCalledWith({ cacheId: 'cache-1', completed: true });
  });

  it('refuses to start a second import while one is running', async () => {
    const h = harness(); const run = startVodBatchImport(input(), h.deps);
    await expect(startVodBatchImport(input(), h.deps)).resolves.toBe(false);
    expect(h.desktop.discoverVodGames).toHaveBeenCalledTimes(1);
    await h.finishAnalysis(); await h.finishAnalysis(); await run;
  });

  it('reports a failure clearly and says which games were already saved', async () => {
    const h = harness({ failOnPost: 2 }); const onSaved = vi.fn();
    const run = startVodBatchImport(input({ onSaved }), h.deps);
    await h.finishAnalysis(); await h.finishAnalysis();
    await expect(run).resolves.toBe(false);
    const state = vodImportStore.getSnapshot();
    expect(state.running).toBe(false); expect(state.progress?.status).toBe('error');
    expect(state.progress?.message).toBe('Server refused game 2. 1 game was already saved before it stopped.');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(h.desktop.releaseVodAnalysis).toHaveBeenCalledWith({ cacheId: 'cache-1', completed: false });
  });

  it('cancels through the desktop bridge only while running', async () => {
    const h = harness();
    await expect(cancelVodImport(h.deps)).resolves.toBe(false);
    const run = startVodBatchImport(input(), h.deps);
    await expect(cancelVodImport(h.deps)).resolves.toBe(true);
    expect(h.desktop.cancelVodAnalysis).toHaveBeenCalledTimes(1);
    await h.finishAnalysis(); await h.finishAnalysis(); await run;
  });

  it('shows a window-wide status on other tabs and hides it on the VOD tab', async () => {
    const h = harness(); const run = startVodBatchImport(input(), h.deps);
    const onOpen = () => {};
    expect(renderToStaticMarkup(React.createElement(VodImportStatus, { onOpen }))).toContain('keeps running while you use other tabs');
    expect(renderToStaticMarkup(React.createElement(VodImportStatus, { onOpen, hidden: true }))).toBe('');
    await h.finishAnalysis(); await h.finishAnalysis(); await run;
    expect(renderToStaticMarkup(React.createElement(VodImportStatus, { onOpen }))).toContain('Video import complete');
    vodImportStore.dismiss();
    expect(renderToStaticMarkup(React.createElement(VodImportStatus, { onOpen }))).toBe('');
  });
});
