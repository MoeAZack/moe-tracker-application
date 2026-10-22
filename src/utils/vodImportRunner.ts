import { useSyncExternalStore } from 'react';
import type { ScreenshotReviewDraft, TrackerData } from '../types';
import { extractScoreboardLocally } from './localScoreboard';
import { apiFetch } from './api';

// The automatic multi-game VOD import used to run inside the VOD tab's React
// component, so switching tabs threw away its progress and the link to the
// running job. It now lives here, at module level, for the life of the window:
// leaving the tab neither stops the import nor hides its progress.

export type VodProgress = { owner: 'batch' | 'personal'; step: number; stepPercent: number | null; message: string; status: 'working' | 'ready' | 'done' | 'error' };
export type VodBatchGame = { map: string; score: string; status: string };
export type VodImportState = {
  running: boolean;
  progress: VodProgress | null;
  message: string;
  batchResult: VodBatchGame[];
  sourceLabel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  // Bumped once per finished run so views can reload their history.
  runCount: number;
  dismissed: boolean;
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
type Desktop = NonNullable<typeof window.moeDesktop>;
export type VodImportDeps = {
  desktop: Pick<Desktop, 'discoverVodGames' | 'readVodFrame' | 'analyzeVod' | 'releaseVodAnalysis' | 'cancelVodAnalysis'> & Partial<Pick<Desktop, 'onVodAnalysisProgress'>>;
  apiFetch: typeof apiFetch;
  extractScoreboard: typeof extractScoreboardLocally;
};

const initialState = (): VodImportState => ({ running: false, progress: null, message: '', batchResult: [], sourceLabel: null, startedAt: null, finishedAt: null, runCount: 0, dismissed: false });
let state: VodImportState = initialState();
const listeners = new Set<() => void>();
const progressContext = { gameIndex: 0, totalGames: 1 };
let progressUnsubscribe: (() => void) | null = null;

const setState = (patch: Partial<VodImportState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
const setProgress = (progress: VodProgress) => setState({ progress });

export const vodImportStore = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  dismiss: () => { if (!state.running) setState({ dismissed: true }); },
  reset: () => { progressUnsubscribe?.(); progressUnsubscribe = null; state = initialState(); for (const listener of listeners) listener(); },
};
export const useVodImportState = () => useSyncExternalStore(vodImportStore.subscribe, vodImportStore.getSnapshot, vodImportStore.getSnapshot);

const value = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : null;
const fileFromBase64 = (base64: string, name: string, type: string) => {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
};
const sha256File = async (file: File) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(item => item.toString(16).padStart(2, '0')).join('');
const stripRawText = (evidence: unknown) => JSON.parse(JSON.stringify(evidence, (key, item) => key === 'rawText' ? undefined : item));

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
  const result = await deps.desktop.cancelVodAnalysis().catch(() => null);
  if (result?.cancelled && state.progress) setProgress({ ...state.progress, message: 'Cancelling safely…' });
  return !!result?.cancelled;
};

/** Starts the multi-game import unless one is already running. Resolves when it ends; never rejects. */
export async function startVodBatchImport(input: VodBatchImportInput, deps: VodImportDeps | null = defaultDeps()): Promise<boolean> {
  if (!deps || state.running || (!input.vodUrl && !input.local)) return false;
  ensureProgressListener(deps);
  const { desktop } = deps; const chosenLocal = input.local; const chosenUrl = input.vodUrl;
  progressContext.gameIndex = 0; progressContext.totalGames = 1;
  setState({
    running: true, dismissed: false, batchResult: [], finishedAt: null, startedAt: new Date().toISOString(), sourceLabel: chosenLocal?.name || chosenUrl,
    message: chosenLocal ? 'Reading the retained local video and finding every game…' : 'Downloading once, then finding every completed match scoreboard…',
    progress: { owner: 'batch', step: 0, stepPercent: chosenLocal ? 100 : 0, message: chosenLocal ? 'Local video ready · download skipped.' : 'Preparing the VOD…', status: 'working' },
  });
  let cacheId = ''; let completed = false;
  const { roster: activeRoster, matches, playerStats, perspective, povPlayerName: selectedPovName } = input;
  try {
    const requestedGames = Math.max(1, Math.min(12, input.expectedGames || 1));
    const discovery = await desktop.discoverVodGames({ ...(chosenUrl ? { vodUrl: chosenUrl } : {}), expectedGames: requestedGames, mapNames: input.mapNames, ...(chosenLocal ? { localPath: chosenLocal.path } : {}) }); cacheId = discovery.cacheId; const normalizedVodUrl = discovery.vodUrl || chosenUrl;
    setProgress({ owner: 'batch', step: 2, stepPercent: 0, message: 'Reading detected scoreboard candidates…', status: 'working' });
    const detected: Array<{ timestampMs: number; draft: ScreenshotReviewDraft; imageSha256: string; selected: number[] }> = [];
    const signatures = new Set<string>();
    for (let index = 0; index < discovery.games.length; index += 1) {
      setProgress({ owner: 'batch', step: 2, stepPercent: Math.round(index / Math.max(1, discovery.games.length) * 100), message: `Reading scoreboard candidate ${index + 1}/${discovery.games.length}…`, status: 'working' });
      try {
        const frame = await desktop.readVodFrame({ cacheId, frame: discovery.games[index].frame }); const image = fileFromBase64(frame.base64, `vod-scoreboard-${index + 1}.png`, frame.mediaType);
        const extracted = await deps.extractScoreboard(image, activeRoster, undefined, { trackJob: false }); const selected = extracted.draft.stats.map((row, rowIndex) => row.rosterMatch.status === 'matched' ? rowIndex : -1).filter(rowIndex => rowIndex >= 0);
        if (selected.length !== 5 || extracted.draft.stats.length !== 10 || extracted.draft.match.ourScore === null || extracted.draft.match.theirScore === null || !extracted.draft.match.map) continue;
        const signature = `${extracted.draft.match.map.toLocaleLowerCase()}:${extracted.draft.match.ourScore}:${extracted.draft.match.theirScore}:${selected.map(rowIndex => `${extracted.draft.stats[rowIndex].matchedPlayerId}:${extracted.draft.stats[rowIndex].kills}:${extracted.draft.stats[rowIndex].deaths}`).sort().join('|')}`;
        if (signatures.has(signature)) continue; signatures.add(signature); detected.push({ timestampMs: discovery.games[index].timestampMs, draft: extracted.draft, imageSha256: extracted.imageSha256, selected });
      } catch { /* Geometry and identity gates intentionally discard non-scoreboard candidates. */ }
    }
    detected.sort((left, right) => left.timestampMs - right.timestampMs);
    const dateKey = discovery.uploadDate || input.date;
    const imported: VodBatchGame[] = [];
    if (detected.length !== requestedGames) {
      const boundaries = discovery.boundaries || [];
      if (boundaries.length !== requestedGames) throw new Error(`Expected ${requestedGames} game${requestedGames === 1 ? '' : 's'}, but found ${detected.length} complete scoreboard${detected.length === 1 ? '' : 's'} and ${boundaries.length} reliable game start${boundaries.length === 1 ? '' : 's'}. Nothing was imported; use the manual scoreboard workflow for the missing evidence.`);
      for (let index = 0; index < boundaries.length; index += 1) {
        const boundary = boundaries[index]; const mapName = boundary.map || 'Unknown map'; const rosterIds = new Set(activeRoster.map(player => player.id));
        const possibleMatches = matches.filter(candidate => candidate.date === dateKey && (!boundary.map || candidate.map?.toLocaleLowerCase() === boundary.map.toLocaleLowerCase()) && [...rosterIds].every(id => playerStats.some(stat => stat.matchId === candidate.id && stat.playerId === id)));
        const linked = possibleMatches.length === 1 ? possibleMatches[0] : null; const endMs = boundaries[index + 1]?.timestampMs || discovery.durationMs;
        progressContext.gameIndex = index; progressContext.totalGames = boundaries.length; setProgress({ owner: 'batch', step: 3, stepPercent: Math.round(index / boundaries.length * 100), message: `Analyzing game ${index + 1}/${boundaries.length} · ${mapName}…`, status: 'working' });
        // A channel/uploader name is not a player identity. Reuse opponent names
        // only when a linked scoreboard proved them; otherwise unknown opponents
        // remain unknown instead of being mislabeled as our team.
        const players = boundaryTimelinePlayers(activeRoster, linked);
        const evidence = await desktop.analyzeVod({ vodUrl: normalizedVodUrl, cacheId, startMs: boundary.timestampMs, endMs, players, observerMode: perspective === 'coach', ...(perspective === 'player' && selectedPovName ? { povPlayerName: selectedPovName } : {}) });
        const publicTimeline = stripRawText(evidence); const boundaryFrame = await desktop.readVodFrame({ cacheId, frame: boundary.frame }); const frame = fileFromBase64(boundaryFrame.base64, `vod-game-start-${index + 1}.png`, boundaryFrame.mediaType);
        setProgress({ owner: 'batch', step: 4, stepPercent: Math.round(index / boundaries.length * 100), message: `Saving game ${index + 1}/${boundaries.length}…`, status: 'working' }); const response = await deps.apiFetch('/api/vod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vodUrl: normalizedVodUrl, imageSha256: await sha256File(frame), ...(linked ? { matchId: linked.id } : {}), coachTeamEvidence: true, date: dateKey, map: boundary.map, opponent: linked?.opponent || null, ourScore: linked?.ourScore ?? null, theirScore: linked?.theirScore ?? null, players: [], timelineEvidence: publicTimeline }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Game ${index + 1} could not be integrated.`);
        imported.push({ map: mapName, score: linked && typeof linked.ourScore === 'number' ? `${linked.ourScore}–${linked.theirScore}` : 'Score pending', status: payload.submission.linkMode === 'new-match' ? 'Timeline imported · scoreboard pending' : 'Linked and timeline imported' });
        setState({ batchResult: [...imported] });
      }
      setState({ message: `${imported.length} game${imported.length === 1 ? '' : 's'} separated and integrated. This VOD did not show complete post-match scoreboards, so unavailable totals remain pending instead of being guessed.`, progress: { owner: 'batch', step: 4, stepPercent: 100, message: `${imported.length} games saved successfully.`, status: 'done' } });
    } else {
      for (let index = 0; index < detected.length; index += 1) {
        const game = detected[index]; const rows = game.selected.map(rowIndex => game.draft.stats[rowIndex]); const rosterIds = new Set(rows.map(row => row.matchedPlayerId).filter(Boolean));
        const possibleMatches = matches.filter(candidate => candidate.date === dateKey && candidate.map?.toLocaleLowerCase() === game.draft.match.map?.toLocaleLowerCase() && candidate.ourScore === game.draft.match.ourScore && candidate.theirScore === game.draft.match.theirScore && [...rosterIds].every(id => playerStats.some(stat => stat.matchId === candidate.id && stat.playerId === id)));
        const linked = possibleMatches.length === 1 ? possibleMatches[0] : null; const reliableBoundaries = discovery.boundaries?.length === detected.length ? discovery.boundaries : null;
        const startMs = reliableBoundaries?.[index]?.timestampMs ?? (index ? Math.min(game.timestampMs, detected[index - 1].timestampMs + 60_000) : 0); const endMs = reliableBoundaries?.[index + 1]?.timestampMs ?? game.timestampMs;
        progressContext.gameIndex = index; progressContext.totalGames = detected.length; setProgress({ owner: 'batch', step: 3, stepPercent: Math.round(index / detected.length * 100), message: `Analyzing game ${index + 1}/${detected.length} · ${game.draft.match.map}…`, status: 'working' });
        const ours = new Set(game.selected); const players = game.draft.stats.map((row, rowIndex) => ({ name: row.extractedName, team: ours.has(rowIndex) ? 'ours' as const : 'theirs' as const, expectedKills: row.kills, expectedDeaths: row.deaths })).filter(row => row.name).slice(0, 10);
        const evidence = await desktop.analyzeVod({ vodUrl: normalizedVodUrl, cacheId, startMs, endMs, players, observerMode: perspective === 'coach', ...(perspective === 'player' && selectedPovName ? { povPlayerName: selectedPovName } : {}) });
        const publicTimeline = stripRawText(evidence);
        setProgress({ owner: 'batch', step: 4, stepPercent: Math.round(index / detected.length * 100), message: `Saving game ${index + 1}/${detected.length}…`, status: 'working' }); const response = await deps.apiFetch('/api/vod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vodUrl: normalizedVodUrl, imageSha256: game.imageSha256, ...(linked ? { matchId: linked.id } : {}), coachTeamEvidence: true, date: dateKey, map: game.draft.match.map, opponent: linked?.opponent || null, ourScore: game.draft.match.ourScore, theirScore: game.draft.match.theirScore, players: rows.map(row => ({ observedName: row.extractedName, agent: row.agent, kills: value(row.kills), deaths: value(row.deaths), assists: value(row.assists), acs: value(row.acs), adr: value(row.adr), hs: value(row.hs), fk: value(row.fk), fd: value(row.fd), plants: value(row.plants), defuses: value(row.defuses), trades: value(row.trades) })), timelineEvidence: publicTimeline }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Game ${index + 1} could not be integrated.`);
        imported.push({ map: game.draft.match.map, score: `${game.draft.match.ourScore}–${game.draft.match.theirScore}`, status: payload.submission.linkMode === 'new-match' ? 'New match created' : 'Linked to existing match' });
        setState({ batchResult: [...imported] });
      }
      setState({ message: `${imported.length} game${imported.length === 1 ? '' : 's'} detected, analyzed, and integrated automatically.`, progress: { owner: 'batch', step: 4, stepPercent: 100, message: `${imported.length} games saved successfully.`, status: 'done' } });
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
    setState({ running: false, finishedAt: new Date().toISOString(), runCount: state.runCount + 1 });
  }
  return completed;
}
