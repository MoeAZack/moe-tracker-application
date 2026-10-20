import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Award, Layers, Users } from 'lucide-react';
import { percentageTextClass } from '../utils/percentageColor';
import { matchOutcome } from '../../lib/analyticsEvidence';
import { AgentPortrait, MapThumbnail } from './ValorantMedia';
import { activeResourceNames, canonicalResourceName } from '../../lib/resourceCatalog';

interface ComponentProps {
  data: TrackerData;
  theme: any;
}

export function compositionMatchOutcome(match: any): 'win' | 'loss' | null {
  const outcome = matchOutcome(match);
  return outcome === 'win' || outcome === 'loss' ? outcome : null;
}

export default function TeamCompositions({ data, theme }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const matches = data.matches || [];
  const playerStats = data.playerStats || [];
  const maps = useMemo(() => activeResourceNames(data, 'map'), [data]);
  const agentsList = useMemo(() => activeResourceNames(data, 'agent'), [data]);
  const activeAgentKeys = useMemo(() => new Set(agentsList.map(agent => agent.toLocaleLowerCase('en'))), [agentsList]);

  // --- MAP COMPOSITIONS ANALYTICS ---
  const mapCompositions = useMemo(() => {
    // MapName -> Sorted Composition String -> { wins, losses, agents: [] }
    const comps: Record<string, Record<string, { wins: number; losses: number; agents: string[] }>> = {};

    maps.forEach(m => {
      comps[m] = {};
    });

    matches.forEach((m) => {
      const mapName = canonicalResourceName(data, 'map', m.map);
      if (!mapName || !comps[mapName]) return;
      const outcome = compositionMatchOutcome(m);
      if (!outcome) return;

      // Find the 5 players stats for this match
      const mStats = playerStats.filter(ps => ps.matchId === m.id);
      if (mStats.length === 0) return;

      // Collect the agents and sort them alphabetically
      const agents = mStats.map(s => canonicalResourceName(data, 'agent', s.agent)).filter((agent): agent is string => Boolean(agent && activeAgentKeys.has(agent.toLocaleLowerCase('en')))).sort();
      if (agents.length === 0) return;

      const compKey = agents.join(', ');
      if (!comps[mapName][compKey]) {
        comps[mapName][compKey] = { wins: 0, losses: 0, agents };
      }

      if (outcome === 'win') comps[mapName][compKey].wins++;
      else comps[mapName][compKey].losses++;
    });

    return comps;
  }, [data, maps, matches, playerStats, activeAgentKeys]);

  // --- AGENT PICK RATES & PERFORMANCE ---
  const agentPerformance = useMemo(() => {
    const stats: Record<string, { played: number; wins: number; losses: number }> = {};
    
    agentsList.forEach(a => {
      stats[a] = { played: 0, wins: 0, losses: 0 };
    });

    playerStats.forEach((ps) => {
      const agentName = canonicalResourceName(data, 'agent', ps.agent);
      if (!agentName || !stats[agentName]) return;
      const match = matches.find(m => m.id === ps.matchId);
      if (!match) return;

      const s = stats[agentName];
      s.played++;
      const outcome = compositionMatchOutcome(match);
      if (outcome === 'win') s.wins++;
      else if (outcome === 'loss') s.losses++;
    });

    const totalMatches = matches.length;

    return Object.entries(stats)
      .map(([agentName, s]) => {
        const decided = s.wins + s.losses;
        const wr = decided > 0 ? (s.wins / decided) * 100 : 0;
        const pickRate = totalMatches > 0 ? (s.played / (totalMatches * 5)) * 100 : 0; // Out of total individual slot fills (5 slots per match)
        return {
          agent: agentName,
          played: s.played,
          wins: s.wins,
          losses: s.losses,
          winRate: Math.round(wr),
          pickRate: Math.round(pickRate)
        };
      })
      .sort((a, b) => b.played - a.played);
  }, [data, agentsList, playerStats, matches]);

  return (
    <div className="space-y-6">
      {/* Page description header */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Agent Pick Rates list */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Users className={`w-5 h-5 ${theme.text}`} />
            <h4 className="font-black text-sm uppercase tracking-wide">Individual Agent meta Performance</h4>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-white/10 text-gray-500 uppercase font-bold">
                  <th className="py-2.5 px-3">Agent</th>
                  <th className="py-2.5 px-3 text-center">Played</th>
                  <th className="py-2.5 px-3 text-center">W - L</th>
                  <th className="py-2.5 px-3 text-center">Win Rate %</th>
                  <th className="py-2.5 px-3 text-center">Pick Rate %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {agentPerformance.map((ap) => (
                  <tr key={ap.agent} className="hover:bg-white/5">
                    <td className="py-2.5 px-3 font-bold text-white text-xs"><span className="flex items-center gap-2"><AgentPortrait name={ap.agent} className="h-9 w-9 rounded-lg" />{ap.agent}</span></td>
                    <td className="py-2.5 px-3 text-center font-bold text-gray-300">{ap.played}</td>
                    <td className="py-2.5 px-3 text-center text-gray-400">
                      <span className="text-emerald-400 font-bold">{ap.wins}W</span> - <span className="text-rose-400 font-bold">{ap.losses}L</span>
                    </td>
                    <td className="py-2.5 px-3 text-center font-black text-sm">
                      <span className={percentageTextClass(ap.winRate)}>{ap.winRate}%</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-400">{ap.pickRate}%</td>
                  </tr>
                ))}
                {agentPerformance.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-gray-500">No agent metrics recorded. Record some matches first!</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Map Compositions details */}
        <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} space-y-4`}>
          <div className="flex items-center gap-2 mb-2">
            <Layers className={`w-5 h-5 ${theme.text}`} />
            <h4 className="font-black text-sm uppercase tracking-wide">Compositions by Map</h4>
          </div>

          <div className="space-y-4">
            {Object.entries(mapCompositions).map(([mapName, comps]) => {
              const compEntries = Object.entries(comps);
              return (
                <div key={mapName} className="space-y-2 rounded-xl border border-white/[0.07] bg-black/10 p-3">
                  <div className="flex items-center gap-3"><MapThumbnail name={mapName} className="h-12 w-20 rounded-lg" /><div><h5 className="text-xs uppercase font-black text-white font-mono">{mapName}</h5><p className="mt-0.5 text-[9px] text-gray-500">{compEntries.length ? `${compEntries.length} recorded composition${compEntries.length === 1 ? '' : 's'}` : 'Active map · no composition evidence yet'}</p></div></div>
                  <div className="space-y-2 font-mono text-[11px]">
                    {compEntries.map(([compKey, c]) => {
                      const total = c.wins + c.losses;
                      const wr = total > 0 ? Math.round((c.wins / total) * 100) : 0;
                      return (
                        <div key={compKey} className="flex justify-between items-center bg-black/10 p-2.5 rounded border border-white/5">
                          <div className="flex flex-wrap gap-1.5 max-w-[75%]">
                            {c.agents.map((ag) => (
                              <span key={ag} className="inline-flex items-center gap-1 rounded-lg border border-white/5 bg-white/5 py-1 pl-1 pr-2 text-[9px] font-bold text-gray-300">
                                <AgentPortrait name={ag} className="h-7 w-7 rounded-md" />{ag}
                              </span>
                            ))}
                          </div>
                          <div className="text-right text-[10px] shrink-0">
                            <span className="text-emerald-400 font-bold">{c.wins}W</span> - <span className="text-rose-400 font-bold">{c.losses}L</span> 
                            <p className={`${percentageTextClass(wr)} font-bold text-[9px]`}>{wr}% WR ({total} games)</p>
                          </div>
                        </div>
                      );
                    })}
                    {compEntries.length === 0 && <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center text-[10px] text-gray-500">This map is ready for its first logged composition.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
