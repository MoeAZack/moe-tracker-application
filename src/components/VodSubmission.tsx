import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Film, ListPlus, LoaderCircle, Square, Upload, Users } from 'lucide-react';
import type { ScreenshotReviewDraft, TrackerData, VodSubmission as VodSubmissionRecord, VodTimelineEvidence } from '../types';
import { extractScoreboardLocally } from '../utils/localScoreboard';
import { apiFetch } from '../utils/api';
import { cairoDateKeyAt } from '../../lib/uiIntegration';
import {
  VOD_STEPS,
  cancelVodImport,
  vodImportStore,
  clampPercent,
  overallVodPercent,
  splitVodLinks,
  startVodBatchImport,
  useVodImportState,
  type VodProgress,
} from '../utils/vodImportRunner';
import { activeResourceNames } from '../../lib/resourceCatalog';
import VodImportQueue from './VodImportQueue';
import VodGameCard from './VodGameCard';
import { clearableJob, ingestionClearMessage } from '../utils/ingestionHistory';
import { confirmDialog, notify } from '../utils/appDialogs';

export { boundaryTimelinePlayers } from '../utils/vodImportRunner';

type Props = { data: TrackerData; role: string | null; onRefresh: () => Promise<void> | void };

function VodProgressPanel({ progress, onCancel }: { progress: VodProgress; onCancel?: () => void }) {
  const overall = overallVodPercent(progress);
  const accent = progress.status === 'error' ? 'bg-rose-400' : progress.status === 'done' || progress.status === 'ready' ? 'bg-emerald-300' : 'bg-cyan-300';
  return (
    <div className="mt-4 rounded-xl border border-cyan-300/15 bg-cyan-300/5 p-4 text-xs text-cyan-100" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {progress.status === 'error'
            ? 'VOD import stopped'
            : progress.status === 'done'
              ? 'VOD import complete'
              : progress.status === 'ready'
                ? `Stage ${progress.step + 1} complete · ready for the next step`
                : `Stage ${progress.step + 1} of ${VOD_STEPS.length} · ${VOD_STEPS[progress.step]}`}
        </span>
        <span className="font-mono">Overall {overall}%</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-black/30"
        role="progressbar"
        aria-label="Overall VOD import progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overall}
      >
        <div className={`h-full ${accent} transition-[width] duration-300`} style={{ width: `${overall}%` }} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-5">
        {VOD_STEPS.map((label, index) => {
          const completed = progress.status === 'done' || index < progress.step;
          const active = index === progress.step;
          return (
            <div
              key={label}
              className={`rounded-lg border px-2 py-2 ${completed ? 'border-emerald-300/20 bg-emerald-300/5 text-emerald-200' : active ? 'border-cyan-300/25 bg-cyan-300/5 text-cyan-100' : 'border-white/5 text-slate-500'}`}
            >
              <div className="flex items-center gap-1.5">
                <span>{completed ? '✓' : index + 1}</span>
                <span>{label}</span>
              </div>
              {active && progress.status === 'working' && progress.stepPercent !== null && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/30">
                  <div className="h-full bg-cyan-300 transition-[width] duration-300" style={{ width: `${clampPercent(progress.stepPercent)}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className={progress.status === 'error' ? 'text-rose-200' : 'text-slate-300'}>
          {progress.detail ? `${progress.detail} · ` : ''}
          {progress.message}
        </span>
        {onCancel && progress.status === 'working' && (
          <button type="button" onClick={onCancel} className="ui-button min-h-9 px-3 text-xs">
            <Square className="h-3.5 w-3.5" />
            Cancel safely
          </button>
        )}
      </div>
    </div>
  );
}
const value = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) ? input : null);
export default function VodSubmission({ data, role, onRefresh }: Props) {
  const [history, setHistory] = useState<VodSubmissionRecord[]>([]);
  const [vodUrl, setVodUrl] = useState('');
  const [matchId, setMatchId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [date, setDate] = useState(cairoDateKeyAt());
  const [map, setMap] = useState('');
  const [opponent, setOpponent] = useState('');
  const [draft, setDraft] = useState<ScreenshotReviewDraft | null>(null);
  const [imageSha256, setImageSha256] = useState('');
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [localVod, setLocalVod] = useState<{ path: string; name: string } | null>(null);
  const [timelineEvidence, setTimelineEvidence] = useState<VodTimelineEvidence | null>(null);
  const [timelineProgress, setTimelineProgress] = useState<VodProgress | null>(null);
  const [fullTimeline, setFullTimeline] = useState(true);
  const [povName, setPovName] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [expectedGames, setExpectedGames] = useState('1');
  const [vodPerspective, setVodPerspective] = useState<'coach' | 'player'>('coach');
  const [vodPovPlayerId, setVodPovPlayerId] = useState('');
  const importState = useVodImportState();
  const [vodJobs, setVodJobs] = useState<Awaited<ReturnType<NonNullable<typeof window.moeDesktop>['listVodJobs']>>>([]);
  const [screenshotJobId, setScreenshotJobId] = useState('');
  const activeRoster = useMemo(() => {
    const coreIds = new Set((data.coreMemberships || []).filter(member => !member.endedAt).map(member => member.playerId));
    return (data.rosterPlayers || []).filter(player => !player.retiredAt).map(player => ({ ...player, isCore: coreIds.has(player.id) }));
  }, [data.rosterPlayers, data.coreMemberships]);
  // A fresh workspace has nobody on the roster: the POV player's in-game name can be typed instead.
  const [vodPovTypedName, setVodPovTypedName] = useState('');
  const vodPovName = activeRoster.find(player => player.id === vodPovPlayerId)?.displayName || vodPovTypedName.trim() || null;
  const matches = useMemo(() => [...(data.matches || [])].sort((a, b) => `${b.date}:${b.id}`.localeCompare(`${a.date}:${a.id}`)), [data.matches]);
  const chosenMatch = matches.find(match => match.id === matchId);
  const queuedLinkCount = localVod ? 1 : splitVodLinks(vodUrl).length;

  const load = async () => {
    const response = await apiFetch('/api/vod-submissions');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'VOD submissions could not be loaded.');
    setHistory(payload.submissions || []);
  };
  useEffect(() => {
    void load().catch(error => setMessage(error.message));
  }, []);
  useEffect(() => {
    const refresh = () =>
      window.moeDesktop
        ?.listIngestionJobs()
        .then(value => setVodJobs(value as any))
        .catch(() =>
          window.moeDesktop
            ?.listVodJobs()
            .then(setVodJobs)
            .catch(() => {}),
        );
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!importState.runCount) return;
    void load().catch(() => null);
  }, [importState.runCount]);
  // Personal-flow progress only; the automatic import has its own window-level listener in vodImportRunner.
  useEffect(
    () =>
      window.moeDesktop?.onVodAnalysisProgress(progress => {
        if (vodImportStore.getSnapshot().running) return;
        const raw = progress.percent === null ? null : clampPercent(progress.percent);
        const step = progress.stage === 'download' ? 0 : progress.stage === 'discover' ? 1 : 3;
        setTimelineProgress({ owner: 'personal', step, stepPercent: raw, message: progress.message, status: 'working' });
      }),
    [],
  );

  const readImage = async (file?: File) => {
    if (!file) return;
    setBusy('ocr');
    setMessage('Reading the scoreboard locally…');
    setDraft(null);
    setTimelineProgress({ owner: 'personal', step: 2, stepPercent: 5, message: 'Reading the selected scoreboard locally…', status: 'working' });
    try {
      const result = await extractScoreboardLocally(file, activeRoster);
      setScreenshotJobId(result.ingestionJobId || '');
      setDraft(result.draft);
      setImageSha256(result.imageSha256);
      const matched = result.draft.stats.map((row, index) => (row.rosterMatch.status === 'matched' ? index : -1)).filter(index => index >= 0);
      setSelectedRows(matched.length === 5 ? matched : []);
      if (matched.length === 5) setPovName(result.draft.stats[matched[0]]?.extractedName || '');
      if (!map && result.draft.match.map) setMap(result.draft.match.map);
      const readyMessage =
        matched.length === 5
          ? 'Five roster identities were found automatically. Review and submit.'
          : 'Choose the five team rows. All five names must match active roster identities.';
      setMessage(readyMessage);
      setTimelineProgress({ owner: 'personal', step: 2, stepPercent: 100, message: 'Scoreboard reading complete.', status: 'ready' });
    } catch (error: any) {
      const reason = error.message || 'The image could not be read.';
      setMessage(reason);
      setTimelineProgress({ owner: 'personal', step: 2, stepPercent: null, message: reason, status: 'error' });
    } finally {
      setBusy('');
    }
  };

  const toggle = (index: number) =>
    setSelectedRows(current => (current.includes(index) ? current.filter(item => item !== index) : current.length < 5 ? [...current, index] : current));
  const chooseLocalVod = async () => {
    const selected = await window.moeDesktop?.chooseVodFile();
    if (!selected || selected.canceled || !selected.path) return;
    setLocalVod({ path: selected.path, name: selected.name || 'Local VOD' });
    setTimelineEvidence(null);
    setMessage('Local VOD selected. It will be scanned when you integrate the evidence.');
  };
  const analyzeTimeline = async () => {
    if (!draft || selectedRows.length !== 5 || !window.moeDesktop) return null;
    setBusy('timeline');
    setTimelineProgress({ owner: 'personal', step: 3, stepPercent: 0, message: 'Starting the local timeline scan…', status: 'working' });
    const our = new Set(selectedRows);
    const players = draft.stats
      .map((row, index) => ({
        name: row.extractedName,
        team: our.has(index) ? ('ours' as const) : ('theirs' as const),
        expectedKills: row.kills,
        expectedDeaths: row.deaths,
      }))
      .filter(row => row.name)
      .slice(0, 10);
    const evidence = await window.moeDesktop.analyzeVod({
      vodUrl: vodUrl.trim(),
      ...(localVod ? { localPath: localVod.path } : {}),
      players,
      povPlayerName: povName || undefined,
    });
    setTimelineEvidence(evidence);
    return evidence as VodTimelineEvidence;
  };
  const cancelTimeline = async () => {
    const result = await window.moeDesktop?.cancelVodAnalysis();
    if (result?.cancelled) setTimelineProgress(current => (current ? { ...current, message: 'Cancelling safely…' } : current));
  };
  // Clears job-history entries only; matches, evidence and videos stay.
  const clearJobHistory = async (ids?: string[]) => {
    const desktop = window.moeDesktop; if (!desktop?.clearIngestionJobs) return;
    const targets = ids ? vodJobs.filter(job => ids.includes(job.id)) : vodJobs;
    if (!targets.some(clearableJob) || !(await confirmDialog(ingestionClearMessage(targets), { confirmLabel: 'Clear' }))) return;
    try {
      await desktop.clearIngestionJobs(ids);
      setVodJobs((await desktop.listIngestionJobs()) as any);
    } catch (error: any) { notify(error?.message || 'The job history could not be cleared.', 'error'); }
  };
  const restartVodJob = async (jobId: string) => {
    if (!window.moeDesktop) return;
    try {
      const source = await window.moeDesktop.resumeVodJob(jobId);
      setLocalVod({ path: source.path, name: source.name });
      setExpectedGames(String(source.expectedGames));
      if (source.vodUrl) setVodUrl(source.vodUrl);
      await autoImportAllGames(source);
    } catch (error: any) {
      setMessage(error.message || 'The retained VOD could not be restarted.');
    }
  };
  const autoImportAllGames = async (sourceOverride?: { path: string; name: string; expectedGames?: number; vodUrl?: string }) => {
    const chosenLocal = sourceOverride ? { path: sourceOverride.path, name: sourceOverride.name } : localVod;
    // A local video takes the typed link as its source link; without one, every pasted link is its own VOD.
    const links = sourceOverride ? [sourceOverride.vodUrl ?? ''] : chosenLocal ? [vodUrl.trim()] : splitVodLinks(vodUrl);
    if (!window.moeDesktop || (!links.some(Boolean) && !chosenLocal) || role !== 'coach' || (vodPerspective === 'player' && !vodPovName)) return;
    const shared = {
      expectedGames: sourceOverride?.expectedGames || Number.parseInt(expectedGames, 10) || 1,
      date,
      perspective: vodPerspective,
      povPlayerName: vodPovName,
      mapNames: activeResourceNames(data, 'map'),
      roster: activeRoster,
      matches,
      playerStats: data.playerStats,
      onSaved: onRefresh,
    };
    // The runner owns the queue so imports keep going, with visible progress, after this tab unmounts.
    const runs = links.map(link => startVodBatchImport({ ...shared, vodUrl: link, local: chosenLocal }));
    if (!sourceOverride) {
      setVodUrl('');
      setLocalVod(null);
    }
    await Promise.all(runs);
  };
  const submit = async () => {
    if (!draft || selectedRows.length !== 5 || (!vodUrl.trim() && !localVod)) return;
    const rows = selectedRows.map(index => draft.stats[index]);
    const selectedMatch = matches.find(match => match.id === matchId);
    try {
      let analyzed = timelineEvidence;
      if (fullTimeline && window.moeDesktop && !analyzed) analyzed = await analyzeTimeline();
      setBusy('submit');
      setMessage('Matching the five identities and integrating scoreboard and timeline evidence…');
      setTimelineProgress({ owner: 'personal', step: 4, stepPercent: 20, message: 'Matching identities and saving evidence…', status: 'working' });
      const publicTimeline = analyzed ? JSON.parse(JSON.stringify(analyzed, (key, item) => (key === 'rawText' ? undefined : item))) : null;
      const sourceUrl = vodUrl.trim() || (analyzed?.source.sha256 ? `moetracker-local://sha256/${analyzed.source.sha256}` : '');
      if (!sourceUrl) throw new Error('Analyze the selected local VOD before integrating it.');
      const response = await apiFetch('/api/vod-submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          vodUrl: sourceUrl,
          imageSha256,
          ...(matchId ? { matchId } : {}),
          ...(role === 'coach' && playerId ? { playerId } : {}),
          date: selectedMatch?.date || date,
          map: selectedMatch?.map || draft.match.map || map || null,
          opponent: selectedMatch?.opponent || opponent || null,
          ourScore: selectedMatch?.ourScore ?? draft.match.ourScore ?? null,
          theirScore: selectedMatch?.theirScore ?? draft.match.theirScore ?? null,
          players: rows.map(row => ({
            observedName: row.extractedName,
            agent: row.agent,
            kills: value(row.kills),
            deaths: value(row.deaths),
            assists: value(row.assists),
            acs: value(row.acs),
            adr: value(row.adr),
            hs: value(row.hs),
            fk: value(row.fk),
            fd: value(row.fd),
            plants: value(row.plants),
            defuses: value(row.defuses),
            trades: value(row.trades),
          })),
          timelineEvidence: publicTimeline,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'The VOD could not be integrated.');
      const integrated = payload.submission as VodSubmissionRecord;
      setMessage(
        `${integrated.linkMode === 'new-match' ? 'New match created' : 'Existing match linked'} · ${integrated.integration.createdStats} player rows added · ${integrated.integration.filledFields} missing fields filled.`,
      );
      setTimelineProgress({ owner: 'personal', step: 4, stepPercent: 100, message: 'VOD evidence integrated successfully.', status: 'done' });
      if (screenshotJobId)
        await window.moeDesktop
          ?.updateIngestionJob({ id: screenshotJobId, status: 'completed', stage: 'integrated', percent: 100, message: 'Scoreboard evidence integrated.' })
          .catch(() => null);
      setVodUrl('');
      setDraft(null);
      setImageSha256('');
      setSelectedRows([]);
      setLocalVod(null);
      setTimelineEvidence(null);
      await Promise.all([load(), Promise.resolve(onRefresh())]);
    } catch (error: any) {
      const reason = error.message || 'The VOD could not be integrated.';
      setMessage(reason);
      setTimelineProgress(current => ({
        owner: 'personal',
        step: current?.step ?? 4,
        stepPercent: current?.stepPercent ?? null,
        message: reason,
        status: 'error',
      }));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-5">
      {role === 'coach' && window.moeDesktop && (
        <section className="rounded-2xl border border-violet-300/20 bg-violet-300/[0.04] p-5">
          <div className="flex items-start gap-3">
            <Film className="mt-0.5 h-5 w-5 text-violet-300" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Automatic multi-match VOD import</p>
              <h1 className="mt-1 text-xl font-semibold">Paste a link or choose a video file</h1>
              <p className="mt-1 max-w-3xl text-xs text-slate-400">
                Use a YouTube link or a downloaded MP4, MKV, MOV, WebM, AVI, or M4V. Moe Tracker reads the source once, splits every game, and links available
                evidence. Choose the viewpoint so personal HUD data is interpreted correctly.
              </p>
            </div>
          </div>
          <div className="mt-4 flex w-fit rounded-lg border border-white/10 bg-black/15 p-1">
            <button
              type="button"
              aria-pressed={vodPerspective === 'coach'}
              onClick={() => setVodPerspective('coach')}
              className={`rounded-md px-4 py-2 text-xs font-semibold ${vodPerspective === 'coach' ? 'bg-violet-300 text-slate-950' : 'text-slate-300'}`}
            >
              Coach POV
            </button>
            <button
              type="button"
              aria-pressed={vodPerspective === 'player'}
              onClick={() => setVodPerspective('player')}
              className={`rounded-md px-4 py-2 text-xs font-semibold ${vodPerspective === 'player' ? 'bg-violet-300 text-slate-950' : 'text-slate-300'}`}
            >
              Player POV
            </button>
          </div>
          {vodPerspective === 'player' && (
            <label className="mt-3 block max-w-sm text-xs uppercase tracking-wider text-slate-400">
              Whose POV?
              <select
                value={vodPovPlayerId}
                onChange={event => { setVodPovPlayerId(event.target.value); if (event.target.value) setVodPovTypedName(''); }}
                className="ui-field mt-1 min-h-11 w-full px-3 text-sm normal-case"
              >
                <option value="">Choose the player</option>
                {activeRoster.map(player => (
                  <option key={player.id} value={player.id}>
                    {player.displayName}
                  </option>
                ))}
              </select>
              <input
                value={vodPovTypedName}
                onChange={event => { setVodPovTypedName(event.target.value); if (event.target.value.trim()) setVodPovPlayerId(''); }}
                placeholder={activeRoster.length ? 'Or type their in-game name' : 'Their in-game name'}
                aria-label="POV player's in-game name"
                maxLength={40}
                className="ui-field mt-2 min-h-11 w-full px-3 text-sm normal-case"
              />
            </label>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_110px_auto]">
            <textarea
              aria-label="VOD links, one per line"
              rows={queuedLinkCount > 1 ? Math.min(5, queuedLinkCount) : 1}
              value={vodUrl}
              onChange={event => setVodUrl(event.target.value)}
              placeholder={localVod ? `Optional source link · using ${localVod.name}` : 'youtube.com/live/… · paste several links, one per line, to queue them'}
              className="ui-field min-h-11 resize-y px-3 py-2.5"
            />
            <button type="button" onClick={() => void chooseLocalVod()} disabled={!!busy} className="ui-button min-h-11 px-4 text-sm">
              <Upload className="h-4 w-4" />
              {localVod ? localVod.name : 'Choose local video'}
            </button>
            <label className="text-xs uppercase tracking-wider text-slate-400">
              Games in VOD
              <input
                aria-label="Games in VOD"
                type="number"
                min="1"
                max="12"
                step="1"
                value={expectedGames}
                onChange={event => setExpectedGames(event.target.value)}
                className="ui-field mt-1 min-h-8 w-full px-3 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={!!busy || (!vodUrl.trim() && !localVod) || (vodPerspective === 'player' && !vodPovName)}
              onClick={() => void autoImportAllGames()}
              className="ui-button ui-button-primary min-h-11 px-5 text-sm disabled:opacity-40"
            >
              {importState.running ? <ListPlus className="h-4 w-4" /> : <Film className="h-4 w-4" />}
              {importState.running ? (queuedLinkCount > 1 ? `Add ${queuedLinkCount} videos to the queue` : 'Add to the queue') : queuedLinkCount > 1 ? `Import ${queuedLinkCount} videos` : 'Detect and import all games'}
            </button>
          </div>
          {localVod && (
            <label className="mt-3 block max-w-xs text-xs uppercase tracking-wider text-slate-400">
              Match date for this local recording
              <input type="date" value={date} onChange={event => setDate(event.target.value)} className="ui-field mt-1 min-h-10 w-full px-3 text-sm" />
            </label>
          )}
          <p className="mt-2 text-xs text-slate-400">
            Several videos run one after another on this PC. Each video uses the games count and perspective above.
          </p>
          <VodImportQueue queue={importState.queue} />
          {importState.progress && (
            <VodProgressPanel progress={importState.progress} onCancel={importState.running ? () => void cancelVodImport() : undefined} />
          )}
          {!importState.running && importState.progress?.status === 'done' && importState.message && (
            <p role="status" className="mt-3 text-xs text-slate-300">
              {importState.message}
            </p>
          )}
          {importState.batchResult.length > 0 && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {importState.batchResult.map((game, index) => (
                <React.Fragment key={`${game.matchId || game.map}-${index}`}>
                  <VodGameCard game={game} index={index} mapNames={activeResourceNames(data, 'map')} apiFetch={apiFetch} onSaved={importState.running ? undefined : onRefresh} />
                </React.Fragment>
              ))}
            </div>
          )}
          {vodJobs.length > 0 && (
            <details className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3">
              <summary className="cursor-pointer text-xs font-semibold">Ingestion job history · {vodJobs.length}</summary>
              {window.moeDesktop?.clearIngestionJobs && vodJobs.some(clearableJob) && (
                <button type="button" onClick={() => void clearJobHistory()} className="ui-button mt-3 min-h-8 px-3 text-xs">
                  Clear history
                </button>
              )}
              <div className="mt-3 space-y-2">
                {vodJobs.slice(0, 8).map(job => (
                  <div key={job.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg border border-white/5 p-2 text-xs">
                    <span>
                      <strong className="block text-slate-200">{job.stage}</strong>
                      <span className="text-slate-500">
                        {job.source} · {job.message || job.status}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={job.status === 'failed' ? 'text-rose-300' : job.status === 'completed' ? 'text-emerald-300' : 'text-cyan-300'}>
                        {job.percent ?? 0}%{job.retainedSource ? ' · cached' : ''}
                      </span>
                      {job.resumable &&
                        (job.source === 'youtube-vod' || job.source === 'local-vod' || job.source === 'youtube' || job.source === 'local-file') && (
                          <button
                            type="button"
                            disabled={!!busy || importState.running}
                            onClick={() => void restartVodJob(job.id)}
                            className="ui-button min-h-7 px-2 text-xs"
                          >
                            Resume
                          </button>
                        )}
                      {window.moeDesktop?.clearIngestionJobs && clearableJob(job) && (
                        <button type="button" aria-label={`Remove ${job.stage} from the job history`} onClick={() => void clearJobHistory([job.id])} className="ui-button min-h-7 px-2 text-xs">
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}
      <section className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-5">
        <div className="flex items-start gap-3">
          <Film className="mt-0.5 h-5 w-5 text-cyan-300" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Player evidence</p>
            <h1 className="mt-1 text-xl font-semibold">Submit and analyze a personal VOD</h1>
            <p className="mt-1 max-w-3xl text-xs text-slate-400">
              Add a YouTube link or original video and one end-screen scoreboard frame. The desktop app scans the full timeline locally for kill-feed,
              objectives, trades, KAST, orb and ultimate evidence. Five roster names are required before anything is linked; missing or unreadable events remain
              unknown.
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <label className="text-xs text-slate-300">
            VOD link
            <input
              aria-label="VOD link"
              value={vodUrl}
              onChange={event => setVodUrl(event.target.value)}
              placeholder="YouTube, Twitch, Drive…"
              className="ui-field mt-1 min-h-11 w-full px-3"
            />
          </label>
          {role === 'coach' && (
            <label className="text-xs text-slate-300">
              Submitting player
              <select
                aria-label="Submitting player"
                value={playerId}
                onChange={event => setPlayerId(event.target.value)}
                className="ui-field mt-1 min-h-11 w-full px-3"
              >
                <option value="">Choose player</option>
                {activeRoster.map(player => (
                  <option key={player.id} value={player.id}>
                    {player.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs text-slate-300 lg:col-span-2">
            Match from screenshot / replay
            <select aria-label="Linked match" value={matchId} onChange={event => setMatchId(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3">
              <option value="">Not listed — create a new match section</option>
              {matches.map(match => (
                <option key={match.id} value={match.id}>
                  {match.date} · {match.opponent || 'Unknown opponent'} · {match.map || 'Unknown map'}
                  {typeof match.ourScore === 'number' ? ` · ${match.ourScore}–${match.theirScore}` : ''}
                </option>
              ))}
            </select>
          </label>
          {!chosenMatch && (
            <>
              <label className="text-xs text-slate-300">
                Match date
                <input type="date" value={date} onChange={event => setDate(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3" />
              </label>
              <label className="text-xs text-slate-300">
                Opponent
                <input
                  value={opponent}
                  onChange={event => setOpponent(event.target.value)}
                  className="ui-field mt-1 min-h-11 w-full px-3"
                  placeholder="Opponent if known"
                />
              </label>
              <label className="text-xs text-slate-300">
                Map
                <input
                  value={map}
                  onChange={event => setMap(event.target.value)}
                  className="ui-field mt-1 min-h-11 w-full px-3"
                  placeholder="Detected automatically when possible"
                />
              </label>
            </>
          )}
          <label className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300/25 bg-black/10 px-4 text-sm text-cyan-200 lg:col-span-2">
            <Upload className="h-4 w-4" />
            {busy === 'ocr' ? 'Reading locally…' : 'Choose scoreboard or clear VOD frame'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={!!busy}
              onChange={event => void readImage(event.target.files?.[0])}
            />
          </label>
          {window.moeDesktop && (
            <div className="lg:col-span-2 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void chooseLocalVod()} disabled={!!busy} className="ui-button min-h-11 px-4 text-sm">
                {localVod ? `Original video · ${localVod.name}` : 'Choose original video (recommended)'}
              </button>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-slate-300">
                <input type="checkbox" checked={fullTimeline} onChange={event => setFullTimeline(event.target.checked)} />
                Analyze the complete VOD timeline automatically
              </label>
            </div>
          )}
        </div>
        {draft && (
          <div className="mt-5 overflow-x-auto">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold">Select our five players</p>
              <span className={selectedRows.length === 5 ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>{selectedRows.length}/5 selected</span>
            </div>
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-2">Team</th>
                  <th className="p-2">Detected name</th>
                  <th className="p-2">Roster link</th>
                  <th className="p-2">Agent</th>
                  <th className="p-2">K / D / A</th>
                  <th className="p-2">ACS</th>
                  <th className="p-2">ADR</th>
                  <th className="p-2">HS</th>
                </tr>
              </thead>
              <tbody>
                {draft.stats.map((row, index) => (
                  <tr key={`${row.extractedName}-${index}`} className="border-t border-white/5">
                    <td className="p-2">
                      <input type="checkbox" aria-label={`Select ${row.extractedName}`} checked={selectedRows.includes(index)} onChange={() => toggle(index)} />
                    </td>
                    <td className="p-2 font-semibold">{row.extractedName || 'Unreadable'}</td>
                    <td className="p-2">{row.matchedPlayerName || (row.rosterMatch.status === 'ambiguous' ? 'Ambiguous' : 'Will fuzzy-match on submit')}</td>
                    <td className="p-2">{row.agent || '—'}</td>
                    <td className="p-2 font-mono">
                      {row.kills ?? '—'} / {row.deaths ?? '—'} / {row.assists ?? '—'}
                    </td>
                    <td className="p-2">{row.acs ?? '—'}</td>
                    <td className="p-2">{row.adr ?? '—'}</td>
                    <td className="p-2">{row.hs ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {draft && selectedRows.length === 5 && (
          <label className="mt-4 block text-xs text-slate-300">
            Player POV used for personal orb and ultimate evidence
            <select
              value={povName}
              onChange={event => {
                setPovName(event.target.value);
                setTimelineEvidence(null);
              }}
              className="ui-field mt-1 min-h-11 w-full px-3"
            >
              <option value="">Observer VOD / unknown POV</option>
              {selectedRows.map(index => (
                <option key={index} value={draft.stats[index].extractedName}>
                  {draft.stats[index].matchedPlayerName || draft.stats[index].extractedName}
                </option>
              ))}
            </select>
          </label>
        )}
        {timelineProgress?.owner === 'personal' && (
          <VodProgressPanel progress={timelineProgress} onCancel={busy === 'timeline' ? () => void cancelTimeline() : undefined} />
        )}
        {timelineEvidence && (
          <p className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">
            Timeline ready · {timelineEvidence.observations.length} supported observations · {timelineEvidence.coverage.resolvedEliminations} resolved
            eliminations · {timelineEvidence.coverage.inferredRoundGroups} covered round groups.
          </p>
        )}
        {message && (
          <p role="status" className="mt-4 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-slate-300">
            {message}
          </p>
        )}
        <button
          type="button"
          disabled={!!busy || importState.running || !draft || selectedRows.length !== 5 || (!vodUrl.trim() && !localVod) || (role === 'coach' && !playerId)}
          onClick={() => void submit()}
          className="ui-button ui-button-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-sm disabled:opacity-40"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {busy === 'timeline' ? 'Analyzing full timeline…' : busy === 'submit' ? 'Integrating evidence…' : 'Analyze and integrate VOD'}
        </button>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold">Submission history</h2>
        </div>
        <div className="mt-3 space-y-2">
          {history.map(item => (
            <article key={item.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {item.submittedByName} · {item.date} · {item.map || 'Unknown map'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Five names matched · {item.linkMode === 'new-match' ? 'new match created' : 'existing match linked'} · {item.integration.filledFields} gaps
                    filled{item.timelineEvidence ? ` · ${item.timelineEvidence.observations.length} timeline observations` : ' · scoreboard only'}
                  </p>
                  {item.timelineEvidence && (
                    <p className="mt-1 text-xs text-cyan-300">
                      Kill feed {item.timelineEvidence.coverage.signals.eliminations} · trades {item.timelineEvidence.coverage.signals.trades} · KAST{' '}
                      {item.timelineEvidence.coverage.signals.kast} · ults {item.timelineEvidence.coverage.signals.ultimateUse} · orbs{' '}
                      {item.timelineEvidence.coverage.signals.orbCapture}
                    </p>
                  )}
                </div>
                {/^https?:\/\//i.test(item.vodUrl) ? (
                  <a href={item.vodUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">
                    Open VOD
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">Local video</span>
                )}
              </div>
            </article>
          ))}
          {history.length === 0 && <p className="py-6 text-center text-xs text-slate-500">No VOD submissions yet.</p>}
        </div>
      </section>
    </div>
  );
}
