import React, { useMemo } from 'react';
import { TrackerData } from '../types';

export default function WebsiteMapSummary({ data, theme }: { data: TrackerData; theme: any }) {
  const rows = useMemo(() => {
    const groups = new Map<string, { map: string; played: number; wins: number; losses: number; scored: number; conceded: number }>();
    for (const match of data.matches || []) {
      const map = match.map || 'Unknown map'; const row = groups.get(map) || { map, played: 0, wins: 0, losses: 0, scored: 0, conceded: 0 };
      const ours = typeof match.ourScore === 'number' ? match.ourScore : typeof match.attW === 'number' && typeof match.defW === 'number' ? match.attW + match.defW : null;
      const theirs = typeof match.theirScore === 'number' ? match.theirScore : typeof match.attL === 'number' && typeof match.defL === 'number' ? match.attL + match.defL : null;
      row.played += 1; if (ours !== null && theirs !== null) { row.scored += ours; row.conceded += theirs; if (ours > theirs) row.wins += 1; else if (ours < theirs) row.losses += 1; }
      groups.set(map, row);
    }
    return [...groups.values()].sort((a, b) => b.played - a.played || a.map.localeCompare(b.map));
  }, [data.matches]);
  return <section className={`rounded-2xl border p-5 ${theme.cardBg} ${theme.border}`} aria-labelledby="website-map-pool-title"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-400">Accepted match summaries</p><h1 id="website-map-pool-title" className="mt-1 text-xl font-semibold">Map pool</h1><p className="mt-1 text-xs text-slate-400">Detailed rounds, strategies, and tactical notes remain private to the desktop workspace.</p><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{rows.map(row => <article key={row.map} className={`rounded-xl border p-4 ${theme.border}`}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{row.map}</h2><span className="font-mono text-xs text-slate-400">{row.played} played</span></div><p className="mt-4 text-2xl font-semibold">{row.wins}–{row.losses}</p><p className="mt-1 text-xs text-slate-400">{row.scored} rounds won · {row.conceded} lost</p></article>)}{!rows.length && <p className="text-sm text-slate-400">No accepted map results have synchronized yet.</p>}</div></section>;
}
