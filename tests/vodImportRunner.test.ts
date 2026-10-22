import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelVodImport, knownScoreboardRows, overallVodPercent, splitVodLinks, startVodBatchImport, vodImportStore, type VodBatchImportInput, type VodImportDeps } from '../src/utils/vodImportRunner';
import VodImportStatus from '../src/components/VodImportStatus';
import VodImportQueue from '../src/components/VodImportQueue';
import VodTeamPick from '../src/components/VodTeamPick';

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

  it('imports a first VOD on an empty workspace with nobody named, never linking by date and map alone', async () => {
    const h = harness();
    const run = startVodBatchImport(input({ roster: [], matches: [{ id: 'other-game', date: '2026-10-20', map: 'Ascent' }] as any }), h.deps);
    await h.finishAnalysis(); await h.finishAnalysis();
    await expect(run).resolves.toBe(true);
    expect(h.desktop.analyzeVod).toHaveBeenCalledTimes(2);
    for (const [request] of h.desktop.analyzeVod.mock.calls as any[]) expect(request.players).toEqual([]);
    for (const [url, init] of h.apiFetch.mock.calls as any[]) if (url === '/api/vod-submissions') { const body = JSON.parse(String(init.body)); expect(body.matchId).toBeUndefined(); expect(body.players).toEqual([]); }
    const state = vodImportStore.getSnapshot();
    expect(state.progress?.status).toBe('done');
    expect(state.batchResult.map(game => game.status)).toEqual(['Timeline imported · scoreboard pending · players not named yet', 'Timeline imported · scoreboard pending · players not named yet']);
    expect(state.message).toContain('No player names were known for these games');
    expect(state.message).toContain('Players are added automatically from the end-of-game scoreboard');
  });

  it('asks the coach for our five before adding anyone, then recognises them in the next game', async () => {
    const h = harness();
    // ACS-ranked board: opponents hold four of the top five rows; only Alpha is on the roster.
    const names = ['Alpha', 'Foe1', 'Foe2', 'Foe3', 'Foe4', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foe5'];
    const board = (map: string, theirScore: number) => ({ imageSha256: map === 'Ascent' ? 'a'.repeat(64) : 'b'.repeat(64), draft: { match: { map, ourScore: 13, theirScore }, stats: names.map((extractedName, index) => ({ extractedName, rosterMatch: { status: extractedName === 'Alpha' ? 'matched' : 'unmatched' }, matchedPlayerId: extractedName === 'Alpha' ? 'p1' : null, agent: 'Jett', kills: 20 - index, deaths: 10, assists: 3 })) } });
    (h.deps as any).extractScoreboard = vi.fn().mockResolvedValueOnce(board('Ascent', 5)).mockResolvedValueOnce(board('Bind', 9));
    discovery.games = [{ timestampMs: 280_000, frame: 'g1' }, { timestampMs: 590_000, frame: 'g2' }] as any;
    h.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/data') return new Response(JSON.stringify({ matches: [], playerStats: [] }), { status: 200 });
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ submission: { linkMode: 'new-match', integration: { addedPlayers: body.map === 'Ascent' ? ['Bravo', 'Charlie', 'Delta', 'Echo'] : [] } } }), { status: 200 });
    });
    const ours = [0, 5, 6, 7, 8];
    try {
      // A saved game with the same date, map and score must not be linked: the new players are in no saved game.
      const run = startVodBatchImport(input({ matches: [{ id: 'saved', date: '2026-10-20', map: 'Ascent', ourScore: 13, theirScore: 5 }] as any, playerStats: [{ matchId: 'saved', playerId: 'p1' }] as any }), h.deps);
      for (let i = 0; i < 50 && !vodImportStore.getSnapshot().teamPick; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
      const pick = vodImportStore.getSnapshot().teamPick!;
      expect(pick.rows.filter(row => row.known).map(row => row.index)).toEqual([0]);
      expect(h.desktop.analyzeVod).not.toHaveBeenCalled();
      expect((h.apiFetch.mock.calls as any[]).some(([url]) => url === '/api/vod-submissions')).toBe(false);
      const card = renderToStaticMarkup(React.createElement(VodTeamPick));
      for (const name of names) expect(card).toContain(name);
      expect(card).toContain('These are our five (1/5)');
      expect(vodImportStore.answerTeamPick([0, 5, 6, 7])).toBe(false);
      expect(vodImportStore.answerTeamPick(ours)).toBe(true);
      await h.finishAnalysis(); await h.finishAnalysis();
      await expect(run).resolves.toBe(true);
      const posts = (h.apiFetch.mock.calls as any[]).filter(([url]) => url === '/api/vod-submissions').map(([, init]) => JSON.parse(String(init.body)));
      expect(posts).toHaveLength(2);
      expect(posts[0]).toMatchObject({ addObservedPlayers: true, coachTeamEvidence: true });
      // The second game names the same five, so it neither asks again nor adds anyone.
      expect(posts[1].addObservedPlayers).toBeUndefined();
      for (const body of posts) {
        expect(body.matchId).toBeUndefined();
        expect(body.players.map((player: any) => player.observedName)).toEqual(ours.map(index => names[index]));
      }
      const [request] = h.desktop.analyzeVod.mock.calls[0] as any[];
      expect(request.players.filter((player: any) => player.team === 'ours').map((player: any) => player.name)).toEqual(ours.map(index => names[index]));
      const state = vodImportStore.getSnapshot();
      expect(state.teamPick).toBeNull();
      expect(state.batchResult.map(game => game.status)).toEqual(['New match created · 4 new players added', 'New match created']);
      expect(state.message).toContain('4 new players were added from the scoreboard names');
    } finally { discovery.games = []; }
  });

  it('saves a game without names when the coach skips the pick, and stops cleanly when cancelled', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `Name${index}`);
    const board = { imageSha256: 'c'.repeat(64), draft: { match: { map: 'Ascent', ourScore: 13, theirScore: 4 }, stats: names.map(extractedName => ({ extractedName, rosterMatch: { status: 'unmatched' }, matchedPlayerId: null, agent: null, kills: 10, deaths: 10, assists: 1 })) } };
    discovery.games = [{ timestampMs: 280_000, frame: 'g1' }] as any;
    const waitForPick = async () => { for (let i = 0; i < 50 && !vodImportStore.getSnapshot().teamPick; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };
    try {
      const skip = harness(); (skip.deps as any).extractScoreboard = vi.fn().mockResolvedValue(board);
      const skipped = startVodBatchImport(input({ expectedGames: 1 }), skip.deps);
      await waitForPick(); vodImportStore.answerTeamPick(null); await skip.finishAnalysis();
      await expect(skipped).resolves.toBe(true);
      const [, init] = (skip.apiFetch.mock.calls as any[]).find(([url]) => url === '/api/vod-submissions');
      const body = JSON.parse(String(init.body));
      expect(body.players).toEqual([]); expect(body.addObservedPlayers).toBeUndefined();
      expect((skip.desktop.analyzeVod.mock.calls[0] as any[])[0].players).toEqual([]);
      expect(vodImportStore.getSnapshot().batchResult[0].status).toContain('players not named');
      vodImportStore.reset();

      const stop = harness(); (stop.deps as any).extractScoreboard = vi.fn().mockResolvedValue(board);
      const cancelled = startVodBatchImport(input({ expectedGames: 1 }), stop.deps);
      await waitForPick();
      await expect(cancelVodImport(stop.deps)).resolves.toBe(true);
      await expect(cancelled).resolves.toBe(false);
      expect((stop.apiFetch.mock.calls as any[]).some(([url]) => url === '/api/vod-submissions')).toBe(false);
      expect(vodImportStore.getSnapshot().message).toContain('cancelled while it waited');
    } finally { discovery.games = []; }
  });

  it('a game saved without names never links to a saved match, even one with the same date, map and score', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `Name${index}`);
    const board = { imageSha256: 'd'.repeat(64), draft: { match: { map: 'Ascent', ourScore: 13, theirScore: 4 }, stats: names.map(extractedName => ({ extractedName, rosterMatch: { status: 'unmatched' }, matchedPlayerId: null, agent: null, kills: 10, deaths: 10, assists: 1 })) } };
    discovery.games = [{ timestampMs: 280_000, frame: 'g1' }] as any;
    try {
      const h = harness(); (h.deps as any).extractScoreboard = vi.fn().mockResolvedValue(board);
      const run = startVodBatchImport(input({ expectedGames: 1, matches: [{ id: 'saved', date: '2026-10-20', map: 'Ascent', ourScore: 13, theirScore: 4 }] as any, playerStats: [{ matchId: 'saved', playerId: 'p1' }] as any }), h.deps);
      for (let i = 0; i < 50 && !vodImportStore.getSnapshot().teamPick; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
      vodImportStore.answerTeamPick(null); await h.finishAnalysis();
      await expect(run).resolves.toBe(true);
      const [, init] = (h.apiFetch.mock.calls as any[]).find(([url]) => url === '/api/vod-submissions');
      const body = JSON.parse(String(init.body));
      expect(body.matchId).toBeUndefined(); expect(body.players).toEqual([]);
    } finally { discovery.games = []; }
  });

  it('keeps a board with an unreadable opponent name when five rows are on the roster, and drops it otherwise', async () => {
    const roster = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((displayName, index) => ({ id: `p${index + 1}`, displayName }));
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foe1', '', 'Foe3', 'Foe4', 'Foe5'];
    const board = (rostered: number) => ({ imageSha256: 'e'.repeat(64), draft: { match: { map: 'Ascent', ourScore: 13, theirScore: 7 }, stats: names.map((extractedName, index) => ({ extractedName, rosterMatch: { status: index < rostered ? 'matched' : 'unmatched' }, matchedPlayerId: index < rostered ? `p${index + 1}` : null, agent: 'Sova', kills: 15, deaths: 12, assists: 4 })) } });
    discovery.games = [{ timestampMs: 280_000, frame: 'g1' }] as any;
    const savedBoundaries = discovery.boundaries; discovery.boundaries = [boundary(0, 'Ascent')];
    try {
      const kept = harness(); (kept.deps as any).extractScoreboard = vi.fn().mockResolvedValue(board(5));
      const keptRun = startVodBatchImport(input({ expectedGames: 1, roster }), kept.deps);
      await kept.finishAnalysis();
      await expect(keptRun).resolves.toBe(true);
      expect(vodImportStore.getSnapshot().teamPick).toBeNull();
      const [, init] = (kept.apiFetch.mock.calls as any[]).find(([url]) => url === '/api/vod-submissions');
      const body = JSON.parse(String(init.body));
      expect(body.players.map((player: any) => player.observedName)).toEqual(names.slice(0, 5));
      expect(body.ourScore).toBe(13);
      vodImportStore.reset();

      // Four on the roster: the coach would have to pick from a board missing a name, so the board is not used.
      const dropped = harness(); (dropped.deps as any).extractScoreboard = vi.fn().mockResolvedValue(board(4));
      const droppedRun = startVodBatchImport(input({ expectedGames: 1, roster }), dropped.deps);
      await dropped.finishAnalysis();
      await expect(droppedRun).resolves.toBe(true);
      const [, droppedInit] = (dropped.apiFetch.mock.calls as any[]).find(([url]) => url === '/api/vod-submissions');
      expect(JSON.parse(String(droppedInit.body)).players).toEqual([]);
      expect(vodImportStore.getSnapshot().batchResult[0].status).toContain('scoreboard pending');
    } finally { discovery.games = []; discovery.boundaries = savedBoundaries; }
  });

  it('shows one overall percentage that never drops across games, stages and saves', async () => {
    const h = harness(); const overall: number[] = []; const details: string[] = [];
    const unsubscribe = vodImportStore.subscribe(() => { const progress = vodImportStore.getSnapshot().progress; if (progress?.status === 'working') { overall.push(overallVodPercent(progress)); if (progress.detail) details.push(progress.detail); } });
    try {
      const run = startVodBatchImport(input({ roster: [] }), h.deps);
      for (let game = 0; game < 2; game += 1) {
        for (let i = 0; i < 20 && h.desktop.analyzeVod.mock.calls.length <= game; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
        for (const [stage, percent, gamePercent, stageIndex] of [['probe', 100, 2, 1], ['sampling', 50, 21, 2], ['sampling', 0, 21, 2], ['sampling', 99, 40, 2], ['ocr', 0, 40, 3], ['ocr', 88, 93, 3], ['complete', 100, 100, 3]] as const)
          h.emit({ stage, percent, message: stage, gamePercent, stageIndex, stageCount: 3, stageLabel: stage } as any);
        await h.finishAnalysis();
      }
      await expect(run).resolves.toBe(true);
    } finally { unsubscribe(); }
    expect(overall.length).toBeGreaterThan(10);
    expect(overall).toEqual([...overall].sort((a, b) => a - b));
    expect(details).toContain('Game 1 of 2 · stage 3 of 3: ocr');
    expect(details).toContain('Game 2 of 2 · stage 2 of 3: sampling');
    expect(details).toContain('Game 1 of 2 · saving');
  });

  it('sends learned map reads to discovery, keeps each game editable, and records maps nobody corrected', async () => {
    const stored: Record<string, string> = { 'moetracker.vodMapReads.v1': JSON.stringify([{ token: 'havfn', map: 'Haven', kind: 'correction', source: 'old', at: 'then' }]) };
    vi.stubGlobal('localStorage', { getItem: (key: string) => stored[key] ?? null, setItem: (key: string, value: string) => { stored[key] = value; } });
    const savedBoundaries = discovery.boundaries;
    discovery.boundaries = [{ ...boundary(0, 'Haven'), mapSource: 'learned', mapRead: ['havfn'], firedTokens: ['havfn'] }, { ...boundary(300_000, 'Bind'), mapSource: 'read', mapRead: ['bind', 'havfn'], firedTokens: [] }] as any;
    try {
      const h = harness(); let saves = 0;
      h.apiFetch.mockImplementation(async (url: string) => url === '/api/data' ? new Response(JSON.stringify({ matches: [], playerStats: [] }), { status: 200 }) : new Response(JSON.stringify({ submission: { linkMode: 'new-match', linkedMatchId: `match-${++saves}` } }), { status: 200 }));
      const run = startVodBatchImport(input({ roster: [] }), h.deps);
      await h.finishAnalysis(); await h.finishAnalysis();
      await expect(run).resolves.toBe(true);
      expect((h.desktop.discoverVodGames.mock.calls[0] as any[])[0].mapHints).toEqual([{ token: 'havfn', map: 'Haven' }]);
      const games = vodImportStore.getSnapshot().batchResult;
      expect(games.map(game => game.matchId)).toEqual(['match-1', 'match-2']);
      expect(games[0]).toMatchObject({ map: 'Haven', mapSource: 'learned', firedTokens: ['havfn'] });
      expect(games[0].status).toContain('map remembered from your correction');
      expect(vodImportStore.updateGame(1, { map: 'Lotus', edited: true })).toBe(true);
      expect(vodImportStore.updateGame(5, { map: 'Lotus' })).toBe(false);
      // Game 2 kept Bind while reading the learned token: one sighting against havfn -> Haven.
      const samples = JSON.parse(stored['moetracker.vodMapReads.v1']);
      expect(samples.filter((sample: any) => sample.kind === 'kept')).toEqual([expect.objectContaining({ token: 'havfn', map: 'Bind', source: 'match-2' })]);
    } finally { discovery.boundaries = savedBoundaries; vi.unstubAllGlobals(); }
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

describe('known rows on a VOD scoreboard', () => {
  const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet'];
  const stats = (matched: number[]) => NAMES.map((extractedName, index) => ({ extractedName, rosterMatch: { status: matched.includes(index) ? 'matched' : 'unmatched' } }));
  it('counts only roster matches and names already saved as ours, never board position', () => {
    expect(knownScoreboardRows(stats([1, 3, 5, 7, 9]), [])).toEqual([1, 3, 5, 7, 9]);
    // An opponent ranked in the top five is not adopted.
    expect(knownScoreboardRows(stats([]), [])).toEqual([]);
    expect(knownScoreboardRows(stats([6]), [])).toEqual([6]);
    expect(knownScoreboardRows(stats([6]), ['india', 'Alpha'])).toEqual([0, 6, 8]);
    // A near miss is asked about again, not guessed.
    expect(knownScoreboardRows(stats([]), ['Alpha1'])).toEqual([]);
  });
});
