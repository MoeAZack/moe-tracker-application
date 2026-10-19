import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, CirclePlay, Clapperboard, Layers3, Save, X } from 'lucide-react';
import type { TrackerData } from '../types';
import { buildRecurringReviewPatterns, buildRoundReviewCards, type ReviewClassificationType, type RoundReviewCard } from '../../lib/roundReviewCockpit';
import { apiFetch } from '../utils/api';

interface Props { data: TrackerData; matchId: string; onRefresh: () => Promise<void>; onSelectRound?: (roundNo: number) => void }

function timestampedUrl(url: string, seconds: number) {
  try { const parsed = new URL(url); parsed.searchParams.set('t', `${Math.max(0, Math.round(seconds))}s`); return parsed.toString(); }
  catch { return url; }
}

const value = (input: unknown, fallback = 'Unknown') => String(input ?? '').trim() || fallback;
const timeLabel = (milliseconds: number) => { const seconds = Math.max(0, Math.round(milliseconds / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
const classificationDecision = (card: RoundReviewCard, type: ReviewClassificationType, player: string | null) => card.round.reviewCockpit?.classifications?.find(item => item.type === type && String(item.player || '') === String(player || '')) || null;

export default function RoundReviewCockpit({ data, matchId, onRefresh, onSelectRound }: Props) {
  const cards = useMemo(() => buildRoundReviewCards(data, matchId), [data, matchId]);
  const patterns = useMemo(() => buildRecurringReviewPatterns(data), [data]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(''); const [notice, setNotice] = useState('');
  const [patternDimension, setPatternDimension] = useState('all');
  const relevantPatterns = patterns.filter(pattern => pattern.rounds.some(round => round.matchId === matchId) && (patternDimension === 'all' || pattern.dimension === patternDimension)).slice(0, 12);

  const postRound = async (card: RoundReviewCard, body: Record<string, unknown>) => {
    setBusy(card.id); setNotice('');
    try {
      const response = await apiFetch('/api/vod/round-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId: card.match.id, roundNo: card.round.roundNo, ...body }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Round review could not be saved.');
      await onRefresh(); return true;
    } catch (error: any) { setNotice(error.message || 'Round review could not be saved.'); return false; }
    finally { setBusy(''); }
  };

  const generateClips = async (card: RoundReviewCard) => {
    if (!window.moeDesktop || !card.review?.vodUrl) return setNotice('Link a YouTube VOD to this match before creating local clips.');
    const moments = card.moments.filter(moment => moment.kind !== 'coach-note').slice(0, 8);
    if (!moments.length) return setNotice('No timestamped evidence is available for this round yet.');
    setBusy(`clips:${card.id}`); setNotice('Preparing short local clips around the important moments…');
    try {
      const localSelection = card.review.vodUrl.startsWith('moetracker-local://') ? await window.moeDesktop.chooseVodFile() : null;
      if (localSelection?.canceled || (localSelection && !localSelection.path)) { setNotice('Local clip creation cancelled.'); return; }
      const clips = await window.moeDesktop.createReviewClips({ ...(localSelection?.path ? { localPath: localSelection.path } : { vodUrl: card.review.vodUrl }), moments: moments.map(moment => ({ timestampMs: moment.timestampMs, label: `R${card.round.roundNo}-${moment.kind}` })) });
      const response = await apiFetch('/api/vod/round-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matchId: card.match.id, roundNo: card.round.roundNo, clips: clips.map(({ path: _path, ...clip }) => clip) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Clip references could not be saved.');
      await onRefresh(); setNotice(`${clips.length} local review clip${clips.length === 1 ? '' : 's'} created.`);
    } catch (error: any) { setNotice(error.message || 'Review clips could not be created.'); }
    finally { setBusy(''); }
  };

  if (!cards.length) return <section className="rounded-xl border border-dashed border-white/10 p-6 text-center"><Layers3 className="mx-auto h-5 w-5 text-slate-600" /><p className="mt-2 text-sm text-slate-400">No canonical rounds are linked to this match yet.</p></section>;
  return <section className="space-y-4" aria-labelledby="round-review-cockpit-title">
    <div className="flex flex-col gap-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Linked evidence workspace</p><h3 id="round-review-cockpit-title" className="mt-1 text-lg font-semibold">Round Review Cockpit</h3><p className="mt-1 max-w-3xl text-xs text-slate-400">Replay, screenshots, VOD timestamps, economy, coaching decisions and clips meet on the canonical round. “Review” labels need coach confirmation; proven event-log facts do not.</p></div><div className="rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-xs"><span className="font-semibold text-cyan-200">{cards.length}</span> linked rounds</div></div>
    {notice && <p role="status" className="rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-300">{notice}</p>}

    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{cards.map(card => {
      const isOpen = expanded.has(card.id); const decisions = card.round.reviewCockpit?.classifications || [];
      return <article key={card.id} className={`min-w-0 rounded-xl border ${isOpen ? 'border-cyan-300/30 bg-cyan-300/[0.035] sm:col-span-2 lg:col-span-4' : 'border-white/10 bg-white/[0.025]'}`}>
        <button type="button" onClick={() => { const next = new Set(expanded); if (isOpen) next.delete(card.id); else next.add(card.id); setExpanded(next); onSelectRound?.(card.round.roundNo); }} className="flex w-full items-center gap-3 p-3 text-left">
          {isOpen ? <ChevronDown className="h-4 w-4 text-cyan-300" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}<div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-semibold">Round {card.round.roundNo}</span><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${String(card.round.result).toUpperCase() === 'W' ? 'bg-emerald-400/10 text-emerald-300' : String(card.round.result).toUpperCase() === 'L' ? 'bg-rose-400/10 text-rose-300' : 'bg-white/5 text-slate-500'}`}>{value(card.round.result)}</span></div><p className="mt-0.5 truncate text-[10px] text-slate-500">{value(card.round.side)} · {value(card.economy.ours)} vs {value(card.economy.theirs)} · {card.sources.join(' + ') || 'manual round'}</p></div><span className={`text-[9px] uppercase tracking-wide ${card.evidenceCoverage === 'complete' ? 'text-emerald-300' : card.evidenceCoverage === 'partial' ? 'text-amber-300' : 'text-slate-500'}`}>{card.evidenceCoverage}</span>
        </button>
        {isOpen && <div className="space-y-4 border-t border-white/10 p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6"><Metric label="Opening kill" value={card.opening.firstKillBy} /><Metric label="Opening death" value={card.opening.firstDeathBy} /><Metric label="Trades" value={card.trades.opportunities === null ? null : `${card.trades.successful ?? '—'} / ${card.trades.opportunities}`} /><Metric label="Objective" value={card.objective.plant ? `Plant${card.objective.site ? ` · ${card.objective.site}` : ''}` : card.objective.defuse ? 'Defuse' : null} /><Metric label="Ult uses" value={card.utility.ultimateUses} /><Metric label="Orbs" value={card.utility.orbCaptures} /></div>
          <div><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Important moments</p><div className="mt-2 flex flex-wrap gap-2">{card.moments.length ? card.moments.map(moment => card.review?.vodUrl ? <a key={moment.id} href={timestampedUrl(card.review.vodUrl, moment.timestampMs / 1000)} target="_blank" rel="noreferrer" className="rounded-lg border border-cyan-300/15 bg-cyan-300/5 px-2.5 py-2 text-xs text-cyan-200"><CirclePlay className="mr-1 inline h-3.5 w-3.5" />{timeLabel(moment.timestampMs)} · {moment.label}</a> : <span key={moment.id} className="rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-400">{timeLabel(moment.timestampMs)} · {moment.label}</span>) : <span className="text-xs text-slate-500">No timed events proved yet.</span>}</div></div>
          <div><div className="flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Suggested coaching classifications</p>{card.suggestions.some(item => item.requiresCoachConfirmation) && <span className="text-[9px] text-amber-300"><AlertTriangle className="mr-1 inline h-3 w-3" />Coach judgment required</span>}</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{card.suggestions.length ? card.suggestions.map(suggestion => { const decision = classificationDecision(card, suggestion.type, suggestion.player); return <div key={`${suggestion.type}:${suggestion.player || ''}`} className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold">{suggestion.label}{suggestion.player ? ` · ${suggestion.player}` : ''}</p><p className="mt-1 text-[10px] leading-relaxed text-slate-400">{suggestion.reason}</p></div><span className={`rounded px-1.5 py-0.5 text-[8px] uppercase ${suggestion.confidence === 'high' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>{suggestion.confidence}</span></div><div className="mt-2 flex gap-2"><button disabled={busy === card.id} onClick={() => postRound(card, { classification: { type: suggestion.type, status: 'confirmed', player: suggestion.player, reason: suggestion.reason } })} className={`rounded-md px-2 py-1 text-[10px] ${decision?.status === 'confirmed' ? 'bg-emerald-400/20 text-emerald-200' : 'border border-white/10 text-slate-400'}`}><Check className="mr-1 inline h-3 w-3" />Confirm</button><button disabled={busy === card.id} onClick={() => postRound(card, { classification: { type: suggestion.type, status: 'dismissed', player: suggestion.player, reason: suggestion.reason } })} className={`rounded-md px-2 py-1 text-[10px] ${decision?.status === 'dismissed' ? 'bg-rose-400/20 text-rose-200' : 'border border-white/10 text-slate-400'}`}><X className="mr-1 inline h-3 w-3" />Dismiss</button></div></div>; }) : <p className="text-xs text-slate-500">No supported issue suggestion for this round.</p>}</div></div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]"><div className="flex gap-2"><input aria-label={`Coach note for round ${card.round.roundNo}`} value={noteDrafts[card.id] ?? card.round.reviewCockpit?.note ?? ''} onChange={event => setNoteDrafts(current => ({ ...current, [card.id]: event.target.value }))} placeholder="Coach note, intended plan, or correction…" className="ui-field min-h-10 min-w-0 flex-1 px-3 text-xs" /><button disabled={busy === card.id} onClick={() => void postRound(card, { note: noteDrafts[card.id] ?? card.round.reviewCockpit?.note ?? '' })} className="ui-button min-h-10 px-3 text-xs"><Save className="h-3.5 w-3.5" />Save</button></div><button disabled={busy === `clips:${card.id}` || !window.moeDesktop} onClick={() => void generateClips(card)} className="ui-button min-h-10 px-3 text-xs"><Clapperboard className="h-3.5 w-3.5" />{busy === `clips:${card.id}` ? 'Creating clips…' : 'Create moment clips'}</button></div>
          {!!card.round.reviewCockpit?.clips?.length && <div className="flex flex-wrap gap-2">{card.round.reviewCockpit.clips.map(clip => <button key={clip.id} onClick={() => void window.moeDesktop?.openReviewClip(clip.fileName).catch(error => setNotice(error.message))} className="rounded-lg border border-violet-300/15 bg-violet-300/5 px-2.5 py-2 text-xs text-violet-200"><Clapperboard className="mr-1 inline h-3.5 w-3.5" />{clip.label}</button>)}</div>}
          {decisions.length > 0 && <p className="text-[9px] text-slate-600">{decisions.filter(item => item.status === 'confirmed').length} confirmed · {decisions.filter(item => item.status === 'dismissed').length} dismissed</p>}
        </div>}
      </article>;
    })}</div>

    <details className="rounded-xl border border-white/10 bg-white/[0.025]" open><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Recurring coaching patterns</summary><div className="border-t border-white/10 p-4"><div className="mb-3 flex flex-wrap gap-2">{['all', 'player', 'map', 'side', 'site', 'agent', 'composition', 'opponent'].map(dimension => <button key={dimension} onClick={() => setPatternDimension(dimension)} className={`rounded-md px-2.5 py-1 text-[10px] capitalize ${patternDimension === dimension ? 'bg-cyan-300 text-slate-950' : 'border border-white/10 text-slate-400'}`}>{dimension}</button>)}</div>{relevantPatterns.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{relevantPatterns.map(pattern => <div key={`${pattern.dimension}:${pattern.key}:${pattern.issue}`} className="rounded-lg border border-white/10 bg-black/10 p-3"><p className="text-[9px] uppercase tracking-wider text-slate-500">{pattern.dimension}</p><p className="mt-1 text-sm font-semibold">{pattern.key}</p><p className="mt-1 text-xs text-amber-200">{pattern.issue.replaceAll('-', ' ')} · {pattern.count} rounds</p></div>)}</div> : <p className="text-xs text-slate-500">No issue repeats twice in the linked evidence yet. One occurrence stays a review item, not a trend.</p>}</div></details>
  </section>;
}

function Metric({ label, value: shown }: { label: string; value: unknown }) { const known = shown !== null && shown !== undefined && shown !== ''; return <div className="rounded-lg border border-white/10 bg-black/10 p-2.5"><p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-1 text-xs font-semibold ${known ? 'text-slate-200' : 'text-slate-600'}`}>{known ? String(shown) : 'Unknown'}</p></div>; }
