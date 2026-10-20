import React, { useState, useMemo } from 'react';
import { TrackerData, Strat, StratRun } from '../types';
import { Compass, Calculator, BookOpen, Plus, Edit2, Trash2, CheckCircle2, XCircle, TrendingUp, HelpCircle, ShieldAlert, AlertTriangle, UserMinus, Skull, Sparkles, Users } from 'lucide-react';
import { knownResult, matchOutcome } from '../../lib/analyticsEvidence';
import { classifyAverageLoadout, classifyTeamEquipment } from '../../lib/scrimRoundAnalytics';
import ReplayMatchLog from './ReplayMatchLog';
import MapRoundIntelligencePanel from './MapRoundIntelligencePanel';
import { buildMapRoundIntelligence } from '../../lib/mapRoundAnalytics';
import { percentageTextClass } from '../utils/percentageColor';
import { reconcileObservedPlayerRows } from '../../lib/uiIntegration';
import { activeResourceNames, buildResourceCatalog, canonicalResourceName } from '../../lib/resourceCatalog';

interface ComponentProps {
  data: TrackerData;
  evidenceData?: TrackerData;
  theme: any;
  onUpsert: (sheet: string, row: any) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
}

export default function MapBestStats({ data, evidenceData = data, theme, onUpsert, onRemove }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const [activeSubTab, setActiveSubTab] = useState<'stats' | 'calculator' | 'throws' | 'playbook'>('stats');

  const libraryMaps = useMemo(() => {
    const names = new Map<string, string>();
    const add = (value: unknown) => {
      const display = String(value ?? '').trim();
      const key = display.toLowerCase();
      if (key && !names.has(key)) names.set(key, display);
    };
    buildResourceCatalog(evidenceData, 'map').forEach(entry => add(entry.name));
    (evidenceData.matches || []).forEach(match => add(match.map));
    (evidenceData.strats || []).forEach(strat => add(strat.map));
    return [...names.values()];
  }, [evidenceData]);

  // --- PLAYBOOK STATE ---
  const [selectedMap, setSelectedMap] = useState<string>(libraryMaps[0] || 'Ascent');
  const [selectedSide, setSelectedSide] = useState<string>('All');
  const [stratModalOpen, setStratModalOpen] = useState(false);
  const [editingStrat, setEditingStrat] = useState<Partial<Strat> | null>(null);

  // Strat Runs State
  const [runLogOpen, setRunLogOpen] = useState(false);
  const [selectedStratForRuns, setSelectedStratForRuns] = useState<Strat | null>(null);
  const [newRunResult, setNewRunResult] = useState('W');
  const [newRunReason, setNewRunReason] = useState('');

  const matches = data.matches || [];
  const playerStats = data.playerStats || [];
  const maps = useMemo(() => activeResourceNames(data, 'map'), [data]);
  const stratsList = evidenceData.strats || [];
  const stratRunsList = evidenceData.stratRuns || [];
  const roundIntelligenceByMap = useMemo(() => new Map(buildMapRoundIntelligence(matches, data.rounds || []).map(row => [row.map, row])), [matches, data.rounds]);
  const conversionText = (value?: { won: number; total: number }) => value?.total ? `${value.won}/${value.total} · ${Math.round(value.won / value.total * 100)}%` : '—';
  const conversionPercentage = (value?: { won: number; total: number }) => value?.total ? Math.round(value.won / value.total * 100) : null;

  // --- MAP STATS CALCULATOR ---
  const mapStatsTable = useMemo(() => {
    const statsConfig = data.settings.stats || { shrinkK: 10, lowSample: 15, decayEnabled: false, halfLifeDays: 120, rollingWindow: 10 };
    const table: Record<string, {
      played: number; won: number; lost: number; drawn: number;
      attW: number; attL: number; defW: number; defL: number;
      pistolW: number; pistolL: number;
      ecoW: number; ecoL: number;
      bonusW: number; bonusL: number;
      kills: number; deaths: number;
      actualPlayed: number; actualWon: number; actualLost: number; actualDrawn: number;
    }> = {};

    maps.forEach(m => {
      table[m] = {
        played: 0, won: 0, lost: 0, drawn: 0,
        attW: 0, attL: 0, defW: 0, defL: 0,
        pistolW: 0, pistolL: 0,
        ecoW: 0, ecoL: 0,
        bonusW: 0, bonusL: 0,
        kills: 0, deaths: 0,
        actualPlayed: 0, actualWon: 0, actualLost: 0, actualDrawn: 0
      };
    });

    maps.forEach(mapName => {
      // 1. Get all matches for this map
      const mapMatches = matches.filter(m => canonicalResourceName(data, 'map', m.map) === mapName);
      
      // 2. Sort them chronologically (oldest first, newest last)
      mapMatches.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      // 3. Apply rolling window if enabled
      let activeMatches = [...mapMatches];
      const rollingWindow = statsConfig.rollingWindow;
      if (rollingWindow && rollingWindow > 0 && activeMatches.length > rollingWindow) {
        activeMatches = activeMatches.slice(-rollingWindow);
      }

      const s = table[mapName];
      if (!s) return;

      // 4. Aggregate match data with exponential time-decay weight
      activeMatches.forEach(m => {
        let weight = 1.0;
        if (statsConfig.decayEnabled) {
          const diffMs = Math.max(0, new Date().getTime() - new Date(m.date).getTime());
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          const halfLife = statsConfig.halfLifeDays || 120;
          weight = Math.pow(0.5, diffDays / halfLife);
        }

        const outcome = matchOutcome(m);
        if (outcome !== null) {
          s.played += weight;
          s.actualPlayed++;
        }
        if (outcome === 'win') {
          s.won += weight;
          s.actualWon++;
        } else if (outcome === 'loss') {
          s.lost += weight;
          s.actualLost++;
        } else if (outcome === 'draw') {
          s.drawn += weight;
          s.actualDrawn++;
        }

        s.attW += m.attW * weight;
        s.attL += m.attL * weight;
        s.defW += m.defW * weight;
        s.defL += m.defL * weight;

        // The same round-backed conversions power Economy, Map Analysis and
        // exports. Legacy match labels without retained rounds stay unknown.
        const canonical = buildMapRoundIntelligence([{ ...m, roundAnalytics: undefined }], (data.rounds || []).filter(round => round.matchId === m.id))[0];
        if (canonical) {
          s.pistolW += canonical.pistol.won * weight;
          s.pistolL += (canonical.pistol.total - canonical.pistol.won) * weight;
          s.ecoW += canonical.postPistol.won * weight;
          s.ecoL += (canonical.postPistol.total - canonical.postPistol.won) * weight;
          s.bonusW += canonical.earnedBonus.won * weight;
          s.bonusL += (canonical.earnedBonus.total - canonical.earnedBonus.won) * weight;
        }

        // Sum player kills/deaths on this match
        playerStats.forEach(ps => {
          if (ps.matchId === m.id) {
            s.kills += (ps.kills || 0) * weight;
            s.deaths += (ps.deaths || 0) * weight;
          }
        });
      });
    });

    return table;
  }, [data, maps, matches, playerStats]);

  // --- BEST MAP CALCULATOR WEIGHTED ---
  const calculatedBestMaps = useMemo(() => {
    const weights = data.settings.weights || { mapWin: 25, attWin: 12.5, defWin: 12.5, pistol: 20, eco: 10, bonus: 10, kd: 10 };
    const statsConfig = data.settings.stats || { shrinkK: 10, lowSample: 15 };

    const playerPerformanceWeight = 15;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) + playerPerformanceWeight;

    return (Object.entries(mapStatsTable) as [string, any][]).map(([mapName, s]) => {
      const n = s.actualPlayed;
      const weightedPlayed = s.played;
      const rawWr = weightedPlayed > 0 ? (s.won / weightedPlayed) : 0.5;

      // Low sample shrinkage / regression to the mean (0.5)
      const shrinkK = statsConfig.shrinkK || 10;
      const wr = weightedPlayed > 0 ? (s.won + shrinkK * 0.5) / (weightedPlayed + shrinkK) : 0.5;

      const attWr = (s.attW + s.attL) > 0 ? (s.attW / (s.attW + s.attL)) : 0.5;
      const defWr = (s.defW + s.defL) > 0 ? (s.defW / (s.defW + s.defL)) : 0.5;

      const pistolTotal = s.pistolW + s.pistolL;
      const pistolWr = pistolTotal > 0 ? (s.pistolW / pistolTotal) : 0.5;

      const ecoTotal = s.ecoW + s.ecoL;
      const ecoWr = ecoTotal > 0 ? (s.ecoW / ecoTotal) : 0.5;

      const bonusTotal = s.bonusW + s.bonusL;
      const bonusWr = bonusTotal > 0 ? (s.bonusW / bonusTotal) : 0.5;

      const kdRatio = s.deaths > 0 ? (s.kills / s.deaths) : 1.0;
      // Map KD to a 0-1 scale, where 1.0 is 0.5, 1.5 is 0.75, 0.5 is 0.25, etc.
      const kdScore = Math.max(0, Math.min(1.0, kdRatio / 2.0));

      // Equal-weight current-player form prevents one high-volume fragger from
      // hiding a weak roster fit. Each player's reconciled map K/D contributes
      // once to the map score, alongside the existing team result factors.
      const mapMatchIds = new Set(matches.filter(match => canonicalResourceName(data, 'map', match.map) === mapName).map(match => match.id));
      const rowsByPlayer = new Map<string, typeof playerStats>();
      for (const row of playerStats.filter(row => mapMatchIds.has(row.matchId))) {
        const key = row.playerId || `name:${String(row.displayNameSnapshot || row.player || '').trim().toLocaleLowerCase()}`;
        rowsByPlayer.set(key, [...(rowsByPlayer.get(key) || []), row]);
      }
      const playerScores = [...rowsByPlayer.values()].map(rows => {
        const reconciled = reconcileObservedPlayerRows(rows);
        const kills = reconciled.reduce((sum, row) => sum + (typeof row.kills === 'number' ? row.kills : 0), 0);
        const deaths = reconciled.reduce((sum, row) => sum + (typeof row.deaths === 'number' ? row.deaths : 0), 0);
        return deaths > 0 ? Math.max(0, Math.min(1, (kills / deaths) / 2)) : kills > 0 ? 1 : null;
      }).filter((value): value is number => value !== null);
      const playerPerformanceScore = playerScores.length ? playerScores.reduce((sum, value) => sum + value, 0) / playerScores.length : 0.5;

      // Weighted score
      const score = (
        (wr * weights.mapWin) +
        (attWr * weights.attWin) +
        (defWr * weights.defWin) +
        (pistolWr * weights.pistol) +
        (ecoWr * weights.eco) +
        (bonusWr * weights.bonus) +
        (kdScore * weights.kd) +
        (playerPerformanceScore * playerPerformanceWeight)
      ) / (totalWeight || 1);

      // 95% Wilson Score Interval (highly accurate for small sample sizes and extreme rates)
      let ciLow = 0;
      let ciHigh = 0;
      if (n > 0) {
        const z = 1.96;
        const zSq = z * z;
        const factor = 1 + zSq / n;
        const center = (rawWr + zSq / (2 * n)) / factor;
        const spread = (z / factor) * Math.sqrt((rawWr * (1 - rawWr)) / n + zSq / (4 * n * n));
        ciLow = Math.max(0, center - spread);
        ciHigh = Math.min(1.0, center + spread);
      }

      return {
        map: mapName,
        score: Math.round(score * 1000) / 10,
        n,
        wr: Math.round(rawWr * 100),
        ci: `${Math.round(ciLow * 100)}% - ${Math.round(ciHigh * 100)}%`,
        attWr: Math.round(attWr * 100),
        defWr: Math.round(defWr * 100),
        pistolWr: Math.round(pistolWr * 100),
        ecoWr: Math.round(ecoWr * 100),
        bonusWr: Math.round(bonusWr * 100),
        kd: kdRatio.toFixed(2),
        playerPerformance: Math.round(playerPerformanceScore * 100),
        contributingPlayers: playerScores.length,
      };
    }).sort((a, b) => b.score - a.score);
  }, [mapStatsTable, data.settings.weights, data.settings.stats, matches, playerStats]);

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

  // --- PLAYBOOK STRAT COMPUTATION ---
  const filteredStrats = useMemo(() => {
    return stratsList.filter(s => {
      const matchMap = s.map.trim().toLowerCase() === selectedMap.trim().toLowerCase();
      const matchSide = selectedSide === 'All' || s.side === selectedSide;
      return matchMap && matchSide;
    });
  }, [stratsList, selectedMap, selectedSide]);

  const stratRunsStats = useMemo(() => {
    const stats: Record<string, { wins: number; losses: number; reason: string }> = {};
    stratsList.forEach(s => {
      stats[s.id] = { wins: 0, losses: 0, reason: '' };
    });

    stratRunsList.forEach((r) => {
      if (!stats[r.stratId]) return;
      if (r.result === 'W') stats[r.stratId].wins++;
      else {
        stats[r.stratId].losses++;
        if (r.reason) stats[r.stratId].reason = r.reason; // Capture last reason
      }
    });

    return stats;
  }, [stratsList, stratRunsList]);

  // --- PLAYBOOK MUTATIONS ---
  const handleOpenAddStrat = () => {
    setEditingStrat({
      id: '',
      map: selectedMap,
      side: 'Att',
      name: '',
      notes: '',
      active: 'TRUE'
    });
    setStratModalOpen(true);
  };

  const handleOpenEditStrat = (s: Strat) => {
    setEditingStrat({ ...s });
    setStratModalOpen(true);
  };

  const handleSaveStratSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStrat || !editingStrat.name) return;
    await onUpsert('Strats', editingStrat);
    setStratModalOpen(false);
    setEditingStrat(null);
  };

  const handleDeleteStrat = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this strategy and its execution runs history?')) return;
    await onRemove('Strats', id);
    if (selectedStratForRuns?.id === id) {
      setSelectedStratForRuns(null);
      setRunLogOpen(false);
    }
  };

  const handleOpenRunLog = (s: Strat) => {
    setSelectedStratForRuns(s);
    setNewRunResult('W');
    setNewRunReason('');
    setRunLogOpen(true);
  };

  const handleAddRunLogSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStratForRuns) return;

    const run: Partial<StratRun> = {
      id: '',
      stratId: selectedStratForRuns.id,
      matchId: '',
      date: new Date().toISOString().slice(0, 10),
      map: selectedStratForRuns.map,
      side: selectedStratForRuns.side,
      result: newRunResult,
      reason: newRunReason
    };

    await onUpsert('StratRuns', run);
    setNewRunReason('');
    // Refresh selections
  };

  const handleDeleteRunLog = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this run log record?')) return;
    await onRemove('StratRuns', id);
  };

  const runsForSelectedStrat = useMemo(() => {
    if (!selectedStratForRuns) return [];
    return stratRunsList.filter(sr => sr.stratId === selectedStratForRuns.id);
  }, [stratRunsList, selectedStratForRuns]);

  return (
    <div className="space-y-6">
      {/* Sub tabs bar */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
        {[
          { id: 'stats', label: 'Map Pool Stats', icon: Compass },
          { id: 'calculator', label: 'Best Map Calculator', icon: Calculator },
          { id: 'throws', label: 'Tactical Error & Throws', icon: ShieldAlert },
          { id: 'playbook', label: 'Playbook Strategy', icon: BookOpen }
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

      <ReplayMatchLog data={data} theme={theme} title="Map replay history" description="Accepted practice maps feed the pool table and calculator from this same reviewed match evidence." />

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
                  const attWr = (s.attW + s.attL) > 0 ? ((s.attW / (s.attW + s.attL)) * 100).toFixed(0) : '0';
                  const defWr = (s.defW + s.defL) > 0 ? ((s.defW / (s.defW + s.defL)) * 100).toFixed(0) : '0';
                  const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : '-';
                  const roundIntel = roundIntelligenceByMap.get(mName);

                  return (
                    <tr key={mName} className="hover:bg-white/5">
                      <td className="py-3.5 px-3 font-bold text-white text-sm">{mName}</td>
                      <td className="py-3.5 px-3 text-center font-bold text-gray-300">{played}</td>
                      <td className="py-3.5 px-3 text-center text-gray-400">
                        <span className="text-emerald-400 font-bold">{s.actualWon}</span> / <span className="text-rose-400 font-bold">{s.actualLost}</span> / {s.actualDrawn}
                      </td>
                      <td className="py-3.5 px-3 text-center font-black text-sm">
                        <span className={weightedPlayed > 0 ? percentageTextClass(Number(winrate)) : 'text-slate-500'}>{weightedPlayed > 0 ? `${winrate}%` : '—'}</span>
                      </td>
                      <td className={`border-l border-white/5 py-3.5 px-3 text-center font-bold ${(s.attW + s.attL) > 0 ? percentageTextClass(Number(attWr)) : 'text-slate-500'}`}>{(s.attW + s.attL) > 0 ? `${attWr}%` : '—'}</td><td className={`py-3.5 px-3 text-center font-bold ${(s.defW + s.defL) > 0 ? percentageTextClass(Number(defWr)) : 'text-slate-500'}`}>{(s.defW + s.defL) > 0 ? `${defWr}%` : '—'}</td>
                      <td className={`border-l border-white/5 py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.pistolBySide.attack))}`}>{conversionText(roundIntel?.pistolBySide.attack)}</td><td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.pistolBySide.defense))}`}>{conversionText(roundIntel?.pistolBySide.defense)}</td>
                      <td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.postPistolBySide.attack))}`}>{conversionText(roundIntel?.postPistolBySide.attack)}</td><td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.postPistolBySide.defense))}`}>{conversionText(roundIntel?.postPistolBySide.defense)}</td>
                      <td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.earnedBonusBySide.attack))}`}>{conversionText(roundIntel?.earnedBonusBySide.attack)}</td><td className={`py-3.5 px-3 text-center ${percentageTextClass(conversionPercentage(roundIntel?.earnedBonusBySide.defense))}`}>{conversionText(roundIntel?.earnedBonusBySide.defense)}</td>
                      <td className={`border-l border-white/5 py-3.5 px-3 text-center font-bold ${Number(kd) >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>{kd}</td>
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
                <div><h4 className="font-black text-sm uppercase tracking-wide">Esports Weighted Best Map Rating</h4><p className="mt-1 text-[10px] text-gray-500">Team results, side conversions, economy, team K/D and equal-weight player performance per map.</p></div>
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {calculatedBestMaps.map((cm, idx) => (
                    <tr key={cm.map} className={`${idx === 0 ? 'bg-[#ff4655]/5 border border-[#ff4655]/10 font-bold' : ''} hover:bg-white/5 transition-all`}>
                      <td className="py-3.5 px-4 flex items-center gap-2 text-white text-sm">
                        {idx === 0 && <TrendingUp className="w-4 h-4 text-[#ff4655]" />}
                        {cm.map}
                      </td>
                      <td className="py-3.5 px-4 text-center font-black text-sm text-[#ff4655]">{cm.score}</td>
                      <td className="py-3.5 px-4 text-center text-gray-400">{cm.n > 0 ? cm.ci : 'N/A (unplayed)'}</td>
                      <td className="py-3.5 px-4 text-center text-gray-300 font-bold">{cm.n}</td>
                      <td className={`py-3.5 px-4 text-center font-bold ${percentageTextClass(cm.wr)}`}>{cm.wr}%</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.attWr)}`}>{cm.attWr}%</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.defWr)}`}>{cm.defWr}%</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.pistolWr)}`}>{cm.pistolWr}%</td>
                      <td className={`py-3.5 px-4 text-center ${percentageTextClass(cm.ecoWr)}`}>{cm.ecoWr}%</td>
                      <td className="py-3.5 px-4 text-center font-bold text-gray-300">{cm.kd}</td>
                      <td className={`py-3.5 px-4 text-center font-bold ${percentageTextClass(cm.contributingPlayers ? cm.playerPerformance : null)}`}>{cm.contributingPlayers ? `${cm.playerPerformance}% · ${cm.contributingPlayers}P` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strategic Insight card */}
          {calculatedBestMaps.length > 0 && (
            <div className={`p-5 rounded-xl border border-white/5 bg-gradient-to-r from-red-500/5 to-transparent space-y-2`}>
              <h5 className="text-xs uppercase font-black tracking-widest text-[#ff4655] font-mono">Performance vs. Play Rate Insights</h5>
              <p className="text-xs text-gray-300 leading-relaxed font-mono">
                Your highest-rated map is <strong className="text-white font-black">{calculatedBestMaps[0].map}</strong> (Score Index of {calculatedBestMaps[0].score}), combining a {calculatedBestMaps[0].wr}% raw win rate across {calculatedBestMaps[0].n} recorded instances with {calculatedBestMaps[0].contributingPlayers ? `${calculatedBestMaps[0].playerPerformance}% equal-weight player form from ${calculatedBestMaps[0].contributingPlayers} players` : 'neutral player-form evidence while individual samples are unavailable'}.
                {Number(calculatedBestMaps[0].kd) >= 1.1 ? ` Strong team KD ratio of ${calculatedBestMaps[0].kd} on this map suggests robust map geometry familiarity & clean defensive anchor rotations.` : ''} 
                We highly recommend prioritizing picking <strong className="text-white">{calculatedBestMaps[0].map}</strong> in veto procedures when actor sequence allows, while continuing to hold defensive strategies on weaker pools.
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

      {/* VIEW: PLAYBOOK STRATEGY */}
      {activeSubTab === 'playbook' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left panel map & side controllers */}
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4 lg:col-span-1 h-fit`}>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Filter Map</label>
              <select
                value={selectedMap}
                onChange={e => setSelectedMap(e.target.value)}
                className="w-full p-2 bg-black/20 text-white rounded border border-white/10 text-xs font-bold"
              >
                {libraryMaps.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Side</label>
              <div className="flex flex-col gap-1 text-xs">
                {['All', 'Att', 'Def', 'Retake'].map(sd => (
                  <button
                    key={sd}
                    onClick={() => setSelectedSide(sd)}
                    className={`w-full text-left p-2 rounded transition-all font-mono font-bold ${
                      selectedSide === sd
                        ? 'bg-[#ff4655]/10 border-l-4 border-[#ff4655] text-[#ff4655]'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {sd}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleOpenAddStrat}
              className="w-full py-2 bg-white/5 hover:bg-white/10 text-[10px] tracking-widest font-black uppercase text-white border border-white/10 rounded-lg flex items-center justify-center gap-1.5 transition-all"
            >
              <Plus className="w-4 h-4" /> NEW STRAT
            </button>
          </div>

          {/* Strats table / lists */}
          <div className="lg:col-span-3 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredStrats.map((st) => {
                const sStats = stratRunsStats[st.id] || { wins: 0, losses: 0, reason: '' };
                const total = sStats.wins + sStats.losses;
                const winrate = total > 0 ? ((sStats.wins / total) * 100).toFixed(0) : '0';

                return (
                  <div key={st.id} className="p-5 bg-white/5 border border-white/5 rounded-xl flex flex-col justify-between group relative shadow-lg">
                    <div className="absolute right-4 top-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenEditStrat(st)}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteStrat(st.id)}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase font-mono ${
                          st.side === 'Att' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        }`}>
                          {st.side}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono uppercase font-bold">{st.map}</span>
                      </div>

                      <div>
                        <h5 className="text-base font-black tracking-tight leading-snug">{st.name}</h5>
                        {st.notes && <p className="text-xs text-gray-400 mt-1 font-mono leading-relaxed">{st.notes}</p>}
                      </div>
                    </div>

                    <div className="mt-5 pt-3 border-t border-white/5 flex justify-between items-center font-mono">
                      <div className="text-[10px] text-gray-400">
                        Runs: <span className="text-emerald-400 font-bold">{sStats.wins}W</span> - <span className="text-rose-400 font-bold">{sStats.losses}L</span> (<span className={total > 0 ? percentageTextClass(Number(winrate)) : 'text-slate-500'}>{total > 0 ? `${winrate}% WR` : '—'}</span>)
                      </div>

                      <button
                        onClick={() => handleOpenRunLog(st)}
                        className="px-2.5 py-1 text-[9px] font-bold rounded bg-white/5 border border-white/10 hover:bg-white/10 text-white uppercase"
                      >
                        Run Logs
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredStrats.length === 0 && (
                <div className="col-span-full py-16 text-center text-gray-500 border border-dashed border-white/5 rounded-xl font-mono text-xs">
                  No strategies added for {selectedMap} ({selectedSide} side).
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- ADD / EDIT STRAT MODAL --- */}
      {stratModalOpen && editingStrat && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <form onSubmit={handleSaveStratSubmit} className={`w-full max-w-md p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingStrat.id ? 'EDIT STRATEGY' : 'ADD NEW STRATEGY'}
              </h4>
              <button
                type="button"
                onClick={() => setStratModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Map</label>
                <select
                  value={editingStrat.map}
                  onChange={e => setEditingStrat({ ...editingStrat, map: e.target.value })}
                  className="w-full p-2.5 bg-black/20 text-white rounded border border-white/10 text-xs font-bold"
                >
                  {libraryMaps.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Side</label>
                <select
                  value={editingStrat.side}
                  onChange={e => setEditingStrat({ ...editingStrat, side: e.target.value })}
                  className="w-full p-2.5 bg-black/20 text-white rounded border border-white/10 text-xs font-bold"
                >
                  <option value="Att">Att (Attack)</option>
                  <option value="Def">Def (Defense)</option>
                  <option value="Retake">Retake</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Strategy Name</label>
              <input
                type="text"
                required
                placeholder="e.g. A fast rush with Neon stun"
                value={editingStrat.name}
                onChange={e => setEditingStrat({ ...editingStrat, name: e.target.value })}
                className="w-full p-2.5 bg-black/20 text-white rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Setup / Play Details</label>
              <textarea
                rows={4}
                placeholder="List positions, agents, default util timing sequence, backup plans..."
                value={editingStrat.notes}
                onChange={e => setEditingStrat({ ...editingStrat, notes: e.target.value })}
                className="w-full p-2.5 bg-black/20 text-white rounded border border-white/10 text-xs font-mono"
              />
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setStratModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white font-mono`}
              >
                SAVE STRAT
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- STRAT RUN LOGS SEQUENCE DIALOG --- */}
      {runLogOpen && selectedStratForRuns && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className={`w-full max-w-2xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div>
                <h4 className="text-lg font-black tracking-tight uppercase">Strategy execution history</h4>
                <p className="text-xs text-gray-400 font-mono">{selectedStratForRuns.name} ({selectedStratForRuns.map} {selectedStratForRuns.side})</p>
              </div>
              <button
                onClick={() => setRunLogOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            {/* Quick record run log form */}
            <form onSubmit={handleAddRunLogSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-black/20 p-3.5 rounded-xl border border-white/5 items-end">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-black text-gray-400 font-mono">Result</label>
                <select
                  value={newRunResult}
                  onChange={e => setNewRunResult(e.target.value)}
                  className="w-full p-2 bg-black text-white border border-white/10 rounded text-xs"
                >
                  <option value="W">W (Success)</option>
                  <option value="L">L (Failure)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] uppercase font-black text-gray-400 font-mono">Fail Reason / Split</label>
                <input
                  type="text"
                  placeholder="e.g. missed block, bad trade"
                  value={newRunReason}
                  onChange={e => setNewRunReason(e.target.value)}
                  className="w-full p-2 bg-black text-white border border-white/10 rounded text-xs"
                />
              </div>

              <button
                type="submit"
                className={`w-full py-2 ${theme.primaryBg} text-white font-mono font-bold text-xs rounded`}
              >
                RECORD RUN
              </button>
            </form>

            {/* Logs List */}
            <div className="space-y-2 max-h-[250px] overflow-y-auto font-mono text-[11px] pr-1">
              {runsForSelectedStrat.map((r) => (
                <div key={r.id} className="flex justify-between items-center p-2.5 bg-white/5 border border-white/5 rounded-lg">
                  <div className="flex items-center gap-2">
                    {r.result === 'W' ? (
                      <CheckCircle2 className="w-4.5 h-4.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4.5 h-4.5 text-rose-500 shrink-0" />
                    )}
                    <div>
                      <span className="text-white text-xs font-bold">{r.date}</span>
                      {r.reason && <p className="text-gray-400 text-[10px] mt-0.5">Fail: {r.reason}</p>}
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteRunLog(r.id)}
                    className="p-1 rounded text-gray-500 hover:text-rose-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {runsForSelectedStrat.length === 0 && (
                <p className="text-center py-6 text-gray-500 text-xs font-mono">No execution runs logged for this strategy yet.</p>
              )}
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setRunLogOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
