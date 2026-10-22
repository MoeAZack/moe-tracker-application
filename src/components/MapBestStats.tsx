import React, { useState, useMemo } from 'react';
import { TrackerData } from '../types';
import { Compass, Calculator, TrendingUp, ShieldAlert, Skull, Sparkles, Users } from 'lucide-react';
import { knownResult } from '../../lib/analyticsEvidence';
import { classifyAverageLoadout, classifyTeamEquipment } from '../../lib/scrimRoundAnalytics';
import ReplayMatchLog from './ReplayMatchLog';
import MapRoundIntelligencePanel from './MapRoundIntelligencePanel';
import { buildMapRoundIntelligence } from '../../lib/mapRoundAnalytics';
import { percentageTextClass } from '../utils/percentageColor';
import { activeResourceNames, canonicalResourceName } from '../../lib/resourceCatalog';
import { bestMapInsight, buildBestMaps, buildMapStatsTable, sideRoundsComplete, teamKdComplete } from '../../lib/mapBestScores';
import { DEFAULT_MINIMUM_METRIC_SAMPLES, metricSampleGate } from '../../lib/metricTrust';

interface ComponentProps {
  data: TrackerData;
  theme: any;
}

export default function MapBestStats({ data, theme }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const [activeSubTab, setActiveSubTab] = useState<'stats' | 'calculator' | 'throws'>('stats');


  const matches = data.matches || [];
  const playerStats = data.playerStats || [];
  const maps = useMemo(() => activeResourceNames(data, 'map'), [data]);
  const roundIntelligenceByMap = useMemo(() => new Map(buildMapRoundIntelligence(matches, data.rounds || []).map(row => [row.map, row])), [matches, data.rounds]);
  const conversionText = (value?: { won: number; total: number }) => value?.total ? `${value.won}/${value.total} · ${Math.round(value.won / value.total * 100)}%` : '—';
  const conversionPercentage = (value?: { won: number; total: number }) => value?.total ? Math.round(value.won / value.total * 100) : null;

  // --- MAP STATS CALCULATOR ---
  const mapStatsTable = useMemo(() => buildMapStatsTable(data, maps), [data, maps]);

  // --- BEST MAP CALCULATOR WEIGHTED ---
  const calculatedBestMaps = useMemo(() => buildBestMaps(data, mapStatsTable), [data, mapStatsTable]);
  const insight = bestMapInsight(calculatedBestMaps, data.settings);
  const minimumMapSamples = data.settings.stats?.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES;

  // --- TACTICAL LOSS & THROW ANALYTICS ---
  const throwStats = useMemo(() => {
    const mapThrows: Record<string, { totalThrows: number; evidenceLosses: number; reasons: Record<string, number>; players: Record<string, number> }> = {};
    const playerIssues: Record<string, { overpeeks: number; failedClutches: number; otherThrows: number; total: number }> = {};
    const reasonFrequency: Record<string, number> = {};

    maps.forEach(m => {
      mapThrows[m] = { totalThrows: 0, evidenceLosses: 0, reasons: {}, players: {} };
    });

    // Legacy settings can outlive a roster reset. Zero-evidence discipline rows
    // must come only from current canonical roster identities; historical names
    // are added below only when an accepted round actually references them.
    const allPlayersInConfig = (data.rosterPlayers || [])
      .filter(player => !player.retiredAt)
      .map(player => player.displayName);

    allPlayersInConfig.forEach(p => {
      playerIssues[p] = { overpeeks: 0, failedClutches: 0, otherThrows: 0, total: 0 };
    });

    const allRounds = data.rounds || [];
    const allMatches = data.matches || [];
    const numberedByMatch = new Map<string, Map<number, any>>();
    allRounds.forEach(round => { const numbered = numberedByMatch.get(round.matchId) || new Map(); if (!numbered.has(round.roundNo)) numbered.set(round.roundNo, round); numberedByMatch.set(round.matchId, numbered); });

    const economy = (round: any, team: 'ours' | 'theirs') => {
      const explicit = String(team === 'ours' ? round.buy || '' : round.enemyBuy || '').toLocaleLowerCase();
      if (['eco', 'pistol'].includes(explicit)) return 'eco';
      if (['low', 'force', 'force buy'].includes(explicit)) return 'low';
      if (['half', 'bonus', 'half buy'].includes(explicit)) return 'half';
      if (['full', 'full buy'].includes(explicit)) return 'full';
      const evidence = round.screenshotEvidence;
      if (!evidence || evidence.reviewStatus !== 'confirmed') return 'unknown';
      const equipment = classifyTeamEquipment(evidence.players || [], team);
      return equipment !== 'unknown' ? equipment : classifyAverageLoadout(team === 'ours' ? evidence.ourAverageLoadout : evidence.enemyAverageLoadout);
    };

    const lostAdvantageLabel = (round: any) => {
      const canonical = (round.advantageEvidence?.states || []).filter((state: any) => state.outcome === 'lost').sort((a: any, b: any) => b.differential - a.differential || b.oursAlive - a.oursAlive)[0];
      if (canonical) return `Lost ${canonical.label} player advantage`;
      const evidence = round.screenshotEvidence;
      const events = [...(evidence?.events || [])].sort((a: any, b: any) => a.sequence - b.sequence);
      if (evidence?.reviewStatus !== 'confirmed' || evidence?.eventsComplete !== true || !events.length || events.some((event: any, index: number) => event.sequence !== index + 1)) return null;
      let ours = 5, theirs = 5, peak = 0;
      for (const event of events) {
        if (event.victimTeam === 'ours') ours = Math.max(0, ours - 1);
        if (event.victimTeam === 'theirs') theirs = Math.max(0, theirs - 1);
        peak = Math.max(peak, ours - theirs);
      }
      return peak >= 2 ? 'Lost 2+ player advantage' : null;
    };

    allRounds.forEach(r => {
      const isAThrow = (r.isThrow as any) === 'TRUE' || (r.isThrow as any) === true;
      const hasReason = r.throwReason && r.throwReason !== '-';
      const hasPlayer = r.thrownBy && r.thrownBy !== '-';

      if (isAThrow || hasReason || hasPlayer) {
        const match = allMatches.find(m => m.id === r.matchId);
        if (match) {
          const mapName = canonicalResourceName(data, 'map', match.map) || match.map;
          if (!mapThrows[mapName]) {
            mapThrows[mapName] = { totalThrows: 0, evidenceLosses: 0, reasons: {}, players: {} };
          }
          mapThrows[mapName].totalThrows++;
          if (r.throwReason && r.throwReason !== '-') {
            mapThrows[mapName].reasons[r.throwReason] = (mapThrows[mapName].reasons[r.throwReason] || 0) + 1;
          }
          if (r.thrownBy && r.thrownBy !== '-') {
            mapThrows[mapName].players[r.thrownBy] = (mapThrows[mapName].players[r.thrownBy] || 0) + 1;
          }
        }

        if (r.thrownBy && r.thrownBy !== '-') {
          const pName = r.thrownBy;
          if (!playerIssues[pName]) {
            playerIssues[pName] = { overpeeks: 0, failedClutches: 0, otherThrows: 0, total: 0 };
          }
          playerIssues[pName].total++;
          if (r.throwReason === 'Overpeeking') {
            playerIssues[pName].overpeeks++;
          } else if (r.throwReason?.toLowerCase().includes('clutch')) {
            playerIssues[pName].failedClutches++;
          } else {
            playerIssues[pName].otherThrows++;
          }
        }

        if (r.throwReason && r.throwReason !== '-') {
          reasonFrequency[r.throwReason] = (reasonFrequency[r.throwReason] || 0) + 1;
        }
      }

      if (knownResult(r.result) === 'loss') {
        const match = allMatches.find(m => m.id === r.matchId);
        if (!match?.map) return;
        const ours = economy(r, 'ours');
        const theirs = economy(r, 'theirs');
        const pistolRound = r.roundNo === 2 ? 1 : r.roundNo === 14 ? 13 : null;
        const lostPostPistol = pistolRound !== null && knownResult(numberedByMatch.get(r.matchId)?.get(pistolRound)?.result) === 'win';
        const reason = ours === 'full' && (theirs === 'eco' || theirs === 'low') ? 'Anti-eco loss'
          : lostPostPistol ? 'Failed post-pistol conversion'
            : lostAdvantageLabel(r) || (ours === 'full' ? 'Full-buy loss' : null);
        if (reason) {
          const canonicalMap = canonicalResourceName(data, 'map', match.map) || match.map;
          const mapRow = mapThrows[canonicalMap] || (mapThrows[canonicalMap] = { totalThrows: 0, evidenceLosses: 0, reasons: {}, players: {} });
          mapRow.evidenceLosses += 1;
          mapRow.reasons[reason] = (mapRow.reasons[reason] || 0) + 1;
          reasonFrequency[reason] = (reasonFrequency[reason] || 0) + 1;
        }
      }
    });

    return { mapThrows, playerIssues, reasonFrequency };
  }, [data, maps]);

  const topMapThrow = useMemo(() => {
    let topMap = 'None';
    let maxThrows = 0;
    Object.entries(throwStats.mapThrows).forEach(([m, s]) => {
      const stat = s as any;
      const riskCount = stat.evidenceLosses || stat.totalThrows;
      if (riskCount > maxThrows) {
        maxThrows = riskCount;
        topMap = m;
      }
    });
    return { map: topMap, count: maxThrows };
  }, [throwStats]);

  const topOverpeeker = useMemo(() => {
    let topPlayer = 'None';
    let maxOverpeeks = 0;
    Object.entries(throwStats.playerIssues).forEach(([p, s]) => {
      const stat = s as any;
      if (stat.overpeeks > maxOverpeeks) {
        maxOverpeeks = stat.overpeeks;
        topPlayer = p;
      }
    });
    return { name: topPlayer, count: maxOverpeeks };
  }, [throwStats]);

  const topReason = useMemo(() => {
    let topR = 'None';
    let maxCount = 0;
    Object.entries(throwStats.reasonFrequency).forEach(([r, c]) => {
      const count = c as number;
      if (count > maxCount) {
        maxCount = count;
        topR = r;
      }
    });
    return { reason: topR, count: maxCount };
  }, [throwStats]);

  const totalThrownRounds = useMemo(() => {
    return Object.values(throwStats.playerIssues).reduce((acc, curr: any) => acc + curr.total, 0);
  }, [throwStats]);
  const totalEvidenceLosses = useMemo(() => Object.values(throwStats.mapThrows).reduce((total, row: any) => total + row.evidenceLosses, 0), [throwStats]);

  return (
    <div className="space-y-6">
      {/* Sub tabs bar */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
        {[
          { id: 'stats', label: 'Map Pool Stats', icon: Compass },
          { id: 'calculator', label: 'Best Map Calculator', icon: Calculator },
          { id: 'throws', label: 'Tactical Error & Throws', icon: ShieldAlert }
        ].map(tb => {
          const Icon = tb.icon;
          return (
            <button
              key={tb.id}
              onClick={() => setActiveSubTab(tb.id as any)}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
                activeSubTab === tb.id
                  ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tb.label}
            </button>
          );
        })}
      </div>

      <ReplayMatchLog data={data} theme={theme} title="Map replay history" description="Matches whose screenshot or replay evidence you accepted. The pool table and calculator below count every recorded match on each map, including ones entered by hand." />

      {/* VIEW: MAP POOL STATS */}
      {activeSubTab === 'stats' && (
        <div className="space-y-4">
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Compass className={`w-5 h-5 ${theme.text}`} />
            <h4 className="font-black text-sm uppercase tracking-wide">Map Pool Breakdown</h4>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1580px] text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[9px] uppercase tracking-widest text-gray-500"><th className="px-3 py-2" colSpan={4}>Map results</th><th className="border-l border-white/10 px-3 py-2 text-center" colSpan={2}>Side win rate</th><th className="border-l border-white/10 px-3 py-2 text-center" colSpan={6}>Long-term opening conversion · first three rounds of each side</th><th className="border-l border-white/10 px-3 py-2 text-center">Combat</th></tr>
                <tr className="border-b border-white/10 text-gray-500 uppercase font-bold">
                  <th className="py-3 px-3">Map</th><th className="py-3 px-3 text-center">Played</th><th className="py-3 px-3 text-center">W / L / D</th><th className="py-3 px-3 text-center">Win rate</th>
                  <th className="border-l border-white/10 py-3 px-3 text-center">ATT</th><th className="py-3 px-3 text-center">DEF</th>
                  <th className="border-l border-white/10 py-3 px-3 text-center">Pistol ATT</th><th className="py-3 px-3 text-center">Pistol DEF</th>
                  <th className="py-3 px-3 text-center">Anti-eco ATT</th><th className="py-3 px-3 text-center">Anti-eco DEF</th>
                  <th className="py-3 px-3 text-center">Bonus ATT</th><th className="py-3 px-3 text-center">Bonus DEF</th>
                  <th className="border-l border-white/10 py-3 px-3 text-center">Team K/D</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(Object.entries(mapStatsTable) as [string, any][]).map(([mName, s]) => {
                  const played = s.actualPlayed;
                  const weightedPlayed = s.played;
                  const winrate = weightedPlayed > 0 ? ((s.won / weightedPlayed) * 100).toFixed(0) : '0';
                  const sides = sideRoundsComplete(s);
                  const attWr = sides && (s.attW + s.attL) > 0 ? ((s.attW / (s.attW + s.attL)) * 100).toFixed(0) : null;
                  const defWr = sides && (s.defW + s.defL) > 0 ? ((s.defW / (s.defW + s.defL)) * 100).toFixed(0) : null;
                  const kd = teamKdComplete(s) && s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : '-';
                  const roundIntel = roundIntelligenceByMap.get(mName);
                  // A raw rate from a handful of maps is shown, but marked and left uncoloured.
                  const smallSample = metricSampleGate(played, minimumMapSamples).confidence === 'low';

                  return (
                    <tr key={mName} className="hover:bg-white/5">
                      <td className="py-3.5 px-3 font-bold text-white text-sm">{mName}</td>
                      <td className="py-3.5 px-3 text-center font-bold text-gray-300">{played}</td>
                      <td className="py-3.5 px-3 text-center text-gray-400">
                        <span className="text-emerald-400 font-bold">{s.actualWon}</span> / <span className="text-rose-400 font-bold">{s.actualLost}</span> / {s.actualDrawn}
                      </td>
                      <td className="py-3.5 px-3 text-center font-black text-sm">
                        <span className={weightedPlayed > 0 ? smallSample ? 'text-slate-300' : percentageTextClass(Number(winrate)) : 'text-slate-500'}>{weightedPlayed > 0 ? `${winrate}%` : '—'}</span>
                        {weightedPlayed > 0 && smallSample && <span className="mt-0.5 block text-[9px] font-semibold normal-case text-amber-300">Small sample · {played} of {minimumMapSamples} maps</span>}
                      </td>
                      <td className={`border-l border-white/5 py-3.5 px-3 text-center font-bold ${attWr !== null ? percentageTextClass(Number(attWr)) : 'text-slate-500'}`}>{attWr !== null ? `${attWr}%` : '—'}</td><td className={`py-3.5 px-3 text-center font-bold ${defWr !== null ? percentageTextClass(Number(defWr)) : 'text-slate-500'}`}>{defWr !== null ? `${defWr}%` : '—'}</td>
                      <td className={`border-l border-white/5 py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.pistolBySide.attack))}`}>{conversionText(roundIntel?.pistolBySide.attack)}</td><td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.pistolBySide.defense))}`}>{conversionText(roundIntel?.pistolBySide.defense)}</td>
                      <td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.postPistolBySide.attack))}`}>{conversionText(roundIntel?.postPistolBySide.attack)}</td><td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.postPistolBySide.defense))}`}>{conversionText(roundIntel?.postPistolBySide.defense)}</td>
                      <td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.earnedBonusBySide.attack))}`}>{conversionText(roundIntel?.earnedBonusBySide.attack)}</td><td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.earnedBonusBySide.defense))}`}>{conversionText(roundIntel?.earnedBonusBySide.defense)}</td>
                      <td className={`border-l border-white/5 py-3.5 px-3 text-center font-bold ${kd === '-' ? 'text-slate-500' : Number(kd) >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>{kd}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
          <MapRoundIntelligencePanel data={data} />
        </div>
      )}

      {/* VIEW: BEST MAP CALCULATOR */}
      {activeSubTab === 'calculator' && (
        <div className="space-y-6">
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Calculator className={`w-5 h-5 ${theme.text}`} />
                <div><h4 className="font-black text-sm uppercase tracking-wide">Experimental best-map score</h4><p className="mt-1 text-[10px] text-gray-500">A descriptive composite of team results, side conversions, economy and team K/D. Unknown and undersampled inputs are excluded, never scored as average.</p></div>
              </div>
              <span className="text-[10px] text-gray-500 font-mono uppercase bg-black/10 px-2 py-1 rounded">Shrink K: {data.settings.stats?.shrinkK || 10}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse font-mono text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-gray-500 uppercase font-bold">
                    <th className="py-3 px-4">Map Name</th>
                    <th className="py-3 px-4 text-center">Score Index</th>
                    <th className="py-3 px-4 text-center">Confidence Interval (95%)</th>
                    <th className="py-3 px-4 text-center">Sample (n)</th>
                    <th className="py-3 px-4 text-center">Raw WR</th>
                    <th className="py-3 px-4 text-center">ATT WR</th>
                    <th className="py-3 px-4 text-center">DEF WR</th>
                    <th className="py-3 px-4 text-center">Pistols</th>
                    <th className="py-3 px-4 text-center">Ecos</th>
                    <th className="py-3 px-4 text-center">K/D</th>
                    <th className="py-3 px-4 text-center">Player form</th>
                    <th className="py-3 px-4 text-center">Score evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {calculatedBestMaps.map((cm, idx) => (
                    <tr key={cm.map} className={`${idx === 0 && cm.score !== null ? 'bg-[#ff4655]/5 border border-[#ff4655]/10 font-bold' : ''} hover:bg-white/5 transition-all`}>
                      <td className="py-3.5 px-4 flex items-center gap-2 text-white text-sm">
                        {idx === 0 && cm.score !== null && <TrendingUp className="w-4 h-4 text-[#ff4655]" />}
                        {cm.map}
                      </td>
                      <td className="py-3.5 px-4 text-center font-black text-sm text-[#ff4655]">{cm.score ?? 'Not enough data'}</td>
                      <td className="py-3.5 px-4 text-center text-gray-400">{cm.ci ?? (cm.n > 0 ? 'Not published' : 'N/A (unplayed)')}</td>
                      <td className="py-3.5 px-4 text-center text-gray-300 font-bold">{cm.n}</td>
                      <td className={`py-3.5 px-4 text-center font-bold ${percentageTextClass(cm.wr)}`}>{cm.wr === null ? 'Unknown' : `${cm.wr}%`}</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.attWr)}`}>{cm.attWr === null ? 'Unknown' : `${cm.attWr}%`}</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.defWr)}`}>{cm.defWr === null ? 'Unknown' : `${cm.defWr}%`}</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.pistolWr)}`}>{cm.pistolWr === null ? 'Unknown' : `${cm.pistolWr}%`}</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.ecoWr)}`}>{cm.ecoWr === null ? 'Unknown' : `${cm.ecoWr}%`}</td>
                      <td className="py-3.5 px-4 text-center font-bold text-gray-300">{cm.kd ?? 'Unknown'}</td>
                      <td className={`py-3.5 px-4 text-center font-bold ${percentageTextClass(cm.playerPerformance)}`}>{cm.playerPerformance === null ? 'Unknown' : `${cm.playerPerformance}% · ${cm.contributingPlayers}P`}</td>
                      <td className="py-3.5 px-4 text-center"><details className="relative"><summary className="cursor-pointer whitespace-nowrap text-cyan-300">{cm.ledger.coveragePercent}% · {cm.ledger.confidence}</summary><div className="mt-2 min-w-[280px] space-y-1 rounded-lg border border-white/10 bg-slate-950 p-2 text-left text-[10px]">{cm.ledger.contributions.map(item => <p key={item.key} className="flex justify-between gap-3"><span className={item.status === 'observed' ? 'text-slate-300' : 'text-amber-300'}>{item.label} · {item.samples} samples{item.status === 'insufficient-sample' ? ` (needs ${cm.ledger.minimumSamples})` : item.status === 'unknown' ? ' (unknown)' : ''}</span><strong>{item.status === 'observed' ? `${item.weightedPoints.toFixed(1)} / ${item.weight}` : 'Excluded'}</strong></p>)}</div></details></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strategic Insight card */}
          {insight && (
            <div className={`p-5 rounded-xl border border-white/5 bg-gradient-to-r from-red-500/5 to-transparent space-y-2`}>
              <h5 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono">Experimental best-map insight</h5>
              <p className="text-xs text-gray-300 leading-relaxed font-mono">
                Your highest experimental score is <strong className="text-white font-black">{insight.map}</strong> (Score Index of {insight.score}, {insight.ledger.coveragePercent}% of weight observed){insight.wr !== null ? `, with a ${insight.wr}% raw win rate across ${insight.n} recorded instances` : ''}{insight.playerPerformance !== null ? ` and ${insight.playerPerformance}% equal-weight player form from ${insight.contributingPlayers} players` : ''}.
                {insight.kd !== null ? ` Team K/D on this map is ${insight.kd}.` : ''}
                {' '}Treat this as a descriptive, unvalidated pointer for veto discussion, not a recommendation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* VIEW: TACTICAL LOSS & THROW ANALYTICS */}
      {activeSubTab === 'throws' && (
        <div className="space-y-6">
          {/* Top Quick Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className={`p-4 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-1`}>
              <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block">Evidence-costly losses</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-500">{totalEvidenceLosses}</span>
                <span className="text-[9px] text-gray-500 font-mono">Auto-detected</span>
              </div>
            </div>

            <div className={`p-4 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-1`}>
              <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block">Primary Loss Driver</span>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-black text-white truncate max-w-[130px]" title={topReason.reason}>{topReason.reason}</span>
                <span className="text-xs text-rose-400 font-mono">({topReason.count})</span>
              </div>
            </div>

            <div className={`p-4 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-1`}>
              <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block">Highest costly-loss map</span>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-black text-white truncate">{topMapThrow.map}</span>
                <span className="text-xs text-rose-400 font-mono">({topMapThrow.count})</span>
              </div>
            </div>

            <div className={`p-4 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-1`}>
              <span className="text-[9px] uppercase font-bold text-gray-400 font-mono block">Coach-confirmed throws</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-amber-400">{totalThrownRounds}</span>
                <span className="text-[9px] text-gray-500 font-mono">Overpeek: {topOverpeeker.count ? `${topOverpeeker.name} (${topOverpeeker.count})` : 'not marked'}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Map-by-Map Loss breakdown */}
            <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-3`}>
              <h4 className="text-xs font-black uppercase font-mono text-[#ff4655] tracking-wider flex items-center gap-2">
                <Compass className="w-4 h-4 text-[#ff4655]" />
                Map Costly-Loss Densities
              </h4>
              <p className="text-[9.5px] text-gray-400 font-mono leading-relaxed">
                Automatic evidence flags economy punishments, failed post-pistol conversions, full-buy losses, and complete-event 2+ player advantage collapses. It does not assign player blame.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-mono text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-500 uppercase font-black text-[9px]">
                      <th className="py-2">Map</th>
                      <th className="py-2 text-center">Costly losses</th>
                      <th className="py-2 text-center">Confirmed throws</th>
                      <th className="py-2">Primary Loss Driver</th>
                      <th className="py-2">Prone Player</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {maps.map(mName => {
                      const stats = throwStats.mapThrows[mName] || { totalThrows: 0, evidenceLosses: 0, reasons: {}, players: {} };
                      
                      // Find top reason for this map
                      let topMapReason = '-';
                      let maxMapReasonCount = 0;
                      Object.entries(stats.reasons).forEach(([r, c]) => {
                        const count = c as number;
                        if (count > maxMapReasonCount) {
                          maxMapReasonCount = count;
                          topMapReason = r;
                        }
                      });

                      // Find top player for this map
                      let topMapPlayer = '-';
                      let maxMapPlayerCount = 0;
                      Object.entries(stats.players).forEach(([p, c]) => {
                        const count = c as number;
                        if (count > maxMapPlayerCount) {
                          maxMapPlayerCount = count;
                          topMapPlayer = p;
                        }
                      });

                      return (
                        <tr key={mName} className="hover:bg-white/5">
                          <td className="py-2 text-white font-bold">{mName}</td>
                          <td className="py-2 text-center">
                            <span className={`px-2 py-0.5 rounded font-black text-[10px] ${
                              stats.evidenceLosses > 4 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                              stats.evidenceLosses > 0 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                              'bg-gray-500/5 text-gray-600'
                            }`}>
                              {stats.evidenceLosses}
                            </span>
                          </td>
                          <td className="py-2 text-center text-gray-400">{stats.totalThrows}</td>
                          <td className="py-2 text-gray-300 text-[11px] truncate max-w-[120px]">{topMapReason}</td>
                          <td className="py-2 text-amber-400 text-[11px] font-bold">{topMapPlayer}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Roster error leaderboard */}
            <div className="space-y-6">
              {/* Leaderboard panel */}
              <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-3`}>
                <h4 className="text-xs font-black uppercase font-mono text-[#ff4655] tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#ff4655]" />
                  Roster Discipline Leaderboard
                </h4>
                <p className="text-[9.5px] text-gray-400 font-mono leading-relaxed">
                  Player blame is coach-confirmed only. Screenshots cannot prove positioning intent such as an overpeek.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-mono text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-gray-500 uppercase font-black text-[9px]">
                        <th className="py-2">Player</th>
                        <th className="py-2 text-center text-amber-400">Overpeeks</th>
                        <th className="py-2 text-center text-cyan-400">Failed Clutches</th>
                        <th className="py-2 text-center text-gray-400">Other</th>
                        <th className="py-2 text-center font-bold text-white">Total Issues</th>
                        <th className="py-2 text-right">Risk Level</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {Object.entries(throwStats.playerIssues).filter(([, row]: any) => row.total > 0)
                        .sort((a, b) => (b[1] as any).total - (a[1] as any).total)
                        .map(([pName, s]) => {
                          const stats = s as any;
                          let riskBadge = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                          let riskText = 'Disciplined';
                          if (stats.total > 4) {
                            riskBadge = 'bg-rose-500/10 text-rose-400 border border-rose-500/20 font-black';
                            riskText = 'High Risk';
                          } else if (stats.total > 0) {
                            riskBadge = 'bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold';
                            riskText = 'Moderate';
                          }

                          return (
                            <tr key={pName} className="hover:bg-white/5">
                              <td className="py-2 font-bold text-white">{pName}</td>
                              <td className="py-2 text-center text-amber-400">{stats.overpeeks}</td>
                              <td className="py-2 text-center text-cyan-400">{stats.failedClutches}</td>
                              <td className="py-2 text-center text-gray-500">{stats.otherThrows}</td>
                              <td className="py-2 text-center font-black text-white">{stats.total}</td>
                              <td className="py-2 text-right">
                                <span className={`px-2 py-0.5 rounded text-[9px] uppercase ${riskBadge}`}>
                                  {riskText}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      {Object.values(throwStats.playerIssues).every((row: any) => row.total === 0) && <tr><td colSpan={6} className="py-5 text-center text-[10px] text-gray-500">No coach-attributed player errors. Automatic evidence is shown in the map table without assigning blame.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Loss driving reasons */}
              <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-3`}>
                <h4 className="text-xs font-black uppercase font-mono text-gray-300 tracking-wider flex items-center gap-2">
                  <Skull className="w-4 h-4 text-rose-500 animate-pulse" />
                  Loss Driver Distribution (frequency)
                </h4>

                <div className="space-y-2 pt-1 font-mono text-xs">
                  {Object.entries(throwStats.reasonFrequency).length === 0 ? (
                    <p className="text-[10px] text-gray-500 text-center py-2">No automatic costly-loss pattern or coach-confirmed throw is available yet.</p>
                  ) : (
                    Object.entries(throwStats.reasonFrequency)
                      .sort((a, b) => (b[1] as number) - (a[1] as number))
                      .map(([reasonStr, c]) => {
                        const count = c as number;
                        const total = (Object.values(throwStats.reasonFrequency) as any[]).reduce((acc: number, curr: any) => acc + (curr as number), 0);
                        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                        return (
                          <div key={reasonStr} className="space-y-1">
                            <div className="flex justify-between text-[11px]">
                              <span className="font-bold text-white">{reasonStr}</span>
                              <span className="text-gray-400">{count} times ({pct}%)</span>
                            </div>
                            <div className="w-full bg-white/5 rounded-full h-1.5 border border-white/5">
                              <div 
                                className="bg-[#ff4655] h-full rounded-full" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Educational Tactical Note */}
          <div className="p-4 rounded-xl border border-white/5 bg-gradient-to-r from-red-500/5 to-transparent space-y-2 font-mono">
            <h5 className="text-[10px] uppercase font-black tracking-widest text-[#ff4655] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Tactical Loss & Discipline Diagnostics
            </h5>
            <p className="text-[10.5px] text-gray-300 leading-relaxed">
              Economy mismatches, failed post-pistol conversions, full-buy losses and complete-event man-advantage collapses are calculated automatically. Overpeeking, the responsible player, and tactical intent remain coach-confirmed because screenshots cannot prove them reliably.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
