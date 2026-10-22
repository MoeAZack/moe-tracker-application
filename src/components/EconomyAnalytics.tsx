import React, { useMemo } from 'react';
import { TrackerData } from '../types';
import { Coins, TrendingUp, Shield, Swords } from 'lucide-react';
import { knownResult, knownRoundSide } from '../../lib/analyticsEvidence';
import ReplayMatchLog from './ReplayMatchLog';
import {
  buildPlayerScreenshotMetrics,
  classifyAverageLoadout,
  classifyTeamEquipment,
  combinePlayerScreenshotMetrics,
  combineStoredScreenshotMetrics,
} from '../../lib/scrimRoundAnalytics';
import { buildMapRoundIntelligence } from '../../lib/mapRoundAnalytics';
import { percentageBarClass, percentageTextClass } from '../utils/percentageColor';
import { canonicalValorantWeapon } from '../../lib/valorantCatalog';
import { MapThumbnail, WeaponThumbnail } from './ValorantMedia';
import { activeResourceNames } from '../../lib/resourceCatalog';
import { summarizeRoundAdvantages } from '../../lib/roundAdvantage';
import { buildContextualWeaponOutcomes } from '../../lib/contextualEconomy';
import { publishKast, screenshotKastEvidence } from '../../lib/metricTrust';

interface Props {
  data: TrackerData;
  theme: any;
  focusedMatchId?: string | null;
  focusedRoundNo?: number | null;
}

const pct = (won: number, total: number) => (total > 0 ? Math.round((won / total) * 100) : 0);
const normalizedName = (value: unknown) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('en');

export function excludeArchivedScreenshotPlayers<T extends { identity: string; displayName: string }>(
  players: readonly T[],
  rosterPlayers: TrackerData['rosterPlayers'],
) {
  // An empty active roster means the coach is reviewing historical match
  // evidence, not declaring that every participant should disappear. Keep the
  // evidence rows in that state; otherwise one OCR spelling can leak through
  // while correctly spelled teammates are hidden.
  if (!(rosterPlayers || []).some(player => !player.retiredAt)) return [...players];
  const retiredIds = new Set((rosterPlayers || []).filter(player => player.retiredAt).map(player => player.id));
  const retiredNames = new Set((rosterPlayers || []).filter(player => player.retiredAt).map(player => normalizedName(player.displayName)));
  return players.filter(player => !retiredIds.has(player.identity) && !retiredNames.has(normalizedName(player.displayName)));
}

export interface WeaponRoundOutcome {
  weapon: string;
  rounds: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  players: number;
  winRate: number;
}

export type WeaponEconomyContext = 'pistol' | 'post-pistol' | 'bonus' | 'eco' | 'low' | 'mid' | 'full' | 'unknown';
export interface WeaponOutcomeGroup {
  id: WeaponEconomyContext;
  label: string;
  detail: string;
  outcomes: WeaponRoundOutcome[];
}
const WEAPON_CONTEXTS: Array<{ id: WeaponEconomyContext; label: string; detail: string }> = [
  { id: 'pistol', label: 'Pistol rounds', detail: 'Opening round of each regulation half.' },
  { id: 'post-pistol', label: 'Post-pistol buys', detail: 'Round after a pistol win; anti-eco and conversion choices.' },
  { id: 'bonus', label: 'Bonus rounds', detail: 'Third-round carry-over after winning pistol and conversion.' },
  { id: 'eco', label: 'Eco rounds', detail: 'Team economy below the low-buy threshold.' },
  { id: 'low', label: 'Low / force buys', detail: 'Low equipment or an explicitly logged force buy.' },
  { id: 'mid', label: 'Mid / half buys', detail: 'Mixed or half-buy equipment, useful for Bulldog vs Guardian comparisons.' },
  { id: 'full', label: 'Full buys', detail: 'Full team equipment, useful for Operator vs rifle comparisons.' },
  { id: 'unknown', label: 'Unknown economy', detail: 'Weapon evidence exists, but the team buy context is unavailable.' },
];

/** Aggregate confirmed player-round weapon observations against the team round
 * result. These are equipped-weapon associations, never an invented purchase or
 * a claim that the weapon caused the win. */
export function buildWeaponRoundOutcomes(
  players: ReadonlyArray<{ displayName: string; weapons: ReadonlyArray<{ weapon: string; rounds: number; wins: number; kills: number; deaths: number }> }>,
): WeaponRoundOutcome[] {
  const accumulator = new Map<string, Omit<WeaponRoundOutcome, 'players' | 'winRate'> & { playerNames: Set<string> }>();
  for (const player of players)
    for (const observation of player.weapons || []) {
      const weapon = canonicalValorantWeapon(observation.weapon);
      const rounds = Math.max(0, Number(observation.rounds) || 0);
      if (!weapon || !rounds) continue;
      const wins = Math.min(rounds, Math.max(0, Number(observation.wins) || 0));
      const current = accumulator.get(weapon) || { weapon, rounds: 0, wins: 0, losses: 0, kills: 0, deaths: 0, playerNames: new Set<string>() };
      current.rounds += rounds;
      current.wins += wins;
      current.losses += rounds - wins;
      current.kills += Math.max(0, Number(observation.kills) || 0);
      current.deaths += Math.max(0, Number(observation.deaths) || 0);
      current.playerNames.add(player.displayName);
      accumulator.set(weapon, current);
    }
  return [...accumulator.values()]
    .map(({ playerNames, ...row }) => ({ ...row, players: playerNames.size, winRate: pct(row.wins, row.rounds) }))
    .sort((left, right) => right.wins - left.wins || right.winRate - left.winRate || right.rounds - left.rounds || left.weapon.localeCompare(right.weapon));
}

export function buildWeaponRoundOutcomesByEconomy(rounds: TrackerData['rounds']): WeaponOutcomeGroup[] {
  const unique = new Map<string, TrackerData['rounds'][number]>();
  for (const round of rounds || [])
    if (round.screenshotEvidence?.reviewStatus === 'confirmed' && knownResult(round.result)) unique.set(`${round.matchId}:${round.roundNo}`, round);
  const byMatchNumber = new Map([...unique.values()].map(round => [`${round.matchId}:${round.roundNo}`, round]));
  const grouped = new Map<WeaponEconomyContext, TrackerData['rounds']>();
  const contextFor = (round: TrackerData['rounds'][number]): WeaponEconomyContext => {
    if (round.roundNo === 1 || round.roundNo === 13) return 'pistol';
    const halfStart = round.roundNo < 13 ? 1 : 13;
    const pistolWon = knownResult(byMatchNumber.get(`${round.matchId}:${halfStart}`)?.result) === 'win';
    const conversionWon = knownResult(byMatchNumber.get(`${round.matchId}:${halfStart + 1}`)?.result) === 'win';
    if (round.roundNo === halfStart + 1 && pistolWon) return 'post-pistol';
    const buy = String(round.buy || '')
      .trim()
      .toLocaleLowerCase('en');
    if (buy === 'bonus' || (round.roundNo === halfStart + 2 && pistolWon && conversionWon)) return 'bonus';
    if (buy === 'full') return 'full';
    if (buy === 'half' || buy === 'mid') return 'mid';
    if (buy === 'force' || buy === 'low') return 'low';
    if (buy === 'eco') return 'eco';
    const evidence = round.screenshotEvidence!;
    const equipment = classifyTeamEquipment(evidence.players || [], 'ours');
    const economy = equipment !== 'unknown' ? equipment : classifyAverageLoadout(evidence.ourAverageLoadout);
    return economy === 'half' ? 'mid' : economy;
  };
  for (const round of unique.values()) {
    const context = contextFor(round);
    const rows = grouped.get(context) || [];
    rows.push(round);
    grouped.set(context, rows);
  }
  return WEAPON_CONTEXTS.map(context => ({
    ...context,
    outcomes: buildWeaponRoundOutcomes(buildPlayerScreenshotMetrics(grouped.get(context.id) || [])),
  })).filter(group => group.outcomes.length > 0);
}

export function buildWeaponRoundOutcomesByMap(matches: TrackerData['matches'], rounds: TrackerData['rounds'], activeMaps: string[]) {
  const matchMap = new Map((matches || []).map(match => [match.id, String(match.map || '').trim()]));
  const configured = new Map((activeMaps || []).map(map => [map.toLocaleLowerCase('en'), map]));
  const grouped = new Map<string, TrackerData['rounds']>();
  for (const round of rounds || []) {
    if (round.screenshotEvidence?.reviewStatus !== 'confirmed' || !knownResult(round.result)) continue;
    const observedMap = matchMap.get(round.matchId);
    const map = configured.get(String(observedMap || '').toLocaleLowerCase('en'));
    if (!map) continue;
    grouped.set(map, [...(grouped.get(map) || []), round]);
  }
  return [...configured.values()]
    .map(map => ({ map, outcomes: buildWeaponRoundOutcomes(buildPlayerScreenshotMetrics(grouped.get(map) || [])) }))
    .filter(group => group.outcomes.length > 0);
}

function MapWeaponOutcomes({ groups, theme }: { groups: ReturnType<typeof buildWeaponRoundOutcomesByMap>; theme: any }) {
  const [selected, setSelected] = React.useState(groups[0]?.map || '');
  const active = groups.find(group => group.map === selected) || groups[0];
  if (!active) return null;
  return (
    <article className={`min-w-0 rounded-xl border ${theme.border} ${theme.cardBg} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <MapThumbnail name={active.map} className="h-12 w-20 rounded-lg" />
          <div>
            <h4 className="text-sm font-semibold text-cyan-200">Weapons by map</h4>
            <p className="mt-1 text-xs text-gray-500">Which equipped weapons produced results on each active map.</p>
          </div>
        </div>
        <select
          aria-label="Weapon map breakdown"
          value={active.map}
          onChange={event => setSelected(event.target.value)}
          className="ui-field min-h-9 px-2 text-xs"
        >
          {groups.map(group => (
            <option key={group.map} value={group.map}>
              {group.map}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 space-y-2">
        {active.outcomes.slice(0, 6).map(weapon => (
          <div
            key={weapon.weapon}
            className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-white/[0.06] bg-black/10 p-2"
          >
            <WeaponThumbnail name={weapon.weapon} className="h-11 w-[88px] rounded-md" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{weapon.weapon}</p>
              <p className="text-xs text-gray-500">
                {weapon.rounds} observations · {weapon.players} players
              </p>
            </div>
            <div className="text-right font-mono text-xs">
              <p className={percentageTextClass(weapon.winRate)}>{weapon.winRate}% WR</p>
              <p>
                <span className="text-emerald-300">{weapon.wins}W</span>–<span className="text-rose-300">{weapon.losses}L</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function Bar({ label, won, total }: { label: string; won: number; total: number }) {
  const p = pct(won, total);
  const color = total > 0 ? percentageBarClass(p) : percentageBarClass(null);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-mono">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-500">
          {won}/{total} · <span className={`font-bold ${percentageTextClass(total > 0 ? p : null)}`}>{total > 0 ? `${p}%` : 'Unknown'}</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${total > 0 ? p : 0}%` }} />
      </div>
    </div>
  );
}

function StatCard({ icon, title, attW, attT, defW, defT }: { icon: React.ReactNode; title: string; attW: number; attT: number; defW: number; defT: number }) {
  const total = attT + defT,
    won = attW + defW;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase font-bold tracking-widest text-gray-500 flex items-center gap-1.5">
          {icon}
          {title}
        </span>
        <span className={`text-lg font-black ${percentageTextClass(total > 0 ? pct(won, total) : null)}`}>{total > 0 ? `${pct(won, total)}%` : 'Unknown'}</span>
      </div>
      <div className="space-y-1.5 text-xs font-mono">
        <div className="flex justify-between">
          <span>Attack</span>
          <span className={percentageTextClass(attT > 0 ? pct(attW, attT) : null)}>
            {attW}/{attT} · {attT > 0 ? `${pct(attW, attT)}%` : 'Unknown'}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Defense</span>
          <span className={percentageTextClass(defT > 0 ? pct(defW, defT) : null)}>
            {defW}/{defT} · {defT > 0 ? `${pct(defW, defT)}%` : 'Unknown'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function buildEconomySpecialConversions(matches: TrackerData['matches'], rounds: TrackerData['rounds']) {
  const acc = { pistol: { attW: 0, attT: 0, defW: 0, defT: 0 }, eco: { attW: 0, attT: 0, defW: 0, defT: 0 }, bonus: { attW: 0, attT: 0, defW: 0, defT: 0 } };
  for (const row of buildMapRoundIntelligence(
    matches.map(match => ({ ...match, roundAnalytics: undefined })),
    rounds,
  )) {
    for (const [kind, source] of [
      ['pistol', row.pistolBySide],
      ['eco', row.postPistolBySide],
      ['bonus', row.earnedBonusBySide],
    ] as const) {
      acc[kind].attW += source.attack.won;
      acc[kind].attT += source.attack.total;
      acc[kind].defW += source.defense.won;
      acc[kind].defT += source.defense.total;
    }
  }
  return acc;
}

export default function EconomyAnalytics({ data, theme, focusedMatchId, focusedRoundNo }: Props) {
  const matches = focusedMatchId ? (data.matches || []).filter(match => match.id === focusedMatchId) : data.matches || [];
  const rounds = (data.rounds || []).filter(
    round => (!focusedMatchId || round.matchId === focusedMatchId) && (!focusedRoundNo || round.roundNo === focusedRoundNo),
  );
  const reviewData = useMemo(
    () => ({ ...data, matches, rounds, playerStats: (data.playerStats || []).filter(stat => !focusedMatchId || stat.matchId === focusedMatchId) }),
    [data, matches, rounds, focusedMatchId],
  );
  const buyTypes = data.settings?.buyTypes || ['Full', 'Half', 'Force', 'Bonus', 'Eco'];

  // Canonical round-backed conversions shared with Map Analysis and exports.
  const special = useMemo(() => buildEconomySpecialConversions(matches, rounds), [matches, rounds]);

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

  const orderedBuys = buyTypes.filter(b => byBuy[b]).concat(Object.keys(byBuy).filter(b => !buyTypes.includes(b)));
  const hasRounds = rounds.length > 0;
  const hasKnownBuys = Object.keys(byBuy).length > 0;
  const hasActiveRoster = (data.rosterPlayers || []).some(player => !player.retiredAt);
  const screenshotPlayers = useMemo(() => {
    const live = buildPlayerScreenshotMetrics(rounds);
    const stored = (data.playerStats || []).filter(stat => !focusedMatchId || stat.matchId === focusedMatchId);
    const combined = live.length ? combinePlayerScreenshotMetrics(live) : combineStoredScreenshotMetrics(stored);
    return excludeArchivedScreenshotPlayers(combined, data.rosterPlayers || []);
  }, [rounds, data.playerStats, data.rosterPlayers, focusedMatchId]);
  const weaponOutcomeGroups = useMemo(() => buildWeaponRoundOutcomesByEconomy(rounds), [rounds]);
  const activeMaps = useMemo(() => activeResourceNames(data, 'map'), [data]);
  const weaponMapGroups = useMemo(() => buildWeaponRoundOutcomesByMap(matches, rounds, activeMaps), [matches, rounds, activeMaps]);
  const contextualWeapons = useMemo(
    () => buildContextualWeaponOutcomes(reviewData, focusedMatchId ? new Set([focusedMatchId]) : undefined),
    [reviewData, focusedMatchId],
  );
  const advantageRows = useMemo(() => summarizeRoundAdvantages(rounds), [rounds]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Coins className="w-6 h-6 text-[#ff4655]" />
        <h2 className="text-2xl font-black tracking-tight uppercase">Economy Analytics</h2>
      </div>

      <ReplayMatchLog
        data={reviewData}
        theme={theme}
        title="Economy evidence by match"
        description="Round results are included immediately; buy-type metrics stay unknown until the replay or coach provides them."
      />

      {advantageRows.length > 0 && (
        <section className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5`} aria-labelledby="advantage-conversion">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="advantage-conversion" className="text-xs font-bold uppercase tracking-widest text-amber-300">
                Player-advantage conversion
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Exact states from complete ordered replay, screenshot, or VOD elimination evidence. A round can contain more than one distinct state, such as
                5v3 and later 3v1.
              </p>
            </div>
            <span className="text-xs text-gray-500">Unknown outcomes are never counted as wins or losses</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {advantageRows.map(row => (
              <article key={row.label} className="rounded-xl border border-white/10 bg-black/15 p-4">
                <div className="flex items-center justify-between">
                  <strong className="font-mono text-xl text-white">{row.label}</strong>
                  <span className={`font-mono text-sm font-bold ${percentageTextClass(row.conversionRate)}`}>
                    {row.conversionRate === null ? 'Unknown' : `${row.conversionRate}%`}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-500">{row.opportunities} observed</p>
                <div className="mt-2 flex gap-3 font-mono text-xs">
                  <span className="text-emerald-300">{row.converted} converted</span>
                  <span className="text-rose-300">{row.lost} lost</span>
                  {row.unknown > 0 && <span className="text-gray-400">{row.unknown} unknown</span>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {screenshotPlayers.length > 0 && (
        <section className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5`} aria-labelledby="screenshot-player-metrics">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="screenshot-player-metrics" className="text-xs uppercase font-bold tracking-widest text-gray-500">
                Screenshot-derived player metrics
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Confirmed round screens only. Weapon means equipped weapon, not a proven purchase.
                {!hasActiveRoster ? ' No active roster is configured, so historical match participants are included.' : ''}
              </p>
            </div>
            <span className="text-xs text-gray-500">Trades are follow-up kills within 5 seconds</span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="pb-2">Player</th>
                  <th className="pb-2">Rounds</th>
                  <th className="pb-2">Openings</th>
                  <th className="pb-2">Trades</th>
                  <th className="pb-2">Multi-kills</th>
                  <th className="pb-2">Low-buy wins</th>
                  <th className="pb-2">Full-buy losses</th>
                  <th className="pb-2">Anti-eco losses</th>
                  <th className="pb-2">Top weapon</th>
                  <th className="pb-2">KAST</th>
                </tr>
              </thead>
              <tbody>
                {screenshotPlayers.map(player => {
                  const weapon = player.weapons[0];
                  const kastEvidence = screenshotKastEvidence(player);
                  const kast = kastEvidence ? Math.round(publishKast([kastEvidence]).value!) : null;
                  return (
                    <tr key={player.identity} className="border-t border-white/5">
                      <td className="py-3 font-semibold">{player.displayName}</td>
                      <td>{player.coveredRounds}</td>
                      <td>
                        {player.firstKills}–{player.firstDeaths}
                      </td>
                      <td>{player.trades ?? 'Unknown'}</td>
                      <td>
                        {player.multikills.two}×2K · {player.multikills.three}×3K · {player.multikills.four}×4K · {player.multikills.ace} ace
                      </td>
                      <td>{player.lowBudgetWins}</td>
                      <td>{player.highBudgetLosses}</td>
                      <td>{player.antiEcoLosses}</td>
                      <td>{weapon ? `${weapon.weapon} · ${weapon.wins}/${weapon.rounds}` : 'Unknown'}</td>
                      <td className={percentageTextClass(kast)}>{kast === null ? 'Unknown' : `${kast}% (${kastEvidence!.covered})`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {weaponOutcomeGroups.length > 0 && (
        <section className="space-y-4" aria-labelledby="weapon-round-outcomes">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="weapon-round-outcomes" className="text-xs font-bold uppercase tracking-widest text-violet-300">
                Weapon outcomes by buy context
              </h3>
              <p className="mt-1 max-w-3xl text-xs text-gray-500">
                Compare weapons only inside equivalent economy decisions. Confirmed equipped-weapon evidence only; this does not prove a purchase or that the
                weapon caused the result.
              </p>
            </div>
            <span className="text-xs text-gray-500">Each panel sorts by winning player-rounds</span>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {weaponOutcomeGroups.map(group => (
              <article key={group.id} className={`min-w-0 rounded-xl border ${theme.border} ${theme.cardBg} p-4`}>
                <div>
                  <h4 className="text-sm font-semibold text-violet-200">{group.label}</h4>
                  <p className="mt-1 text-xs text-gray-500">{group.detail}</p>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-xs">
                    <thead className="text-xs uppercase tracking-wider text-gray-500">
                      <tr>
                        <th className="pb-2">Weapon</th>
                        <th className="pb-2">W–L</th>
                        <th className="pb-2">Observed</th>
                        <th className="pb-2">Win rate</th>
                        <th className="pb-2">K / D</th>
                        <th className="pb-2">Players</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.outcomes.map(weapon => (
                        <tr key={weapon.weapon} className="border-t border-white/5">
                          <td className="py-2.5 font-semibold text-violet-200">
                            <span className="flex items-center gap-2">
                              <WeaponThumbnail name={weapon.weapon} className="h-10 w-20 rounded-md" />
                              {weapon.weapon}
                            </span>
                          </td>
                          <td className="font-mono">
                            <span className="text-emerald-300">{weapon.wins}</span>–<span className="text-rose-300">{weapon.losses}</span>
                          </td>
                          <td className="font-mono text-cyan-300">
                            {weapon.rounds}
                            {weapon.rounds < 5 && <span className="ml-1.5 text-xs uppercase text-amber-400">Small</span>}
                          </td>
                          <td className={`font-mono font-bold ${percentageTextClass(weapon.winRate)}`}>{weapon.winRate}%</td>
                          <td className="font-mono">
                            <span className="text-emerald-300">{weapon.kills}</span> / <span className="text-rose-300">{weapon.deaths}</span>
                          </td>
                          <td className="font-mono">{weapon.players}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
            {weaponMapGroups.length > 0 && <MapWeaponOutcomes groups={weaponMapGroups} theme={theme} />}
          </div>
        </section>
      )}

      {contextualWeapons.length > 0 && (
        <section className={`rounded-xl border ${theme.border} ${theme.cardBg} p-5`} aria-labelledby="contextual-economy">
          <div>
            <h3 id="contextual-economy" className="text-xs font-bold uppercase tracking-widest text-cyan-300">
              Contextual weapon outcomes
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Our buy, enemy buy, map, side, site, player and agent remain attached to every confirmed equipped-weapon outcome. Low samples are shown, never
              treated as recommendations.
            </p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-xs">
              <thead className="text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="pb-2">Weapon</th>
                  <th>Map</th>
                  <th>Buy context</th>
                  <th>Side / site</th>
                  <th>Player / agent</th>
                  <th>Observed</th>
                  <th>W–L</th>
                  <th>Win rate</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {contextualWeapons.slice(0, 50).map((row, index) => (
                  <tr key={`${row.weapon}:${row.map}:${row.player}:${index}`} className="border-t border-white/5">
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <WeaponThumbnail name={row.weapon} className="h-9 w-16 rounded" />
                        {row.weapon}
                      </span>
                    </td>
                    <td>{row.map}</td>
                    <td>
                      {row.buyClass} vs {row.enemyBuyClass}
                    </td>
                    <td>
                      {row.side} · {row.site}
                    </td>
                    <td>
                      {row.player} · {row.agent}
                    </td>
                    <td className="font-mono">{row.rounds}</td>
                    <td className="font-mono">
                      <span className="text-emerald-300">{row.wins}</span>–<span className="text-rose-300">{row.losses}</span>
                    </td>
                    <td className={`font-mono font-bold ${percentageTextClass(row.winRate)}`}>{row.winRate}%</td>
                    <td className={row.confidence === 'low' ? 'text-amber-300' : 'text-emerald-300'}>{row.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
                <p className="text-xs text-gray-500 font-mono italic">
                  Buy/loadout evidence is unavailable for these rounds. Side and result evidence is still included below.
                </p>
              ) : (
                <div className="space-y-3">
                  {orderedBuys.map(b => (
                    <React.Fragment key={b}>
                      <Bar label={b} won={byBuy[b].won} total={byBuy[b].total} />
                    </React.Fragment>
                  ))}
                </div>
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
