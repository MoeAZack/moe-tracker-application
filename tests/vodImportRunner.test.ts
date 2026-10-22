import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelVodImport, splitVodLinks, startVodBatchImport, vodImportStore, type VodBatchImportInput, type VodImportDeps } from '../src/utils/vodImportRunner';
import VodImportStatus from '../src/components/VodImportStatus';
import VodImportQueue from '../src/components/VodImportQueue';

const frame = { base64: Buffer.from('frame').toString('base64'), mediaType: 'image/png' };
const boundary = (timestampMs: number, map: string) => ({ timestampMs, score: 1, agentSelectScore: 1, map, mediaType: 'image/png', frame: `f-${timestampMs}` });
const discovery = { cacheId: 'cache-1', uploadDate: '2026-10-20', uploader: null, vodUrl: 'https://youtu.be/abc', videoId: 'abc', durationMs: 600_000, width: 1920, height: 1080, games: [], boundaries: [boundary(0, 'Ascent'), boundary(300_000, 'Bind')] };
const input = (overrides: Partial<VodBatchImportInput> = {}): VodBatchImportInput => ({ vodUrl: 'https://youtu.be/abc', local: null, expectedGames: 2, date: '2026-10-20', perspective: 'coach', povPlayerName: null, mapNames: ['Ascent', 'Bind'], roster: [{ id: 'p1', displayName: 'Alpha' }], matches: [], playerStats: [], ...overrides });

function harness(options: { failOnPost?: number; latestData?: any } = {}) {
  let emit: ((progress: { stage: string; percent: number | null; message: string }) => void) | null = null;
  let releaseAnalysis: (() => void) | null = null; let posts = 0;
  const desktop = {
    discoverVodGames: vi.fn(async (_request?: any) => discovery),
    readVodFrame: vi.fn(async () => frame),
    analyzeVod: vi.fn(() => new Promise(resolve => { releaseAnalysis = () => resolve({ observations: [], rawText: 'private' }); })),
    releaseVodAnalysis: vi.fn(async () => ({ released: true })),
    cancelVodAnalysis: vi.fn(async () => ({ cancelled: true })),
    onVodAnalysisProgress: vi.fn((callback: any) => { emit = callback; return () => { emit = null; }; }),
  };
  const apiFetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/data') return new Response(JSON.stringify(options.latestData ?? { matches: [], playerStats: [] }), { status: 200 });
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

  it('queues a second VOD and runs it after the first, one at a time', async () => {
    const h = harness(); const order: string[] = [];
    h.desktop.discoverVodGames.mockImplementation(async (request: any) => { order.push(request.vodUrl); return { ...discovery, vodUrl: request.vodUrl }; });
    const first = startVodBatchImport(input(), h.deps);
    const second = startVodBatchImport(input({ vodUrl: 'https://youtu.be/second', expectedGames: 2 }), h.deps);
    expect(vodImportStore.getSnapshot().queue.map(item => item.status)).toEqual(['running', 'waiting']);
    await h.finishAnalysis();
    // The second VOD has not started while the first is still scanning.
    expect(order).toEqual(['https://youtu.be/abc']);
    await h.finishAnalysis();
    await expect(first).resolves.toBe(true);
    await h.finishAnalysis(); await h.finishAnalysis();
    await expect(second).resolves.toBe(true);
    expect(order).toEqual(['https://youtu.be/abc', 'https://youtu.be/second']);
    const state = vodImportStore.getSnapshot();
    expect(state.running).toBe(false); expect(state.runCount).toBe(2);
    expect(state.queue.map(item => [item.label, item.status, item.games.length])).toEqual([['https://youtu.be/abc', 'done', 2], ['https://youtu.be/second', 'done', 2]]);
  });

  it('runs three queued VODs first in, first out', async () => {
    const h = harness(); const order: string[] = [];
    h.desktop.discoverVodGames.mockImplementation(async (request: any) => { order.push(request.vodUrl); return { ...discovery, vodUrl: request.vodUrl }; });
    const runs = ['https://youtu.be/one', 'https://youtu.be/two', 'https://youtu.be/three'].map(vodUrl => startVodBatchImport(input({ vodUrl }), h.deps));
    for (const run of runs) { await h.finishAnalysis(); await h.finishAnalysis(); await expect(run).resolves.toBe(true); }
    expect(order).toEqual(['https://youtu.be/one', 'https://youtu.be/two', 'https://youtu.be/three']);
  });

  it('does not queue a video that is already waiting or importing', async () => {
    const h = harness();
    const first = startVodBatchImport(input(), h.deps);
    await expect(startVodBatchImport(input(), h.deps)).resolves.toBe(false);
    expect(vodImportStore.getSnapshot().queue).toHaveLength(1);
    await h.finishAnalysis(); await h.finishAnalysis(); await first;
    // Once it has finished, importing it again is the coach's call.
    const again = startVodBatchImport(input(), h.deps);
    expect(vodImportStore.getSnapshot().queue).toHaveLength(2);
    await h.finishAnalysis(); await h.finishAnalysis(); await again;
  });

  it('links a queued VOD against data saved by the VOD before it', async () => {
    const latest = { matches: [{ id: 'm-new', date: '2026-10-20', map: 'Ascent', ourScore: 13, theirScore: 9, opponent: 'OpponentA' }], playerStats: [{ matchId: 'm-new', playerId: 'p1' }] };
    const h = harness({ latestData: latest });
    const first = startVodBatchImport(input(), h.deps);
    const second = startVodBatchImport(input({ vodUrl: 'https://youtu.be/second' }), h.deps);
    await h.finishAnalysis(); await h.finishAnalysis(); await first;
    await h.finishAnalysis(); await h.finishAnalysis(); await second;
    const posts = h.apiFetch.mock.calls.filter(([url]) => url === '/api/vod-submissions').map(([, init]) => JSON.parse(String(init?.body)));
    // The first VOD was queued before the match existed; the second sees it.
    expect(posts[0].matchId).toBeUndefined();
    expect(posts[2]).toMatchObject({ matchId: 'm-new', opponent: 'OpponentA', ourScore: 13 });
    expect(h.apiFetch.mock.calls.filter(([url]) => url === '/api/data')).toHaveLength(1);
  });

  it('removes a waiting VOD without touching the running one', async () => {
    const h = harness();
    const first = startVodBatchImport(input(), h.deps);
    const second = startVodBatchImport(input({ vodUrl: 'https://youtu.be/second' }), h.deps);
    const secondId = vodImportStore.getSnapshot().queue[1].id;
    expect(vodImportStore.remove(vodImportStore.getSnapshot().queue[0].id)).toBe(false);
    expect(vodImportStore.remove(secondId)).toBe(true);
    await expect(second).resolves.toBe(false);
    await h.finishAnalysis(); await h.finishAnalysis();
    await expect(first).resolves.toBe(true);
    expect(h.desktop.discoverVodGames).toHaveBeenCalledTimes(1);
    expect(vodImportStore.getSnapshot().queue.map(item => item.status)).toEqual(['done', 'removed']);
    vodImportStore.clearFinished();
    expect(vodImportStore.getSnapshot().queue).toEqual([]);
  });

  it('keeps going to the next VOD when one fails', async () => {
    const h = harness({ failOnPost: 1 });
    const first = startVodBatchImport(input(), h.deps);
    const second = startVodBatchImport(input({ vodUrl: 'https://youtu.be/second' }), h.deps);
    await h.finishAnalysis();
    await expect(first).resolves.toBe(false);
    await h.finishAnalysis(); await h.finishAnalysis();
    await expect(second).resolves.toBe(true);
    expect(vodImportStore.getSnapshot().queue.map(item => item.status)).toEqual(['error', 'done']);
    expect(vodImportStore.getSnapshot().queue[0].message).toBe('Server refused game 2.');
  });

  it('lists the queue with a remove button only for waiting videos, and counts them on other tabs', async () => {
    const h = harness();
    const first = startVodBatchImport(input(), h.deps);
    const second = startVodBatchImport(input({ vodUrl: 'https://youtu.be/second' }), h.deps);
    const queueHtml = () => renderToStaticMarkup(React.createElement(VodImportQueue, { queue: vodImportStore.getSnapshot().queue }));
    expect(queueHtml()).toContain('Video queue · 2 videos · 1 waiting');
    expect(queueHtml()).toContain('aria-label="Remove https://youtu.be/second from the queue"');
    expect(queueHtml()).not.toContain('Remove https://youtu.be/abc');
    expect(renderToStaticMarkup(React.createElement(VodImportStatus, { onOpen: () => {} }))).toContain('1 more queued');
    await h.finishAnalysis(); await h.finishAnalysis(); await first;
    await h.finishAnalysis(); await h.finishAnalysis(); await second;
    expect(queueHtml()).toContain('2 of 2 games saved');
    expect(queueHtml()).toContain('Clear finished');
    expect(renderToStaticMarkup(React.createElement(VodImportQueue, { queue: [] }))).toBe('');
  });

  it('splits a pasted list of links into one VOD each', () => {
    expect(splitVodLinks('https://youtu.be/a\nhttps://youtu.be/b, https://youtu.be/a  https://www.youtube.com/live/c')).toEqual(['https://youtu.be/a', 'https://youtu.be/b', 'https://www.youtube.com/live/c']);
    expect(splitVodLinks('  ')).toEqual([]);
    expect(splitVodLinks('youtu.be/a')).toEqual(['youtu.be/a']);
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
