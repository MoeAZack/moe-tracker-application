import React, { useMemo } from 'react';
import { AlertTriangle, Coins, Crosshair, ShieldAlert, TrendingUp } from 'lucide-react';
import type { TrackerData } from '../types';
import { buildMapRoundIntelligence } from '../../lib/mapRoundAnalytics';

const ratio = (won: number, total: number) => total ? `${won}/${total} · ${Math.round(won / total * 100)}%` : 'Unknown';
const lossRatio = (lost: number, total: number) => total ? `${lost}/${total} lost · ${Math.round(lost / total * 100)}%` : 'Unknown';

function Result({ value, danger = false }: { value: string; danger?: boolean }) {
  const unknown = value === 'Unknown';
  return <span className={`font-semibold ${unknown ? 'text-slate-500' : danger ? 'text-rose-300' : 'text-slate-100'}`}>{value}</span>;
}

export default function MapRoundIntelligencePanel({ data }: { data: TrackerData }) {
  const maps = useMemo(() => buildMapRoundIntelligence(data.matches || [], data.rounds || []), [data.matches, data.rounds]);
  if (!maps.length) return <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5"><h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Opening rounds and economy punishments</h3><p className="mt-2 text-xs text-slate-500">Unknown until accepted round evidence is available. Match scores alone cannot prove buy conversions.</p></section>;

  return <section className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.025] p-5" aria-labelledby="map-round-intelligence">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 id="map-round-intelligence" className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-cyan-200"><Crosshair className="h-4 w-4" />Opening rounds and economy punishments</h3><p className="mt-1 text-xs text-slate-500">Accepted team rounds only. Unknown evidence is excluded, never counted as a loss.</p></div>
      <span className="text-[10px] text-slate-500">R2 conversion requires a pistol win · bonus requires winning R1 and R2</span>
    </div>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[1180px] text-left text-xs">
        <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="pb-3 pr-4">Map / coverage</th><th className="pb-3 px-3">Latest first three</th><th className="pb-3 px-3">R1 / R2 / R3</th><th className="pb-3 px-3">Pistols</th><th className="pb-3 px-3">After pistol</th><th className="pb-3 px-3">Earned bonus</th><th className="pb-3 px-3">Low-buy wins</th><th className="pb-3 px-3">Full-buy losses</th><th className="pb-3 pl-3">Anti-eco losses</th></tr></thead>
        <tbody className="divide-y divide-white/[0.07]">{maps.map(row => <tr key={row.map} className="align-top">
          <td className="py-4 pr-4"><strong className="block text-sm text-white">{row.map}</strong><span className="mt-1 block text-[10px] text-slate-500">{row.matches} match{row.matches === 1 ? '' : 'es'} · {row.coveredRounds} rounds</span></td>
          <td className="px-3 py-4 font-mono"><span className="block text-amber-300">H1 {row.latestOpening?.firstHalf || '–'}</span><span className="mt-1 block text-cyan-300">H2 {row.latestOpening?.secondHalf || '–'}</span><span className="mt-1 block max-w-40 truncate text-[9px] text-slate-600" title={row.latestOpening?.label}>{row.latestOpening?.label}</span></td>
          <td className="px-3 py-4"><span className="block">R1 <Result value={ratio(row.openingRounds[0].won, row.openingRounds[0].total)} /></span><span className="mt-1 block">R2 <Result value={ratio(row.openingRounds[1].won, row.openingRounds[1].total)} /></span><span className="mt-1 block">R3 <Result value={ratio(row.openingRounds[2].won, row.openingRounds[2].total)} /></span></td>
          <td className="px-3 py-4"><Result value={ratio(row.pistol.won, row.pistol.total)} /></td>
          <td className="px-3 py-4"><Result value={ratio(row.postPistol.won, row.postPistol.total)} /></td>
          <td className="px-3 py-4"><Result value={ratio(row.earnedBonus.won, row.earnedBonus.total)} /></td>
          <td className="px-3 py-4"><Result value={ratio(row.lowBuy.won, row.lowBuy.total)} /><span className="mt-1 block text-[9px] text-slate-500">ATT {ratio(row.lowBuyBySide.attack.won, row.lowBuyBySide.attack.total)} · DEF {ratio(row.lowBuyBySide.defense.won, row.lowBuyBySide.defense.total)}</span></td>
          <td className="px-3 py-4"><Result danger value={lossRatio(row.fullBuyLosses.lost, row.fullBuyLosses.total)} /></td>
          <td className="py-4 pl-3"><Result danger value={lossRatio(row.antiEcoLosses.lost, row.antiEcoLosses.total)} /><span className="mt-1 flex items-center gap-1 text-[9px] text-slate-500"><AlertTriangle className="h-3 w-3" />{row.confirmedAntiEcoThrows} coach-confirmed throw{row.confirmedAntiEcoThrows === 1 ? '' : 's'}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mt-3 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-3"><span className="flex items-center gap-1"><Coins className="h-3 w-3" />Low-buy win = our eco/low loadout won</span><span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />Anti-eco loss = our full buy lost to enemy eco/low</span><span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" />Economic upset is only called a throw when coach-confirmed</span></div>
  </section>;
}
