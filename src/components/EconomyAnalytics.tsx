import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Coins, TrendingUp, Shield, Swords } from 'lucide-react';
import { knownResult, knownRoundSide } from '../../lib/analyticsEvidence';
import ReplayMatchLog from './ReplayMatchLog';
import { buildPlayerScreenshotMetrics, combineStoredScreenshotMetrics } from '../../lib/scrimRoundAnalytics';
import { buildMapRoundIntelligence } from '../../lib/mapRoundAnalytics';
import { percentageBarClass, percentageTextClass } from '../utils/percentageColor';

interface Props {
  data: TrackerData;
  theme: any;
}

const pct = (won: number, total: number) => (total > 0 ? Math.round((won / total) * 100) : 0);

function Bar({ label, won, total }: { label: string; won: number; total: number }) {
  const p = pct(won, total);
  const color = total > 0 ? percentageBarClass(p) : percentageBarClass(null);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-500">{won}/{total} · <span className={`font-bold ${percentageTextClass(total > 0 ? p : null)}`}>{total > 0 ? `${p}%` : 'Unknown'}</span></span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${total > 0 ? p : 0}%` }} />
      </div>
    </div>
  );
}

function StatCard({ icon, title, attW, attT, defW, defT }: { icon: React.ReactNode; title: string; attW: number; attT: number; defW: number; defT: number }) {
  const total = attT + defT, won = attW + defW;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold tracking-widest text-gray-500 flex items-center gap-1.5">{icon}{title}</span>
        <span className={`text-lg font-black ${percentageTextClass(total > 0 ? pct(won, total) : null)}`}>{total > 0 ? `${pct(won, total)}%` : 'Unknown'}</span>
      </div>
      <div className="space-y-1.5 text-[11px] font-mono">
        <div className="flex justify-between"><span>Attack</span><span className={percentageTextClass(attT > 0 ? pct(attW, attT) : null)}>{attW}/{attT} · {attT > 0 ? `${pct(attW, attT)}%` : 'Unknown'}</span></div>
        <div className="flex justify-between"><span>Defense</span><span className={percentageTextClass(defT > 0 ? pct(defW, defT) : null)}>{defW}/{defT} · {defT > 0 ? `${pct(defW, defT)}%` : 'Unknown'}</span></div>
      </div>
    </div>
  );
}

export default function EconomyAnalytics({ data, theme }: Props) {
  const matches = data.matches || [];
  const rounds = data.rounds || [];
  const buyTypes = data.settings?.buyTypes || ['Full', 'Half', 'Force', 'Bonus', 'Eco'];

  // Canonical round-backed conversions shared with Map Analysis and exports.
  const special = useMemo(() => {
    const acc = { pistol: { attW: 0, attT: 0, defW: 0, defT: 0 }, eco: { attW: 0, attT: 0, defW: 0, defT: 0 }, bonus: { attW: 0, attT: 0, defW: 0, defT: 0 } };
    for (const row of buildMapRoundIntelligence(matches.map(match => ({ ...match, roundAnalytics: undefined })), rounds)) {
      for (const [kind, source] of [['pistol', row.pistolBySide], ['eco', row.postPistolBySide], ['bonus', row.earnedBonusBySide]] as const) {
        acc[kind].attW += source.attack.won; acc[kind].attT += source.attack.total;
        acc[kind].defW += source.defense.won; acc[kind].defT += source.defense.total;
      }
    }
    return acc;
  }, [matches, rounds]);

  // Round-level buy-type + side win rates (available when rounds are logged).
  const byBuy = useMemo(() => {
    const acc: Record<string, { won: number; total: number }> = {};
    rounds.forEach((r: any) => {
      const buy = String(r.buy || '').trim();
      const result = knownResult(r.result);
      if (!buy || !result) return;
      if (!acc[buy]) acc[buy] = { won: 0, total: 0 };
      acc[buy].total++;
      if (result === 'win') acc[buy].won++;
    });
    return acc;
  }, [rounds]);

  const bySide = useMemo(() => {
    const acc = { Attack: { won: 0, total: 0 }, Defense: { won: 0, total: 0 } };
    rounds.forEach((r: any) => {
      const side = knownRoundSide(r.side);
      const result = knownResult(r.result);
      if (!side || !result) return;
      acc[side].total++;
      if (result === 'win') acc[side].won++;
    });
    return acc;
  }, [rounds]);

  const orderedBuys = buyTypes.filter((b) => byBuy[b]).concat(Object.keys(byBuy).filter((b) => !buyTypes.includes(b)));
  const hasRounds = rounds.length > 0;
  const hasKnownBuys = Object.keys(byBuy).length > 0;
  const screenshotPlayers = useMemo(() => {
    const live = buildPlayerScreenshotMetrics(rounds);
    return live.length ? live : combineStoredScreenshotMetrics(data.playerStats || []);
  }, [rounds, data.playerStats]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Coins className="w-6 h-6 text-[#ff4655]" />
        <h2 className="text-2xl font-black tracking-tight uppercase">Economy Analytics</h2>
      </div>

      <ReplayMatchLog data={data} theme={theme} title="Economy evidence by match" description="Round results are included immediately; buy-type metrics stay unknown until the replay or coach provides them." />

      {screenshotPlayers.length > 0 && <section className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5`} aria-labelledby="screenshot-player-metrics"><div className="flex flex-wrap items-end justify-between gap-2"><div><h3 id="screenshot-player-metrics" className="text-xs uppercase font-bold tracking-widest text-gray-500">Screenshot-derived player metrics</h3><p className="mt-1 text-xs text-gray-500">Confirmed round screens only. Weapon means equipped weapon, not a proven purchase.</p></div><span className="text-[10px] text-gray-500">KAST uses only fully covered rounds</span></div><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="text-[10px] uppercase tracking-wider text-gray-500"><tr><th className="pb-2">Player</th><th className="pb-2">Rounds</th><th className="pb-2">Openings</th><th className="pb-2">Multi-kills</th><th className="pb-2">Low-buy wins</th><th className="pb-2">Full-buy losses</th><th className="pb-2">Anti-eco losses</th><th className="pb-2">Top weapon</th><th className="pb-2">KAST</th></tr></thead><tbody>{screenshotPlayers.map(player => { const weapon = player.weapons[0]; const kast = player.kast?.covered ? Math.round(player.kast.successful / player.kast.covered * 100) : null; return <tr key={player.identity} className="border-t border-white/5"><td className="py-3 font-semibold">{player.displayName}</td><td>{player.coveredRounds}</td><td>{player.firstKills}–{player.firstDeaths}</td><td>{player.multikills.two}×2K · {player.multikills.three}×3K · {player.multikills.four}×4K · {player.multikills.ace} ace</td><td>{player.lowBudgetWins}</td><td>{player.highBudgetLosses}</td><td>{player.antiEcoLosses}</td><td>{weapon ? `${weapon.weapon} · ${weapon.wins}/${weapon.rounds}` : 'Unknown'}</td><td className={percentageTextClass(kast)}>{kast === null ? 'Unknown' : `${kast}% (${player.kast!.covered})`}</td></tr>; })}</tbody></table></div></section>}

      {matches.length === 0 ? (
        <p className="text-sm text-gray-500 font-mono italic">Log some matches to see economy conversions.</p>
      ) : (
        <>
          <div>
            <h3 className="text-xs uppercase font-bold tracking-widest text-gray-500 mb-3">Special-round conversion (per match)</h3>
            <div className="grid sm:grid-cols-3 gap-4">
              <StatCard icon={<Coins className="w-3.5 h-3.5" />} title="Pistols" {...special.pistol} />
              <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} title="Eco Rounds" {...special.eco} />
              <StatCard icon={<TrendingUp className="w-3.5 h-3.5" />} title="Bonus Rounds" {...special.bonus} />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5 space-y-4`}>
              <h3 className="text-xs uppercase font-bold tracking-widest text-gray-500">Win rate by buy type</h3>
              {!hasKnownBuys ? (
                <p className="text-xs text-gray-500 font-mono italic">Buy/loadout evidence is unavailable for these rounds. Side and result evidence is still included below.</p>
              ) : (
                <div className="space-y-3">{orderedBuys.map((b) => <React.Fragment key={b}><Bar label={b} won={byBuy[b].won} total={byBuy[b].total} /></React.Fragment>)}</div>
              )}
            </div>

            <div className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5 space-y-4`}>
              <h3 className="text-xs uppercase font-bold tracking-widest text-gray-500">Round win rate by side</h3>
              {!hasRounds ? (
                <p className="text-xs text-gray-500 font-mono italic">No round data yet.</p>
              ) : (
                <div className="space-y-3">
                  <Bar label="Attack" won={bySide.Attack.won} total={bySide.Attack.total} />
                  <Bar label="Defense" won={bySide.Defense.won} total={bySide.Defense.total} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
