import React, { useMemo } from 'react';
import { TrackerData } from '../types';

function score(match: any) {
  if (typeof match.ourScore === 'number' && typeof match.theirScore === 'number') return `${match.ourScore}–${match.theirScore}`;
  if ([match.attW, match.attL, match.defW, match.defL].every((value: unknown) => typeof value === 'number')) return `${match.attW + match.defW}–${match.attL + match.defL}`;
  return '—';
}

/** `focusMatchId` comes from an evidence link: that match is listed first and marked. */
export default function WebsiteMatchLog({ data, theme, focusMatchId = null }: { data: TrackerData; theme: any; focusMatchId?: string | null }) {
  const matches = useMemo(() => [...(data.matches || [])].sort((a, b) => Number(b.id === focusMatchId) - Number(a.id === focusMatchId) || String(b.date).localeCompare(String(a.date))), [data.matches, focusMatchId]);
  const stats = useMemo(() => new Map(matches.map(match => [match.id, (data.playerStats || []).filter(row => row.matchId === match.id)])), [matches, data.playerStats]);
  return <section className={`overflow-hidden rounded-2xl border ${theme.cardBg} ${theme.border}`} aria-labelledby="website-match-log-title">
    <div className={`border-b px-5 py-4 ${theme.border}`}><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">Coach-accepted summaries</p><h1 id="website-match-log-title" className="mt-1 text-xl font-semibold">Match Log</h1><p className="mt-1 text-xs text-slate-400">Raw replays, screenshots, round events, and review notes remain on the desktop application.</p></div>
    <div className="divide-y divide-white/10">{matches.map(match => <article key={match.id} aria-current={match.id === focusMatchId ? 'true' : undefined} className={`grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto] ${match.id === focusMatchId ? 'bg-cyan-400/[0.06] ring-1 ring-inset ring-cyan-400/30' : ''}`}>
      <div><h2 className="font-semibold">{match.opponent || 'Opponent not recorded'} · {match.map || 'Map unknown'}</h2><p className="mt-1 text-xs text-slate-400">{match.date} · {match.type || 'Match'} · {stats.get(match.id)?.length || 0} player summaries</p><div className="mt-3 flex flex-wrap gap-2">{(stats.get(match.id) || []).slice(0, 10).map(row => <span key={row.id} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-300">{row.displayNameSnapshot || row.player || 'Player'} · {row.kills ?? '—'}/{row.deaths ?? '—'}/{row.assists ?? '—'}</span>)}</div></div>
      <div className="self-start rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-2 text-center font-mono text-xl font-semibold text-cyan-200" aria-label={`Score ${score(match)}`}>{score(match)}</div>
    </article>)}{!matches.length && <p className="px-5 py-16 text-center text-sm text-slate-400">No coach-accepted matches have synchronized yet.</p>}</div>
  </section>;
}
