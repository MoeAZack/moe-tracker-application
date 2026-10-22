import React, { useMemo } from 'react';
import { AlertTriangle, Coins, ShieldAlert } from 'lucide-react';
import type { TrackerData } from '../types';
import { buildMapRoundIntelligence } from '../../lib/mapRoundAnalytics';
import { percentageTextClass } from '../utils/percentageColor';

const wins = (won: number, total: number) => total ? `${won}/${total} won · ${Math.round(won / total * 100)}%` : 'Unknown';
const losses = (lost: number, total: number) => total ? `${lost}/${total} lost · ${Math.round(lost / total * 100)}%` : 'Unknown';
const rate = (count: number, total: number) => total ? Math.round(count / total * 100) : null;

export default function MapRoundIntelligencePanel({ data }: { data: TrackerData }) {
  const maps = useMemo(() => buildMapRoundIntelligence(data.matches || [], data.rounds || []), [data.matches, data.rounds]);
  if (!maps.length) return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5"><h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Economy punishments</h3><p className="mt-2 text-xs text-slate-500">Unknown until accepted buy evidence is available.</p></section>;

  return <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.025] p-5" aria-labelledby="map-economy-punishments">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 id="map-economy-punishments" className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-200"><Coins className="h-4 w-4" />Economy punishments</h3><p className="mt-1 text-xs text-slate-500">Only the three economy mismatch metrics. Opening and conversion numbers are consolidated into Map Pool Breakdown above.</p></div><span className="text-xs text-slate-500">Accepted buy evidence only · unknown is never treated as a loss</span></div>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3 pr-4">Map / coverage</th><th className="pb-3 px-4">Low-buy wins</th><th className="pb-3 px-4">Full-buy losses</th><th className="pb-3 pl-4">Anti-eco losses</th></tr></thead><tbody className="divide-y divide-white/[0.07]">{maps.map(row => <tr key={row.map}>
      <td className="py-4 pr-4"><strong className="block text-sm text-white">{row.map}</strong><span className="mt-1 block text-xs text-slate-500">{row.matches} match{row.matches === 1 ? '' : 'es'} · {row.coveredRounds} rounds</span></td>
      <td className="px-4 py-4"><strong className={percentageTextClass(rate(row.lowBuy.won, row.lowBuy.total))}>{wins(row.lowBuy.won, row.lowBuy.total)}</strong><span className="mt-1 block text-xs text-slate-500">ATT <span className={percentageTextClass(rate(row.lowBuyBySide.attack.won, row.lowBuyBySide.attack.total))}>{wins(row.lowBuyBySide.attack.won, row.lowBuyBySide.attack.total)}</span> · DEF <span className={percentageTextClass(rate(row.lowBuyBySide.defense.won, row.lowBuyBySide.defense.total))}>{wins(row.lowBuyBySide.defense.won, row.lowBuyBySide.defense.total)}</span></span></td>
      <td className="px-4 py-4"><strong className={percentageTextClass(rate(row.fullBuyLosses.lost, row.fullBuyLosses.total), true)}>{losses(row.fullBuyLosses.lost, row.fullBuyLosses.total)}</strong><span className="mt-1 block text-xs text-slate-500">All rounds where our buy was classified Full</span></td>
      <td className="py-4 pl-4"><strong className={percentageTextClass(rate(row.antiEcoLosses.lost, row.antiEcoLosses.total), true)}>{losses(row.antiEcoLosses.lost, row.antiEcoLosses.total)}</strong><span className="mt-1 flex items-center gap-1 text-xs text-slate-500"><AlertTriangle className="h-3 w-3" />{row.confirmedAntiEcoThrows} coach-confirmed throw{row.confirmedAntiEcoThrows === 1 ? '' : 's'}</span></td>
    </tr>)}</tbody></table></div>
    <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3"><span className="flex items-center gap-1"><Coins className="h-3 w-3" />Low-buy: our eco/low loadout won</span><span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />Full-buy loss: our full loadout lost</span><span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Anti-eco: our full buy lost to enemy eco/low</span></div>
  </section>;
}
