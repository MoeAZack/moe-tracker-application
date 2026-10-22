import { useSyncExternalStore } from 'react';
import type { ScreenshotReviewDraft, TrackerData } from '../types';
import { extractScoreboardLocally } from './localScoreboard';
import { apiFetch } from './api';
import { normalizedMatchName } from '../../lib/matchIdentity';

// The automatic multi-game VOD import used to run inside the VOD tab's React
// component, so switching tabs threw away its progress and the link to the
// running job. It now lives here, at module level, for the life of the window:
// leaving the tab neither stops the import nor hides its progress.
//
// Several VODs can be queued. They run one at a time, in the order added,
// because each one downloads and scans a whole video on this machine.

export type VodProgress = { owner: 'batch' | 'personal'; step: number; stepPercent: number | null; message: string; status: 'working' | 'ready' | 'done' | 'error' };
export type VodBatchGame = { map: string; score: string; status: string };
export type VodQueueStatus = 'waiting' | 'running' | 'done' | 'error' | 'removed';
export type VodQueueItem = { id: string; label: string; expectedGames: number; status: VodQueueStatus; message: string; games: VodBatchGame[] };
/** A game whose scoreboard does not name five known players: the coach ticks our five before anyone is added. */
export type VodTeamPick = { game: number; totalGames: number; map: string; score: string; rows: Array<{ index: number; name: string; agent: string | null; kills: number | null; deaths: number | null; assists: number | null; known: boolean }> };
export type VodImportState = {
  /** True from the first queued VOD until the queue is empty. */
  running: boolean;
  queue: VodQueueItem[];
  progress: VodProgress | null;
  message: string;
  batchResult: VodBatchGame[];
  sourceLabel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  // Bumped once per finished run so views can reload their history.
  runCount: number;
  dismissed: boolean;
  /** Set while the import waits for the coach to pick our five players. */
  teamPick: VodTeamPick | null;
};

export const VOD_STEPS = ['Download video', 'Find games', 'Read scoreboards', 'Analyze timelines', 'Save results'];
export const clampPercent = (input: number) => Math.max(0, Math.min(100, Math.round(input)));
export const overallVodPercent = (progress: VodProgress) => {
  const stagePart = progress.stepPercent === null ? 0 : progress.stepPercent / 100;
  return progress.status === 'done' ? 100 : clampPercent((progress.step + stagePart) / VOD_STEPS.length * 100);
};

type Roster = Array<{ id: string; displayName: string; aliases?: string[] }>;
export type VodBatchImportInput = {
  vodUrl: string;
  local: { path: string; name: string } | null;
  expectedGames: number;
  date: string;
  perspective: 'coach' | 'player';
  povPlayerName: string | null;
  mapNames: string[];
  roster: Roster;
  matches: TrackerData['matches'];
  playerStats: TrackerData['playerStats'];
  onSaved?: () => Promise<void> | void;
};
export const vodSourceLabel = (input: Pick<VodBatchImportInput, 'vodUrl' | 'local'>) => input.local?.name || input.vodUrl;

/** Every link in a pasted list (one per line, or separated by spaces or commas). Text with no link stays one entry. */
export function splitVodLinks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const links = trimmed.match(/https?:\/\/[^\s,]+/gi);
  return links ? [...new Set(links)] : [trimmed];
}
type Desktop = NonNullable<typeof window.moeDesktop>;
export type VodImportDeps = {
  desktop: Pick<Desktop, 'discoverVodGames' | 'readVodFrame' | 'analyzeVod' | 'releaseVodAnalysis' | 'cancelVodAnalysis'> & Partial<Pick<Desktop, 'onVodAnalysisProgress'>>;
  apiFetch: typeof apiFetch;
  extractScoreboard: typeof extractScoreboardLocally;
};

const initialState = (): VodImportState => ({ running: false, queue: [], progress: null, message: '', batchResult: [], sourceLabel: null, startedAt: null, finishedAt: null, runCount: 0, dismissed: false, teamPick: null });
let state: VodImportState = initialState();
const listeners = new Set<() => void>();
const progressContext = { gameIndex: 0, totalGames: 1 };
let progressUnsubscribe: (() => void) | null = null;
type Pending = { id: string; input: VodBatchImportInput; deps: VodImportDeps; runCountAtQueue: number; resolve: (completed: boolean) => void };
let pending: Pending[] = [];
type TeamPickAnswer = number[] | null | 'cancel';
let teamPickResolver: ((answer: TeamPickAnswer) => void) | null = null;
const settleTeamPick = (answer: TeamPickAnswer) => { const resolve = teamPickResolver; teamPickResolver = null; if (resolve) { setState({ teamPick: null }); resolve(answer); } };
const askTeamPick = (pick: VodTeamPick) => new Promise<TeamPickAnswer>(resolve => { teamPickResolver = resolve; setState({ teamPick: pick, dismissed: false }); });
let nextQueueId = 1;

const setState = (patch: Partial<VodImportState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
const setProgress = (progress: VodProgress) => setState({ progress });
const updateQueueItem = (id: string, patch: Partial<VodQueueItem>) => setState({ queue: state.queue.map(item => item.id === id ? { ...item, ...patch } : item) });

export const vodImportStore = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  dismiss: () => { if (!state.running) setState({ dismissed: true }); },
  /**
   * The coach's answer to the team pick: five scoreboard rows, or null to save
   * the game without naming anyone. Anything else is refused.
   */
  answerTeamPick: (rows: number[] | null) => {
    const pick = state.teamPick;
    if (!pick || !teamPickResolver) return false;
    if (rows && (new Set(rows).size !== 5 || rows.length !== 5 || rows.some(index => !pick.rows.some(row => row.index === index)))) return false;
    settleTeamPick(rows ? [...rows].sort((a, b) => a - b) : null);
    return true;
  },
  reset: () => { settleTeamPick('cancel'); progressUnsubscribe?.(); progressUnsubscribe = null; pending.forEach(item => item.resolve(false)); pending = []; state = initialState(); for (const listener of listeners) listener(); },
  /** Takes a VOD that has not started yet out of the queue. The running one is stopped with cancelVodImport. */
  remove: (id: string) => {
    const item = pending.find(entry => entry.id === id);
    if (!item) return false;
    pending = pending.filter(entry => entry !== item);
    updateQueueItem(id, { status: 'removed', message: 'Removed before it started.' });
    item.resolve(false);
    return true;
  },
  /** Hides finished and removed VODs from the queue list. */
  clearFinished: () => setState({ queue: state.queue.filter(item => item.status === 'waiting' || item.status === 'running') }),
};
export const useVodImportState = () => useSyncExternalStore(vodImportStore.subscribe, vodImportStore.getSnapshot, vodImportStore.getSnapshot);

const value = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : null;
const fileFromBase64 = (base64: string, name: string, type: string) => {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
};
const sha256File = async (file: File) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(item => item.toString(16).padStart(2, '0')).join('');
const stripRawText = (evidence: unknown) => JSON.parse(JSON.stringify(evidence, (key, item) => key === 'rawText' ? undefined : item));

/**
 * Scoreboard rows that name a known player: a roster match, or exactly a name
 * this import already saved as ours. Near misses are not guessed here; the
 * coach is asked again.
 */
export function knownScoreboardRows(stats: ReadonlyArray<{ extractedName?: string | null; rosterMatch?: { status?: string } }>, oursThisRun: readonly string[]) {
  const ours = new Set(oursThisRun.map(name => normalizedMatchName(name)).filter(Boolean));
  return stats.map((row, index) => row.rosterMatch?.status === 'matched' || ours.has(normalizedMatchName(row.extractedName)) ? index : -1).filter(index => index >= 0);
}

export function boundaryTimelinePlayers(activeRoster: readonly { displayName: string }[], linkedMatch: any) {
  const ours = activeRoster.map(player => String(player.displayName || '').trim()).filter(Boolean);
  const theirs = (linkedMatch?.screenshotEvidence?.scoreboardPlayers || [])
    .filter((player: any) => player?.allied === false)
    .map((player: any) => String(player?.name || '').trim()).filter(Boolean);
  const identified: Array<{ name: string; team: 'ours' | 'theirs' }> = [
    ...ours.map(name => ({ name, team: 'ours' as const })),
    ...theirs.map((name: string) => ({ name, team: 'theirs' as const })),
  ];
  return [...new Map(identified.map(player => [player.name.toLocaleLowerCase('en'), player])).values()].slice(0, 10);
}

// One listener for the whole window, installed on the first import and never
// tied to a component, so main-process progress keeps arriving while the
// coach is on another tab.
const ensureProgressListener = (deps: VodImportDeps) => {
  if (progressUnsubscribe || !deps.desktop.onVodAnalysisProgress) return;
  progressUnsubscribe = deps.desktop.onVodAnalysisProgress(progress => {
    if (!state.running) return;
    const raw = progress.percent === null ? null : clampPercent(progress.percent);
    if (progress.stage === 'download') setProgress({ owner: 'batch', step: 0, stepPercent: raw, message: progress.message, status: 'working' });
    else if (progress.stage === 'discover') setProgress({ owner: 'batch', step: 1, stepPercent: raw, message: progress.message, status: 'working' });
    else {
      const combined = raw === null ? null : ((progressContext.gameIndex + raw / 100) / Math.max(1, progressContext.totalGames)) * 100;
      setProgress({ owner: 'batch', step: 3, stepPercent: combined, message: progress.message, status: 'working' });
    }
  });
};

const defaultDeps = (): VodImportDeps | null => window.moeDesktop ? { desktop: window.moeDesktop, apiFetch, extractScoreboard: extractScoreboardLocally } : null;

export const cancelVodImport = async (deps: VodImportDeps | null = defaultDeps()) => {
  if (!state.running || !deps) return false;
  // Waiting on the coach is this window's own step; cancelling ends it here.
  if (teamPickResolver) { settleTeamPick('cancel'); return true; }
  const result = await deps.desktop.cancelVodAnalysis().catch(() => null);
  if (result?.cancelled && state.progress) setProgress({ ...state.progress, message: 'Cancelling safely…' });
  return !!result?.cancelled;
};

/**
 * Adds a VOD to the import queue and starts the queue if it is idle. Resolves
 * with true once this VOD's games are all saved, false if it failed or was
 * removed; never rejects.
 */
export function startVodBatchImport(input: VodBatchImportInput, deps: VodImportDeps | null = defaultDeps()): Promise<boolean> {
  if (!deps || (!input.vodUrl && !input.local)) return Promise.resolve(false);
  // The same video pasted again while it is still waiting or importing would only import it twice.
  const label = vodSourceLabel(input);
  if (state.queue.some(item => item.label === label && (item.status === 'waiting' || item.status === 'running'))) return Promise.resolve(false);
  const id = `vod-${nextQueueId++}`;
  const done = new Promise<boolean>(resolve => { pending.push({ id, input, deps, runCountAtQueue: state.runCount, resolve }); });
  setState({ dismissed: false, queue: [...state.queue, { id, label, expectedGames: Math.max(1, Math.min(12, input.expectedGames || 1)), status: 'waiting', message: state.running ? 'Waiting for the video before it.' : 'Starting…', games: [] }] });
  if (!state.running) void drainQueue();
  return done;
}

// Runs queued VODs one after another until none are left.
async function drainQueue() {
  setState({ running: true });
  try {
    while (pending.length) {
      const next = pending.shift()!;
      updateQueueItem(next.id, { status: 'running', message: 'Importing…' });
      const input = next.runCountAtQueue === state.runCount ? next.input : await withLatestData(next.input, next.deps);
      // runOneImport reports its own failures; this only guards the queue against an unexpected throw.
      const completed = await runOneImport(input, next.deps).catch(() => false);
      updateQueueItem(next.id, { status: completed ? 'done' : 'error', message: state.message, games: [...state.batchResult] });
      next.resolve(completed);
    }
  } finally {
    setState({ running: false });
  }
}

// An earlier VOD in the queue may have created matches since this one was
// queued. Link against the saved data, not the snapshot taken when it was added.
async function withLatestData(input: VodBatchImportInput, deps: VodImportDeps): Promise<VodBatchImportInput> {
  try {
    const response = await deps.apiFetch('/api/data');
    if (!response.ok) return input;
    const latest = await response.json();
    return Array.isArray(latest?.matches) && Array.isArray(latest?.playerStats) ? { ...input, matches: latest.matches, playerStats: latest.playerStats } : input;
  } catch {
    return input;
  }
}

async function runOneImport(input: VodBatchImportInput, deps: VodImportDeps): Promise<boolean> {
  ensureProgressListener(deps);
  const { desktop } = deps; const chosenLocal = input.local; const chosenUrl = input.vodUrl;
  progressContext.gameIndex = 0; progressContext.totalGames = 1;
  setState({
    dismissed: false, batchResult: [], finishedAt: null, startedAt: new Date().toISOString(), sourceLabel: vodSourceLabel(input),
    message: chosenLocal ? 'Reading the retained local video and finding every game…' : 'Downloading once, then finding every completed match scoreboard…',
    progress: { owner: 'batch', step: 0, stepPercent: chosenLocal ? 100 : 0, message: chosenLocal ? 'Local video ready · download skipped.' : 'Preparing the VOD…', status: 'working' },
  });
  let cacheId = ''; let completed = false;
  const { roster: activeRoster, matches, playerStats, perspective, povPlayerName: selectedPovName } = input;
  try {
    const requestedGames = Math.max(1, Math.min(12, input.expectedGames || 1));
    const discovery = await desktop.discoverVodGames({ ...(chosenUrl ? { vodUrl: chosenUrl } : {}), expectedGames: requestedGames, mapNames: input.mapNames, ...(chosenLocal ? { localPath: chosenLocal.path } : {}) }); cacheId = discovery.cacheId; const normalizedVodUrl = discovery.vodUrl || chosenUrl;
    setProgress({ owner: 'batch', step: 2, stepPercent: 0, message: 'Reading detected scoreboard candidates…', status: 'working' });
    const detected: Array<{ timestampMs: number; draft: ScreenshotReviewDraft; imageSha256: string }> = [];
    const signatures = new Set<string>();
    for (let index = 0; index < discovery.games.length; index += 1) {
      setProgress({ owner: 'batch', step: 2, stepPercent: Math.round(index / Math.max(1, discovery.games.length) * 100), message: `Reading scoreboard candidate ${index + 1}/${discovery.games.length}…`, status: 'working' });
      try {
        const frame = await desktop.readVodFrame({ cacheId, frame: discovery.games[index].frame }); const image = fileFromBase64(frame.base64, `vod-scoreboard-${index + 1}.png`, frame.mediaType);
        const extracted = await deps.extractScoreboard(image, activeRoster, undefined, { trackJob: false });
        // With five roster matches our side is known, so an unreadable opponent name doesn't matter.
        // Otherwise every name must be read so the coach can pick our five.
        const unreadableName = extracted.draft.stats.some(row => String(row.extractedName || '').trim().length < 2);
        if (extracted.draft.stats.length !== 10 || (unreadableName && knownScoreboardRows(extracted.draft.stats, []).length !== 5) || extracted.draft.match.ourScore === null || extracted.draft.match.theirScore === null || !extracted.draft.match.map) continue;
        const signature = `${extracted.draft.match.map.toLocaleLowerCase()}:${extracted.draft.match.ourScore}:${extracted.draft.match.theirScore}:${extracted.draft.stats.map(row => `${row.matchedPlayerId || String(row.extractedName || '').toLocaleLowerCase('en')}:${row.kills}:${row.deaths}`).sort().join('|')}`;
        if (signatures.has(signature)) continue; signatures.add(signature); detected.push({ timestampMs: discovery.games[index].timestampMs, draft: extracted.draft, imageSha256: extracted.imageSha256 });
      } catch { /* Geometry and identity gates intentionally discard non-scoreboard candidates. */ }
    }
    detected.sort((left, right) => left.timestampMs - right.timestampMs);
    const dateKey = discovery.uploadDate || input.date;
    const imported: VodBatchGame[] = [];
    if (detected.length !== requestedGames) {
      const boundaries = discovery.boundaries || [];
      let unnamedGames = 0;
      if (boundaries.length !== requestedGames) throw new Error(`Expected ${requestedGames} game${requestedGames === 1 ? '' : 's'}, but found ${detected.length} complete scoreboard${detected.length === 1 ? '' : 's'} and ${boundaries.length} reliable game start${boundaries.length === 1 ? '' : 's'}. Nothing was imported; use the manual scoreboard workflow for the missing evidence.`);
      for (let index = 0; index < boundaries.length; index += 1) {
        const boundary = boundaries[index]; const mapName = boundary.map || 'Unknown map'; const rosterIds = new Set(activeRoster.map(player => player.id));
        const possibleMatches = matches.filter(candidate => candidate.date === dateKey && (!boundary.map || candidate.map?.toLocaleLowerCase() === boundary.map.toLocaleLowerCase()) && [...rosterIds].every(id => playerStats.some(stat => stat.matchId === candidate.id && stat.playerId === id)));
        // An empty roster proves nothing about which saved game this is, so it never links.
        const linked = rosterIds.size && possibleMatches.length === 1 ? possibleMatches[0] : null; const endMs = boundaries[index + 1]?.timestampMs || discovery.durationMs;
        progressContext.gameIndex = index; progressContext.totalGames = boundaries.length; setProgress({ owner: 'batch', step: 3, stepPercent: Math.round(index / boundaries.length * 100), message: `Analyzing game ${index + 1}/${boundaries.length} · ${mapName}…`, status: 'working' });
        // A channel/uploader name is not a player identity. Reuse opponent names
        // only when a linked scoreboard proved them; otherwise unknown opponents
        // remain unknown instead of being mislabeled as our team.
        const players = boundaryTimelinePlayers(activeRoster, linked);
        const evidence = await desktop.analyzeVod({ vodUrl: normalizedVodUrl, cacheId, startMs: boundary.timestampMs, endMs, players, observerMode: perspective === 'coach', ...(perspective === 'player' && selectedPovName ? { povPlayerName: selectedPovName } : {}) });
        const publicTimeline = stripRawText(evidence); const boundaryFrame = await desktop.readVodFrame({ cacheId, frame: boundary.frame }); const frame = fileFromBase64(boundaryFrame.base64, `vod-game-start-${index + 1}.png`, boundaryFrame.mediaType);
        setProgress({ owner: 'batch', step: 4, stepPercent: Math.round(index / boundaries.length * 100), message: `Saving game ${index + 1}/${boundaries.length}…`, status: 'working' }); const response = await deps.apiFetch('/api/vod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vodUrl: normalizedVodUrl, imageSha256: await sha256File(frame), ...(linked ? { matchId: linked.id } : {}), coachTeamEvidence: true, date: dateKey, map: boundary.map, opponent: linked?.opponent || null, ourScore: linked?.ourScore ?? null, theirScore: linked?.theirScore ?? null, players: [], timelineEvidence: publicTimeline }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Game ${index + 1} could not be integrated.`);
        const unnamed = players.length === 0; if (unnamed) unnamedGames += 1;
        imported.push({ map: mapName, score: linked && typeof linked.ourScore === 'number' ? `${linked.ourScore}–${linked.theirScore}` : 'Score pending', status: `${payload.submission.linkMode === 'new-match' ? 'Timeline imported · scoreboard pending' : 'Linked and timeline imported'}${unnamed ? ' · players not named yet' : ''}` });
        setState({ batchResult: [...imported] });
      }
      // On a fresh workspace nobody is on the roster yet; say what that leaves out instead of failing the import.
      const unnamedNote = unnamedGames ? ` No player names were known for ${unnamedGames === imported.length ? (imported.length === 1 ? 'this game' : 'these games') : `${unnamedGames} of them`}, so kills, deaths, trades and KAST are not credited to anyone yet. Players are added automatically from the end-of-game scoreboard when a VOD shows one; you can also add them under Roster and import this VOD again.` : '';
      setState({ message: `${imported.length} game${imported.length === 1 ? '' : 's'} separated and integrated. This VOD did not show complete post-match scoreboards, so unavailable totals remain pending instead of being guessed.${unnamedNote}`, progress: { owner: 'batch', step: 4, stepPercent: 100, message: `${imported.length} games saved successfully.`, status: 'done' } });
    } else {
      const addedPlayers = new Set<string>(); const oursThisRun: string[] = [];
      for (let index = 0; index < detected.length; index += 1) {
        const game = detected[index];
        // Five known names decide our side. Otherwise the coach ticks our five; position on the board proves nothing.
        const known = knownScoreboardRows(game.draft.stats, oursThisRun);
        let selected: number[] = known.length === 5 ? known : [];
        if (known.length !== 5) {
          setProgress({ owner: 'batch', step: 3, stepPercent: Math.round(index / detected.length * 100), message: `Waiting for you: tick your five players for game ${index + 1}/${detected.length} · ${game.draft.match.map}.`, status: 'working' });
          const answer = await askTeamPick({ game: index + 1, totalGames: detected.length, map: game.draft.match.map || 'Unknown map', score: `${game.draft.match.ourScore}–${game.draft.match.theirScore}`, rows: game.draft.stats.map((row, rowIndex) => ({ index: rowIndex, name: row.extractedName, agent: row.agent, kills: value(row.kills), deaths: value(row.deaths), assists: value(row.assists), known: known.includes(rowIndex) })) });
          if (answer === 'cancel') throw new Error('The import was cancelled while it waited for you to pick your players.');
          selected = answer || [];
        }
        const newPlayers = selected.some(rowIndex => !known.includes(rowIndex));
        const rows = selected.map(rowIndex => game.draft.stats[rowIndex]); oursThisRun.push(...rows.map(row => row.extractedName)); const rosterIds = new Set(rows.map(row => row.matchedPlayerId).filter(Boolean));
        const possibleMatches = matches.filter(candidate => candidate.date === dateKey && candidate.map?.toLocaleLowerCase() === game.draft.match.map?.toLocaleLowerCase() && candidate.ourScore === game.draft.match.ourScore && candidate.theirScore === game.draft.match.theirScore && [...rosterIds].every(id => playerStats.some(stat => stat.matchId === candidate.id && stat.playerId === id)));
        // A game with new players is not yet in any saved match, so it never links.
        const linked = selected.length && !newPlayers && possibleMatches.length === 1 ? possibleMatches[0] : null; const reliableBoundaries = discovery.boundaries?.length === detected.length ? discovery.boundaries : null;
        const startMs = reliableBoundaries?.[index]?.timestampMs ?? (index ? Math.min(game.timestampMs, detected[index - 1].timestampMs + 60_000) : 0); const endMs = reliableBoundaries?.[index + 1]?.timestampMs ?? game.timestampMs;
        progressContext.gameIndex = index; progressContext.totalGames = detected.length; setProgress({ owner: 'batch', step: 3, stepPercent: Math.round(index / detected.length * 100), message: `Analyzing game ${index + 1}/${detected.length} · ${game.draft.match.map}…`, status: 'working' });
        const ours = new Set(selected); const players = !selected.length ? [] : game.draft.stats.map((row, rowIndex) => ({ name: row.extractedName, team: ours.has(rowIndex) ? 'ours' as const : 'theirs' as const, expectedKills: row.kills, expectedDeaths: row.deaths })).filter(row => row.name).slice(0, 10);
        const evidence = await desktop.analyzeVod({ vodUrl: normalizedVodUrl, cacheId, startMs, endMs, players, observerMode: perspective === 'coach', ...(perspective === 'player' && selectedPovName ? { povPlayerName: selectedPovName } : {}) });
        const publicTimeline = stripRawText(evidence);
        setProgress({ owner: 'batch', step: 4, stepPercent: Math.round(index / detected.length * 100), message: `Saving game ${index + 1}/${detected.length}…`, status: 'working' }); const response = await deps.apiFetch('/api/vod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vodUrl: normalizedVodUrl, imageSha256: game.imageSha256, ...(linked ? { matchId: linked.id } : {}), coachTeamEvidence: true, ...(newPlayers ? { addObservedPlayers: true } : {}), date: dateKey, map: game.draft.match.map, opponent: linked?.opponent || null, ourScore: game.draft.match.ourScore, theirScore: game.draft.match.theirScore, players: rows.map(row => ({ observedName: row.extractedName, agent: row.agent, kills: value(row.kills), deaths: value(row.deaths), assists: value(row.assists), acs: value(row.acs), adr: value(row.adr), hs: value(row.hs), fk: value(row.fk), fd: value(row.fd), plants: value(row.plants), defuses: value(row.defuses), trades: value(row.trades) })), timelineEvidence: publicTimeline }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Game ${index + 1} could not be integrated.`);
        const added: string[] = payload.submission.integration?.addedPlayers || []; added.forEach(name => addedPlayers.add(name));
        imported.push({ map: game.draft.match.map, score: `${game.draft.match.ourScore}–${game.draft.match.theirScore}`, status: `${payload.submission.linkMode === 'new-match' ? 'New match created' : 'Linked to existing match'}${added.length ? ` · ${added.length} new player${added.length === 1 ? '' : 's'} added` : ''}${selected.length ? '' : ' · players not named'}` });
        setState({ batchResult: [...imported] });
      }
      const addedNote = addedPlayers.size ? ` ${addedPlayers.size} new player${addedPlayers.size === 1 ? ' was' : 's were'} added from the scoreboard names with their stats. They are tryouts under Roster: promote the ones you keep to core, and archive the rest (their matches stay).` : '';
      setState({ message: `${imported.length} game${imported.length === 1 ? '' : 's'} detected, analyzed, and integrated automatically.${addedNote}`, progress: { owner: 'batch', step: 4, stepPercent: 100, message: `${imported.length} games saved successfully.`, status: 'done' } });
    }
    completed = true;
    await Promise.resolve(input.onSaved?.()).catch(() => null);
  } catch (error: any) {
    const saved = state.batchResult.length;
    // Games saved before the failure stay saved; say so instead of implying nothing happened.
    const reason = `${error?.message || 'The multi-game VOD could not be integrated.'}${saved ? ` ${saved} game${saved === 1 ? ' was' : 's were'} already saved before it stopped.` : ''}`;
    setState({ message: reason, progress: { owner: 'batch', step: state.progress?.step ?? 0, stepPercent: state.progress?.stepPercent ?? null, message: reason, status: 'error' } });
    if (saved) await Promise.resolve(input.onSaved?.()).catch(() => null);
  } finally {
    if (cacheId) await desktop.releaseVodAnalysis({ cacheId, completed }).catch(() => null);
    setState({ finishedAt: new Date().toISOString(), runCount: state.runCount + 1 });
  }
  return completed;
}
