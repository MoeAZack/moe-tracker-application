import type { Match, PlayerStats, TrackerData } from '../src/types';
import { matchOutcome } from './analyticsEvidence';
import { buildMapRoundIntelligence } from './mapRoundAnalytics';
import { buildMapScoreLedger, type MapScoreLedger } from './mapScoreLedger';
import { DEFAULT_MINIMUM_METRIC_SAMPLES, isKnownCount, metricSampleGate } from './metricTrust';
import { canonicalResourceName } from './resourceCatalog';
import { reconcileObservedPlayerRows } from './uiIntegration';

export interface MapStatsRow {
  played: number; won: number; lost: number; drawn: number;
  attW: number; attL: number; defW: number; defL: number;
  pistolW: number; pistolL: number; ecoW: number; ecoL: number; bonusW: number; bonusL: number;
  kills: number; deaths: number;
  actualPlayed: number; actualWon: number; actualLost: number; actualDrawn: number;
  /** Matches counted in the window, and how many of them carried complete side rounds / complete team K/D. */
  matches: number; sideMatches: number; kdMatches: number;
}

const blankRow = (): MapStatsRow => ({ played: 0, won: 0, lost: 0, drawn: 0, attW: 0, attL: 0, defW: 0, defL: 0, pistolW: 0, pistolL: 0, ecoW: 0, ecoL: 0, bonusW: 0, bonusL: 0, kills: 0, deaths: 0, actualPlayed: 0, actualWon: 0, actualLost: 0, actualDrawn: 0, matches: 0, sideMatches: 0, kdMatches: 0 });

/** Side and K/D totals are complete only when every match in the window supplied them. */
export const sideRoundsComplete = (row: MapStatsRow) => row.matches > 0 && row.sideMatches === row.matches;
export const teamKdComplete = (row: MapStatsRow) => row.matches > 0 && row.kdMatches === row.matches;

export function buildMapStatsTable(data: TrackerData, maps: readonly string[], now = Date.now()): Record<string, MapStatsRow> {
  const statsConfig = data.settings.stats || { shrinkK: 10, lowSample: 15, decayEnabled: false, halfLifeDays: 120, rollingWindow: 10 };
  const matches = data.matches || []; const playerStats = data.playerStats || [];
  const table: Record<string, MapStatsRow> = Object.fromEntries(maps.map(map => [map, blankRow()]));
  for (const mapName of maps) {
    const s = table[mapName];
    let active = matches.filter(match => canonicalResourceName(data, 'map', match.map) === mapName).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const rollingWindow = statsConfig.rollingWindow;
    if (rollingWindow && rollingWindow > 0 && active.length > rollingWindow) active = active.slice(-rollingWindow);
    for (const m of active) {
      let weight = 1.0;
      if (statsConfig.decayEnabled) weight = Math.pow(0.5, Math.max(0, now - new Date(m.date).getTime()) / 86_400_000 / (statsConfig.halfLifeDays || 120));
      s.matches += 1;
      const outcome = matchOutcome(m);
      if (outcome !== null) { s.played += weight; s.actualPlayed++; }
      if (outcome === 'win') { s.won += weight; s.actualWon++; } else if (outcome === 'loss') { s.lost += weight; s.actualLost++; } else if (outcome === 'draw') { s.drawn += weight; s.actualDrawn++; }
      if ([m.attW, m.attL, m.defW, m.defL].every(isKnownCount)) { s.sideMatches += 1; s.attW += m.attW * weight; s.attL += m.attL * weight; s.defW += m.defW * weight; s.defL += m.defL * weight; }
      // The same round-backed conversions power Economy, Map Analysis and exports. Legacy labels without retained rounds stay unknown.
      const canonical = buildMapRoundIntelligence([{ ...m, roundAnalytics: undefined }], (data.rounds || []).filter(round => round.matchId === m.id))[0];
      if (canonical) {
        s.pistolW += canonical.pistol.won * weight; s.pistolL += (canonical.pistol.total - canonical.pistol.won) * weight;
        s.ecoW += canonical.postPistol.won * weight; s.ecoL += (canonical.postPistol.total - canonical.postPistol.won) * weight;
        s.bonusW += canonical.earnedBonus.won * weight; s.bonusL += (canonical.earnedBonus.total - canonical.earnedBonus.won) * weight;
      }
      // Team K/D counts a match only when every saved row has both kills and deaths.
      const rows = playerStats.filter(row => row.matchId === m.id);
      if (rows.length && rows.every(row => isKnownCount(row.kills) && isKnownCount(row.deaths))) { s.kdMatches += 1; for (const row of rows) { s.kills += row.kills! * weight; s.deaths += row.deaths! * weight; } }
    }
  }
  return table;
}

export interface BestMapRow {
  map: string; score: number | null; ledger: MapScoreLedger; n: number; wr: number | null; ci: string | null;
  attWr: number | null; defWr: number | null; pistolWr: number | null; ecoWr: number | null; bonusWr: number | null; kd: string | null;
  playerPerformance: number | null; contributingPlayers: number;
}

export function buildBestMaps(data: TrackerData, table: Record<string, MapStatsRow>): BestMapRow[] {
  const weights = { mapWin: 25, attWin: 12.5, defWin: 12.5, pistol: 20, eco: 10, bonus: 10, kd: 10, ...data.settings.weights };
  const statsConfig = data.settings.stats || { shrinkK: 10, lowSample: 15 };
  const experimental = statsConfig.experimentalCompositeScores === true; const minimumSamples = statsConfig.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES;
  const matches: Match[] = data.matches || []; const playerStats: PlayerStats[] = data.playerStats || [];
  return Object.entries(table).map(([mapName, s]) => {
    const n = s.actualPlayed; const weightedPlayed = s.played;
    const rawWr = weightedPlayed > 0 ? s.won / weightedPlayed : null;
    const shrinkK = statsConfig.shrinkK || 10;
    const wr = weightedPlayed > 0 ? (s.won + shrinkK * 0.5) / (weightedPlayed + shrinkK) : null;
    const sides = sideRoundsComplete(s);
    const attWr = sides && s.attW + s.attL > 0 ? s.attW / (s.attW + s.attL) : null;
    const defWr = sides && s.defW + s.defL > 0 ? s.defW / (s.defW + s.defL) : null;
    const pistolTotal = s.pistolW + s.pistolL; const pistolWr = pistolTotal > 0 ? s.pistolW / pistolTotal : null;
    const ecoTotal = s.ecoW + s.ecoL; const ecoWr = ecoTotal > 0 ? s.ecoW / ecoTotal : null;
    const bonusTotal = s.bonusW + s.bonusL; const bonusWr = bonusTotal > 0 ? s.bonusW / bonusTotal : null;
    const kdRatio = teamKdComplete(s) && s.deaths > 0 ? s.kills / s.deaths : null;
    // Map K/D to a 0-1 scale, where 1.0 is 0.5, 1.5 is 0.75, 0.5 is 0.25, etc.
    const kdScore = kdRatio === null ? null : Math.max(0, Math.min(1.0, kdRatio / 2.0));

    // Equal-weight current-player form prevents one high-volume fragger from hiding a weak roster fit.
    const mapMatchIds = new Set(matches.filter(match => canonicalResourceName(data, 'map', match.map) === mapName).map(match => match.id));
    const rowsByPlayer = new Map<string, PlayerStats[]>();
    for (const row of playerStats.filter(row => mapMatchIds.has(row.matchId))) {
      const key = row.playerId || `name:${String(row.displayNameSnapshot || row.player || '').trim().toLocaleLowerCase()}`;
      rowsByPlayer.set(key, [...(rowsByPlayer.get(key) || []), row]);
    }
    const playerScores = [...rowsByPlayer.values()].map(rows => {
      const reconciled = reconcileObservedPlayerRows(rows);
      if (!reconciled.length || !reconciled.every(row => typeof row.kills === 'number' && typeof row.deaths === 'number')) return null;
      const kills = reconciled.reduce((sum, row) => sum + row.kills!, 0); const deaths = reconciled.reduce((sum, row) => sum + row.deaths!, 0);
      return deaths > 0 ? Math.max(0, Math.min(1, (kills / deaths) / 2)) : kills > 0 ? 1 : null;
    }).filter((value): value is number => value !== null);
    const playerPerformanceScore = experimental && n >= minimumSamples && playerScores.length === rowsByPlayer.size && playerScores.length ? playerScores.reduce((sum, value) => sum + value, 0) / playerScores.length : null;

    const ledger = buildMapScoreLedger({
      mapWin: { label: 'Shrunk match win rate', value: wr ?? 0, weight: weights.mapWin, known: experimental && wr !== null, samples: n },
      attack: { label: 'Attack round win rate', value: attWr ?? 0, weight: weights.attWin, known: experimental && attWr !== null, samples: s.attW + s.attL },
      defense: { label: 'Defense round win rate', value: defWr ?? 0, weight: weights.defWin, known: experimental && defWr !== null, samples: s.defW + s.defL },
      pistol: { label: 'Pistol conversion', value: pistolWr ?? 0, weight: weights.pistol, known: experimental && pistolWr !== null, samples: pistolTotal },
      eco: { label: 'Post-pistol conversion', value: ecoWr ?? 0, weight: weights.eco, known: experimental && ecoWr !== null, samples: ecoTotal },
      bonus: { label: 'Earned bonus conversion', value: bonusWr ?? 0, weight: weights.bonus, known: experimental && bonusWr !== null, samples: bonusTotal },
      kd: { label: 'Team K/D score', value: kdScore ?? 0, weight: weights.kd, known: experimental && kdScore !== null, samples: s.kills + s.deaths },
    }, minimumSamples);

    // 95% Wilson interval, published only for an enabled experimental score with a gated sample.
    let ci: string | null = null;
    if (experimental && ledger.score !== null && rawWr !== null && metricSampleGate(n, minimumSamples).publishable) {
      const z = 1.96; const zSq = z * z; const factor = 1 + zSq / n;
      const center = (rawWr + zSq / (2 * n)) / factor; const spread = (z / factor) * Math.sqrt((rawWr * (1 - rawWr)) / n + zSq / (4 * n * n));
      ci = `${Math.round(Math.max(0, center - spread) * 100)}% - ${Math.round(Math.min(1, center + spread) * 100)}%`;
    }
    const pct = (value: number | null) => value === null ? null : Math.round(value * 100);
    return {
      map: mapName, score: ledger.score, ledger, n, wr: pct(rawWr), ci,
      attWr: pct(attWr), defWr: pct(defWr), pistolWr: pct(pistolWr), ecoWr: pct(ecoWr), bonusWr: pct(bonusWr),
      kd: kdRatio === null ? null : kdRatio.toFixed(2),
      playerPerformance: pct(playerPerformanceScore), contributingPlayers: playerPerformanceScore === null ? 0 : playerScores.length,
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/** The best-map recommendation exists only for an enabled experimental score that was actually computed. */
export function bestMapInsight(rows: readonly BestMapRow[], settings: Pick<TrackerData['settings'], 'stats'>): BestMapRow | null {
  const top = rows[0];
  return settings.stats?.experimentalCompositeScores === true && top && top.score !== null ? top : null;
}
