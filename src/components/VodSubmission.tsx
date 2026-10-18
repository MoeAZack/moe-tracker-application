import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Film, LoaderCircle, Upload, Users } from 'lucide-react';
import type { ScreenshotReviewDraft, TrackerData, VodSubmission as VodSubmissionRecord, VodTimelineEvidence } from '../types';
import { extractScoreboardLocally } from '../utils/localScoreboard';
import { apiFetch } from '../utils/api';
import { cairoDateKeyAt } from '../../lib/uiIntegration';

type Props = { data: TrackerData; role: string | null; onRefresh: () => Promise<void> | void };
const value = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : null;

export default function VodSubmission({ data, role, onRefresh }: Props) {
  const [history, setHistory] = useState<VodSubmissionRecord[]>([]);
  const [vodUrl, setVodUrl] = useState(''); const [matchId, setMatchId] = useState(''); const [playerId, setPlayerId] = useState('');
  const [date, setDate] = useState(cairoDateKeyAt()); const [map, setMap] = useState(''); const [opponent, setOpponent] = useState('');
  const [draft, setDraft] = useState<ScreenshotReviewDraft | null>(null); const [imageSha256, setImageSha256] = useState(''); const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [localVod, setLocalVod] = useState<{ path: string; name: string } | null>(null); const [timelineEvidence, setTimelineEvidence] = useState<VodTimelineEvidence | null>(null); const [timelineProgress, setTimelineProgress] = useState<{ percent: number | null; message: string } | null>(null); const [fullTimeline, setFullTimeline] = useState(true); const [povName, setPovName] = useState('');
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
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
      {timelineProgress && <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-3 py-3 text-xs text-cyan-100"><div className="flex justify-between gap-3"><span>{timelineProgress.message}</span><span>{timelineProgress.percent === null ? 'Working' : `${timelineProgress.percent}%`}</span></div>{timelineProgress.percent !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25"><div className="h-full bg-cyan-300 transition-all" style={{ width: `${timelineProgress.percent}%` }} /></div>}</div>}
      {timelineEvidence && <p className="mt-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">Timeline ready · {timelineEvidence.observations.length} supported observations · {timelineEvidence.coverage.resolvedEliminations} resolved eliminations · {timelineEvidence.coverage.inferredRoundGroups} covered round groups.</p>}
      {message && <p role="status" className="mt-4 rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs text-slate-300">{message}</p>}
      <button type="button" disabled={!!busy || !draft || selectedRows.length !== 5 || !vodUrl.trim() || (role === 'coach' && !playerId)} onClick={() => void submit()} className="ui-button ui-button-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-sm disabled:opacity-40">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{busy === 'timeline' ? 'Analyzing full timeline…' : busy === 'submit' ? 'Integrating evidence…' : 'Analyze and integrate VOD'}</button>
    </section>
    <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-slate-400" /><h2 className="font-semibold">Submission history</h2></div><div className="mt-3 space-y-2">{history.map(item => <article key={item.id} className="rounded-xl border border-white/10 bg-black/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{item.submittedByName} · {item.date} · {item.map || 'Unknown map'}</p><p className="mt-1 text-[10px] text-slate-500">Five names matched · {item.linkMode === 'new-match' ? 'new match created' : 'existing match linked'} · {item.integration.filledFields} gaps filled{item.timelineEvidence ? ` · ${item.timelineEvidence.observations.length} timeline observations` : ' · scoreboard only'}</p>{item.timelineEvidence && <p className="mt-1 text-[10px] text-cyan-300">Kill feed {item.timelineEvidence.coverage.signals.eliminations} · trades {item.timelineEvidence.coverage.signals.trades} · KAST {item.timelineEvidence.coverage.signals.kast} · ults {item.timelineEvidence.coverage.signals.ultimateUse} · orbs {item.timelineEvidence.coverage.signals.orbCapture}</p>}</div><a href={item.vodUrl} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">Open VOD</a></div></article>)}{history.length === 0 && <p className="py-6 text-center text-xs text-slate-500">No VOD submissions yet.</p>}</div></section>
  </div>;
}
