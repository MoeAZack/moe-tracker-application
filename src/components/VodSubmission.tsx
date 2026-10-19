import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Film, LoaderCircle, Square, Upload, Users } from 'lucide-react';
import type { ScreenshotReviewDraft, TrackerData, VodSubmission as VodSubmissionRecord, VodTimelineEvidence } from '../types';
import { extractScoreboardLocally } from '../utils/localScoreboard';
import { apiFetch } from '../utils/api';
import { cairoDateKeyAt } from '../../lib/uiIntegration';

type Props = { data: TrackerData; role: string | null; onRefresh: () => Promise<void> | void };
const value = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : null;
const fileFromBase64 = (base64: string, name: string, type: string) => {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
};

export default function VodSubmission({ data, role, onRefresh }: Props) {
  const [history, setHistory] = useState<VodSubmissionRecord[]>([]);
  const [vodUrl, setVodUrl] = useState(''); const [matchId, setMatchId] = useState(''); const [playerId, setPlayerId] = useState('');
  const [date, setDate] = useState(cairoDateKeyAt()); const [map, setMap] = useState(''); const [opponent, setOpponent] = useState('');
  const [draft, setDraft] = useState<ScreenshotReviewDraft | null>(null); const [imageSha256, setImageSha256] = useState(''); const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [localVod, setLocalVod] = useState<{ path: string; name: string } | null>(null); const [timelineEvidence, setTimelineEvidence] = useState<VodTimelineEvidence | null>(null); const [timelineProgress, setTimelineProgress] = useState<{ percent: number | null; message: string } | null>(null); const [fullTimeline, setFullTimeline] = useState(true); const [povName, setPovName] = useState('');
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const [batchResult, setBatchResult] = useState<Array<{ map: string; score: string; status: string }>>([]);
  const activeRoster = useMemo(() => (data.rosterPlayers || []).filter(player => !player.retiredAt), [data.rosterPlayers]);
  const matches = useMemo(() => [...(data.matches || [])].sort((a, b) => `${b.date}:${b.id}`.localeCompare(`${a.date}:${a.id}`)), [data.matches]);
  const chosenMatch = matches.find(match => match.id === matchId);

  const load = async () => { const response = await apiFetch('/api/vod-submissions'); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'VOD submissions could not be loaded.'); setHistory(payload.submissions || []); };
  useEffect(() => { void load().catch(error => setMessage(error.message)); }, []);
  useEffect(() => window.moeDesktop?.onVodAnalysisProgress(progress => setTimelineProgress({ percent: progress.percent, message: progress.message })), []);

  const readImage = async (file?: File) => {
    if (!file) return; setBusy('ocr'); setMessage('Reading the scoreboard locally…'); setDraft(null);
    try {
      const result = await extractScoreboardLocally(file, activeRoster);
      setDraft(result.draft); setImageSha256(result.imageSha256);
      const matched = result.draft.stats.map((row, index) => row.rosterMatch.status === 'matched' ? index : -1).filter(index => index >= 0);
      setSelectedRows(matched.length === 5 ? matched : []);
      if (matched.length === 5) setPovName(result.draft.stats[matched[0]]?.extractedName || '');
      if (!map && result.draft.match.map) setMap(result.draft.match.map);
      setMessage(matched.length === 5 ? 'Five roster identities were found automatically. Review and submit.' : 'Choose the five team rows. All five names must match active roster identities.');
    } catch (error: any) { setMessage(error.message || 'The image could not be read.'); } finally { setBusy(''); }
  };

  const toggle = (index: number) => setSelectedRows(current => current.includes(index) ? current.filter(item => item !== index) : current.length < 5 ? [...current, index] : current);
  const chooseLocalVod = async () => {
    const selected = await window.moeDesktop?.chooseVodFile(); if (!selected || selected.canceled || !selected.path) return;
    setLocalVod({ path: selected.path, name: selected.name || 'Local VOD' }); setTimelineEvidence(null); setMessage('Local VOD selected. It will be scanned when you integrate the evidence.');
  };
  const analyzeTimeline = async () => {
    if (!draft || selectedRows.length !== 5 || !window.moeDesktop) return null;
    setBusy('timeline'); setTimelineProgress({ percent: 0, message: 'Starting the local timeline scan…' });
    const our = new Set(selectedRows); const players = draft.stats.map((row, index) => ({ name: row.extractedName, team: our.has(index) ? 'ours' as const : 'theirs' as const, expectedKills: row.kills, expectedDeaths: row.deaths })).filter(row => row.name).slice(0, 10);
    const evidence = await window.moeDesktop.analyzeVod({ vodUrl: vodUrl.trim(), ...(localVod ? { localPath: localVod.path } : {}), players, povPlayerName: povName || undefined });
    setTimelineEvidence(evidence); return evidence as VodTimelineEvidence;
  };
  const cancelTimeline = async () => { const result = await window.moeDesktop?.cancelVodAnalysis(); if (result?.cancelled) setTimelineProgress(current => ({ percent: current?.percent ?? null, message: 'Cancelling safely…' })); };
  const autoImportAllGames = async () => {
    if (!window.moeDesktop || !vodUrl.trim() || role !== 'coach') return;
    setBusy('discover'); setBatchResult([]); setMessage('Downloading once, then finding every completed match scoreboard…'); setTimelineProgress({ percent: 0, message: 'Preparing the VOD…' });
    let cacheId = '';
    try {
      const discovery = await window.moeDesktop.discoverVodGames({ vodUrl: vodUrl.trim(), ...(localVod ? { localPath: localVod.path } : {}) }); cacheId = discovery.cacheId;
      const detected: Array<{ timestampMs: number; draft: ScreenshotReviewDraft; imageSha256: string; selected: number[] }> = [];
      const signatures = new Set<string>();
      for (let index = 0; index < discovery.games.length; index += 1) {
        setTimelineProgress({ percent: Math.round(index / Math.max(1, discovery.games.length) * 100), message: `Reading scoreboard candidate ${index + 1}/${discovery.games.length}…` });
        try {
          const image = fileFromBase64(discovery.games[index].base64, `vod-scoreboard-${index + 1}.png`, discovery.games[index].mediaType);
          const extracted = await extractScoreboardLocally(image, activeRoster); const selected = extracted.draft.stats.map((row, rowIndex) => row.rosterMatch.status === 'matched' ? rowIndex : -1).filter(rowIndex => rowIndex >= 0);
          if (selected.length !== 5 || extracted.draft.stats.length !== 10 || extracted.draft.match.ourScore === null || extracted.draft.match.theirScore === null || !extracted.draft.match.map) continue;
          const signature = `${extracted.draft.match.map.toLocaleLowerCase()}:${extracted.draft.match.ourScore}:${extracted.draft.match.theirScore}:${selected.map(rowIndex => `${extracted.draft.stats[rowIndex].matchedPlayerId}:${extracted.draft.stats[rowIndex].kills}:${extracted.draft.stats[rowIndex].deaths}`).sort().join('|')}`;
          if (signatures.has(signature)) continue; signatures.add(signature); detected.push({ timestampMs: discovery.games[index].timestampMs, draft: extracted.draft, imageSha256: extracted.imageSha256, selected });
        } catch { /* Geometry and identity gates intentionally discard non-scoreboard candidates. */ }
      }
      detected.sort((left, right) => left.timestampMs - right.timestampMs);
      if (!detected.length) throw new Error('No complete scoreboard with five active roster names was found. Keep the post-match scoreboard visible longer or use the manual scoreboard option below.');
      const imported: Array<{ map: string; score: string; status: string }> = [];
      for (let index = 0; index < detected.length; index += 1) {
        const game = detected[index]; const rows = game.selected.map(rowIndex => game.draft.stats[rowIndex]); const rosterIds = new Set(rows.map(row => row.matchedPlayerId).filter(Boolean));
        const dateKey = discovery.uploadDate || date; const possibleMatches = matches.filter(candidate => candidate.date === dateKey && candidate.map?.toLocaleLowerCase() === game.draft.match.map?.toLocaleLowerCase() && candidate.ourScore === game.draft.match.ourScore && candidate.theirScore === game.draft.match.theirScore && [...rosterIds].every(id => data.playerStats.some(stat => stat.matchId === candidate.id && stat.playerId === id)));
        const linked = possibleMatches.length === 1 ? possibleMatches[0] : null; const startMs = index ? Math.min(game.timestampMs, detected[index - 1].timestampMs + 60_000) : 0;
        setTimelineProgress({ percent: Math.round(index / detected.length * 100), message: `Analyzing game ${index + 1}/${detected.length} · ${game.draft.match.map}…` });
        const ours = new Set(game.selected); const players = game.draft.stats.map((row, rowIndex) => ({ name: row.extractedName, team: ours.has(rowIndex) ? 'ours' as const : 'theirs' as const, expectedKills: row.kills, expectedDeaths: row.deaths })).filter(row => row.name).slice(0, 10);
        const evidence = await window.moeDesktop.analyzeVod({ vodUrl: vodUrl.trim(), cacheId, startMs, endMs: game.timestampMs, players });
        const publicTimeline = JSON.parse(JSON.stringify(evidence, (key, item) => key === 'rawText' ? undefined : item));
        const response = await apiFetch('/api/vod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vodUrl: vodUrl.trim(), imageSha256: game.imageSha256, ...(linked ? { matchId: linked.id } : {}), coachTeamEvidence: true, date: dateKey, map: game.draft.match.map, opponent: linked?.opponent || null, ourScore: game.draft.match.ourScore, theirScore: game.draft.match.theirScore, players: rows.map(row => ({ observedName: row.extractedName, agent: row.agent, kills: value(row.kills), deaths: value(row.deaths), assists: value(row.assists), acs: value(row.acs), adr: value(row.adr), hs: value(row.hs), fk: value(row.fk), fd: value(row.fd), plants: value(row.plants), defuses: value(row.defuses), trades: value(row.trades) })), timelineEvidence: publicTimeline }) });
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Game ${index + 1} could not be integrated.`);
        imported.push({ map: game.draft.match.map, score: `${game.draft.match.ourScore}–${game.draft.match.theirScore}`, status: payload.submission.linkMode === 'new-match' ? 'New match created' : 'Linked to existing match' });
      }
      setBatchResult(imported); setMessage(`${imported.length} game${imported.length === 1 ? '' : 's'} detected, analyzed, and integrated automatically.`); setVodUrl(''); setLocalVod(null); await Promise.all([load(), Promise.resolve(onRefresh())]);
    } catch (error: any) { setMessage(error.message || 'The multi-game VOD could not be integrated.'); }
    finally { if (cacheId) await window.moeDesktop.releaseVodAnalysis(cacheId).catch(() => null); setBusy(''); setTimelineProgress(null); }
  };
  const submit = async () => {
    if (!draft || selectedRows.length !== 5 || !vodUrl.trim()) return;
    const rows = selectedRows.map(index => draft.stats[index]);
    const selectedMatch = matches.find(match => match.id === matchId);
    try {
      let analyzed = timelineEvidence;
      if (fullTimeline && window.moeDesktop && !analyzed) analyzed = await analyzeTimeline();
      setBusy('submit'); setMessage('Matching the five identities and integrating scoreboard and timeline evidence…');
      const publicTimeline = analyzed ? JSON.parse(JSON.stringify(analyzed, (key, item) => key === 'rawText' ? undefined : item)) : null;
      const response = await apiFetch('/api/vod-submissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        vodUrl: vodUrl.trim(), imageSha256, ...(matchId ? { matchId } : {}), ...(role === 'coach' && playerId ? { playerId } : {}),
        date: selectedMatch?.date || date, map: selectedMatch?.map || draft.match.map || map || null, opponent: selectedMatch?.opponent || opponent || null,
        ourScore: selectedMatch?.ourScore ?? draft.match.ourScore ?? null, theirScore: selectedMatch?.theirScore ?? draft.match.theirScore ?? null,
        players: rows.map(row => ({ observedName: row.extractedName, agent: row.agent, kills: value(row.kills), deaths: value(row.deaths), assists: value(row.assists), acs: value(row.acs), adr: value(row.adr), hs: value(row.hs), fk: value(row.fk), fd: value(row.fd), plants: value(row.plants), defuses: value(row.defuses), trades: value(row.trades) })), timelineEvidence: publicTimeline,
      }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'The VOD could not be integrated.');
      const integrated = payload.submission as VodSubmissionRecord;
      setMessage(`${integrated.linkMode === 'new-match' ? 'New match created' : 'Existing match linked'} · ${integrated.integration.createdStats} player rows added · ${integrated.integration.filledFields} missing fields filled.`);
      setVodUrl(''); setDraft(null); setImageSha256(''); setSelectedRows([]); setLocalVod(null); setTimelineEvidence(null); setTimelineProgress(null); await Promise.all([load(), Promise.resolve(onRefresh())]);
    } catch (error: any) { setMessage(error.message || 'The VOD could not be integrated.'); } finally { setBusy(''); }
  };

  return <div className="space-y-5">
    {role === 'coach' && window.moeDesktop && <section className="rounded-2xl border border-violet-300/20 bg-violet-300/[0.04] p-5"><div className="flex items-start gap-3"><Film className="mt-0.5 h-5 w-5 text-violet-300" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Coach VOD · automatic multi-match import</p><h1 className="mt-1 text-xl font-semibold">Paste one link, import every game</h1><p className="mt-1 max-w-3xl text-xs text-slate-400">Moe Tracker downloads the VOD once, detects each post-match scoreboard, identifies the five roster players, splits the timeline, and links every game to existing screenshot/replay evidence when it uniquely matches. Uncertain candidates are not imported.</p></div></div><div className="mt-4 flex flex-col gap-3 sm:flex-row"><input aria-label="Automatic multi-game VOD link" value={vodUrl} onChange={event => setVodUrl(event.target.value)} placeholder="YouTube link with one or several games" className="ui-field min-h-11 flex-1 px-3" /><button type="button" disabled={!!busy || !vodUrl.trim()} onClick={() => void autoImportAllGames()} className="ui-button ui-button-primary min-h-11 px-5 text-sm disabled:opacity-40">{busy === 'discover' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />} Detect and import all games</button></div>{batchResult.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{batchResult.map((game, index) => <article key={`${game.map}-${index}`} className="rounded-xl border border-emerald-300/15 bg-emerald-300/5 p-3"><p className="text-sm font-semibold text-emerald-200">Game {index + 1} · {game.map}</p><p className="mt-1 text-xs text-slate-300">{game.score} · {game.status}</p></article>)}</div>}</section>}
    <section className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.035] p-5">
      <div className="flex items-start gap-3"><Film className="mt-0.5 h-5 w-5 text-cyan-300" /><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Player evidence</p><h1 className="mt-1 text-xl font-semibold">Submit and analyze a personal VOD</h1><p className="mt-1 max-w-3xl text-xs text-slate-400">Add a YouTube link or original video and one end-screen scoreboard frame. The desktop app scans the full timeline locally for kill-feed, objectives, trades, KAST, orb and ultimate evidence. Five roster names are required before anything is linked; missing or unreadable events remain unknown.</p></div></div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <label className="text-xs text-slate-300">VOD link<input aria-label="VOD link" value={vodUrl} onChange={event => setVodUrl(event.target.value)} placeholder="YouTube, Twitch, Drive…" className="ui-field mt-1 min-h-11 w-full px-3" /></label>
        {role === 'coach' && <label className="text-xs text-slate-300">Submitting player<select aria-label="Submitting player" value={playerId} onChange={event => setPlayerId(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3"><option value="">Choose player</option>{activeRoster.map(player => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label>}
        <label className="text-xs text-slate-300 lg:col-span-2">Match from screenshot / replay<select aria-label="Linked match" value={matchId} onChange={event => setMatchId(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3"><option value="">Not listed — create a new match section</option>{matches.map(match => <option key={match.id} value={match.id}>{match.date} · {match.opponent || 'Unknown opponent'} · {match.map || 'Unknown map'}{typeof match.ourScore === 'number' ? ` · ${match.ourScore}–${match.theirScore}` : ''}</option>)}</select></label>
        {!chosenMatch && <><label className="text-xs text-slate-300">Match date<input type="date" value={date} onChange={event => setDate(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3" /></label><label className="text-xs text-slate-300">Opponent<input value={opponent} onChange={event => setOpponent(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3" placeholder="Opponent if known" /></label><label className="text-xs text-slate-300">Map<input value={map} onChange={event => setMap(event.target.value)} className="ui-field mt-1 min-h-11 w-full px-3" placeholder="Detected automatically when possible" /></label></>}
        <label className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-300/25 bg-black/10 px-4 text-sm text-cyan-200 lg:col-span-2"><Upload className="h-4 w-4" />{busy === 'ocr' ? 'Reading locally…' : 'Choose scoreboard or clear VOD frame'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={!!busy} onChange={event => void readImage(event.target.files?.[0])} /></label>
        {window.moeDesktop && <div className="lg:col-span-2 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => void chooseLocalVod()} disabled={!!busy} className="ui-button min-h-11 px-4 text-sm">{localVod ? `Original video · ${localVod.name}` : 'Choose original video (recommended)'}</button><label className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-slate-300"><input type="checkbox" checked={fullTimeline} onChange={event => setFullTimeline(event.target.checked)} />Analyze the complete VOD timeline automatically</label></div>}
      </div>
      {draft && <div className="mt-5 overflow-x-auto"><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold">Select our five players</p><span className={selectedRows.length === 5 ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>{selectedRows.length}/5 selected</span></div><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="p-2">Team</th><th className="p-2">Detected name</th><th className="p-2">Roster link</th><th className="p-2">Agent</th><th className="p-2">K / D / A</th><th className="p-2">ACS</th><th className="p-2">ADR</th><th className="p-2">HS</th></tr></thead><tbody>{draft.stats.map((row, index) => <tr key={`${row.extractedName}-${index}`} className="border-t border-white/5"><td className="p-2"><input type="checkbox" aria-label={`Select ${row.extractedName}`} checked={selectedRows.includes(index)} onChange={() => toggle(index)} /></td><td className="p-2 font-semibold">{row.extractedName || 'Unreadable'}</td><td className="p-2">{row.matchedPlayerName || (row.rosterMatch.status === 'ambiguous' ? 'Ambiguous' : 'Will fuzzy-match on submit')}</td><td className="p-2">{row.agent || '—'}</td><td className="p-2 font-mono">{row.kills ?? '—'} / {row.deaths ?? '—'} / {row.assists ?? '—'}</td><td className="p-2">{row.acs ?? '—'}</td><td className="p-2">{row.adr ?? '—'}</td><td className="p-2">{row.hs ?? '—'}</td></tr>)}</tbody></table></div>}
      {draft && selectedRows.length === 5 && <label className="mt-4 block text-xs text-slate-300">Player POV used for personal orb and ultimate evidence<select value={povName} onChange={event => { setPovName(event.target.value); setTimelineEvidence(null); }} className="ui-field mt-1 min-h-11 w-full px-3"><option value="">Observer VOD / unknown POV</option>{selectedRows.map(index => <option key={index} value={draft.stats[index].extractedName}>{draft.stats[index].matchedPlayerName || draft.stats[index].extractedName}</option>)}</select></label>}
      {timelineProgress && <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-3 text-xs text-cyan-100"><div className="flex justify-between gap-3"><span>{timelineProgress.message}</span><span>{timelineProgress.percent === null ? 'Working' : `${timelineProgress.percent}%`}</span></div>{timelineProgress.percent !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25"><div className="h-full bg-cyan-300 transition-all" style={{ width: `${timelineProgress.percent}%` }} /></div>}{busy === 'timeline' && <button type="button" onClick={() => void cancelTimeline()} className="ui-button mt-3 min-h-9 px-3 text-xs"><Square className="h-3.5 w-3.5" />Cancel analysis</button>}</div>}
      {timelineEvidence && <p className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">Timeline ready · {timelineEvidence.observations.length} supported observations · {timelineEvidence.coverage.resolvedEliminations} resolved eliminations · {timelineEvidence.coverage.inferredRoundGroups} covered round groups.</p>}
      {message && <p role="status" className="mt-4 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-slate-300">{message}</p>}
      <button type="button" disabled={!!busy || !draft || selectedRows.length !== 5 || !vodUrl.trim() || (role === 'coach' && !playerId)} onClick={() => void submit()} className="ui-button ui-button-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-sm disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{busy === 'timeline' ? 'Analyzing full timeline…' : busy === 'submit' ? 'Integrating evidence…' : 'Analyze and integrate VOD'}</button>
    </section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" /><h2 className="font-semibold">Submission history</h2></div><div className="mt-3 space-y-2">{history.map(item => <article key={item.id} className="rounded-xl border border-white/10 bg-black/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{item.submittedByName} · {item.date} · {item.map || 'Unknown map'}</p><p className="mt-1 text-[10px] text-slate-500">Five names matched · {item.linkMode === 'new-match' ? 'new match created' : 'existing match linked'} · {item.integration.filledFields} gaps filled{item.timelineEvidence ? ` · ${item.timelineEvidence.observations.length} timeline observations` : ' · scoreboard only'}</p>{item.timelineEvidence && <p className="mt-1 text-[10px] text-cyan-300">Kill feed {item.timelineEvidence.coverage.signals.eliminations} · trades {item.timelineEvidence.coverage.signals.trades} · KAST {item.timelineEvidence.coverage.signals.kast} · ults {item.timelineEvidence.coverage.signals.ultimateUse} · orbs {item.timelineEvidence.coverage.signals.orbCapture}</p>}</div><a href={item.vodUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">Open VOD</a></div></article>)}{history.length === 0 && <p className="py-6 text-center text-xs text-slate-500">No VOD submissions yet.</p>}</div></section>
  </div>;
}
