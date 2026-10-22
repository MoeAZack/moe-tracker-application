import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Award, Layers, Users } from 'lucide-react';
import { percentageTextClass } from '../utils/percentageColor';
import { matchOutcome } from '../../lib/analyticsEvidence';
import { AgentPortrait, MapThumbnail } from './ValorantMedia';
import { activeResourceNames, canonicalResourceName } from '../../lib/resourceCatalog';
import { DEFAULT_MINIMUM_METRIC_SAMPLES, publishRate, type MetricPublication } from '../../lib/metricTrust';

interface ComponentProps {
  data: TrackerData;
  theme: any;
}

export function compositionMatchOutcome(match: any): 'win' | 'loss' | null {
  const outcome = matchOutcome(match);
  return outcome === 'win' || outcome === 'loss' ? outcome : null;
}

const percent = (publication: MetricPublication) => publication.value === null ? null : Math.round(publication.value);

/** Agent win and pick rates: undecided matches and empty agent slots are never counted as losses or picks. */
export function buildAgentPerformance(data: TrackerData, agentsList: readonly string[], minimumSamples: number) {
  const matches = new Map((data.matches || []).map(match => [match.id, match]));
  const stats: Record<string, { played: number; wins: number; losses: number }> = Object.fromEntries(agentsList.map(agent => [agent, { played: 0, wins: 0, losses: 0 }]));
  let knownSlots = 0;
  for (const row of data.playerStats || []) {
    const match = matches.get(row.matchId); if (!match) continue;
    const agentName = canonicalResourceName(data, 'agent', row.agent); if (!agentName) continue;
    knownSlots += 1; const item = stats[agentName]; if (!item) continue; item.played += 1;
    const outcome = compositionMatchOutcome(match); if (outcome === 'win') item.wins += 1; else if (outcome === 'loss') item.losses += 1;
  }
  return Object.entries(stats).map(([agent, item]) => {
    const decided = item.wins + item.losses;
    const winRate = publishRate({ numerator: item.wins, denominator: decided, observed: decided, expected: decided, minimumSamples });
    const pickRate = publishRate({ numerator: item.played, denominator: knownSlots, observed: knownSlots, expected: knownSlots, minimumSamples: 1 });
    return { agent, played: item.played, wins: item.wins, losses: item.losses, winRate: percent(winRate), winRatePublication: winRate, pickRate: percent(pickRate) };
  }).sort((a, b) => b.played - a.played);
}

/** A composition is the full five-agent lineup of one decided match; partial lineups are not compositions. */
export function buildMapCompositions(data: TrackerData, maps: readonly string[], activeAgentKeys: ReadonlySet<string>, minimumSamples: number) {
  const comps: Record<string, Record<string, { wins: number; losses: number; agents: string[]; winRate: number | null; publication: MetricPublication }>> = Object.fromEntries(maps.map(map => [map, {}]));
  for (const match of data.matches || []) {
    const mapName = canonicalResourceName(data, 'map', match.map); if (!mapName || !comps[mapName]) continue;
    const outcome = compositionMatchOutcome(match); if (!outcome) continue;
    const rows = (data.playerStats || []).filter(row => row.matchId === match.id);
    const agents = rows.map(row => canonicalResourceName(data, 'agent', row.agent)).filter((agent): agent is string => Boolean(agent && activeAgentKeys.has(agent.toLocaleLowerCase('en')))).sort();
    if (rows.length !== 5 || agents.length !== 5) continue;
    const key = agents.join(', '); const item = comps[mapName][key] ||= { wins: 0, losses: 0, agents, winRate: null, publication: publishRate({ numerator: null, denominator: null, observed: 0, expected: 0 }) };
    if (outcome === 'win') item.wins += 1; else item.losses += 1;
  }
  for (const byMap of Object.values(comps)) for (const item of Object.values(byMap)) { const games = item.wins + item.losses; item.publication = publishRate({ numerator: item.wins, denominator: games, observed: games, expected: games, minimumSamples }); item.winRate = percent(item.publication); }
  return comps;
}

export default function TeamCompositions({ data, theme }: ComponentProps) {
  const isLight = data.settings.theme === 'daylight';
  const matches = data.matches || [];
  const playerStats = data.playerStats || [];
  const maps = useMemo(() => activeResourceNames(data, 'map'), [data]);
  const agentsList = useMemo(() => activeResourceNames(data, 'agent'), [data]);
  const activeAgentKeys = useMemo(() => new Set(agentsList.map(agent => agent.toLocaleLowerCase('en'))), [agentsList]);

  const minimumSamples = data.settings.stats?.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES;
  const mapCompositions = useMemo(() => buildMapCompositions(data, maps, activeAgentKeys, minimumSamples), [data, maps, activeAgentKeys, minimumSamples]);
  const agentPerformance = useMemo(() => buildAgentPerformance(data, agentsList, minimumSamples), [data, agentsList, minimumSamples]);
  const mapEntries = Object.entries(mapCompositions);
  const mapsWithoutComps = mapEntries.filter(([, comps]) => Object.keys(comps).length === 0).map(([mapName]) => mapName);

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
                      <span className={percentageTextClass(ap.winRate)}>{ap.winRate === null ? (ap.wins + ap.losses ? `Needs ${ap.winRatePublication.minimumSamples}` : 'Unknown') : `${ap.winRate}%`}</span>
                    </td>
                    <td className="py-2.5 px-3 text-center text-gray-400">{ap.pickRate === null ? 'Unknown' : `${ap.pickRate}%`}</td>
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

          {/* One empty state instead of an empty card per map. */}
          {mapsWithoutComps.length === mapEntries.length && <p className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-xs text-gray-500">No compositions logged yet. A map appears here once a match on it has all five agents recorded.</p>}
          <div className="space-y-4">
            {mapEntries.filter(([, comps]) => Object.keys(comps).length > 0).map(([mapName, comps]) => {
              const compEntries = Object.entries(comps);
              return (
                <div key={mapName} className="space-y-2 rounded-xl border border-white/[0.07] bg-black/10 p-3">
                  <div className="flex items-center gap-3"><MapThumbnail name={mapName} className="h-12 w-20 rounded-lg" /><div><h5 className="text-xs uppercase font-black text-white font-mono">{mapName}</h5><p className="mt-0.5 text-[9px] text-gray-500">{compEntries.length ? `${compEntries.length} recorded composition${compEntries.length === 1 ? '' : 's'}` : 'Active map · no composition evidence yet'}</p></div></div>
                  <div className="space-y-2 font-mono text-[11px]">
                    {compEntries.map(([compKey, c]) => {
                      const total = c.wins + c.losses;
                      const wr = c.winRate;
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
                            <p className={`${percentageTextClass(wr)} font-bold text-[9px]`}>{wr === null ? `WR needs ${c.publication.minimumSamples} games` : `${wr}% WR`} ({total} games)</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {mapsWithoutComps.length > 0 && mapsWithoutComps.length < mapEntries.length && <p className="text-[10px] text-gray-500">No composition logged yet on {mapsWithoutComps.join(', ')}.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
