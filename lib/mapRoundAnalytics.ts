import type { EconomyClass, Match, Round } from '../src/types';
import { knownResult, knownRoundSide } from './analyticsEvidence';
import { classifyAverageLoadout, classifyTeamEquipment } from './scrimRoundAnalytics';

type Conversion = { won: number; total: number };
type LossConversion = { lost: number; total: number };
export const MAP_ROUND_CALCULATION_VERSION = 'map-round-intelligence/v1' as const;

export interface MapRoundIntelligence {
  schemaVersion: 1;
  calculationVersion?: string;
  sourceHash?: string;
  unknownReasons?: string[];
  map: string;
  matches: number;
  coveredRounds: number;
  openingRounds: [Conversion, Conversion, Conversion];
  openingThree: Conversion;
  pistol: Conversion;
  pistolBySide: { attack: Conversion; defense: Conversion };
  postPistol: Conversion;
  postPistolBySide: { attack: Conversion; defense: Conversion };
  earnedBonus: Conversion;
  earnedBonusBySide: { attack: Conversion; defense: Conversion };
  lowBuy: Conversion;
  lowBuyBySide: { attack: Conversion; defense: Conversion };
  fullBuyLosses: LossConversion;
  antiEcoLosses: LossConversion;
  antiEcoBySide: { attack: LossConversion; defense: LossConversion };
  confirmedAntiEcoThrows: number;
  latestOpening: { matchId: string; label: string; firstHalf: string; secondHalf: string } | null;
}

const conversion = (): Conversion => ({ won: 0, total: 0 });
const losses = (): LossConversion => ({ lost: 0, total: 0 });

function explicitEconomy(value: unknown): EconomyClass {
  const label = String(value || '').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '');
  if (!label) return 'unknown';
  if (['eco', 'pistol'].includes(label)) return 'eco';
  if (['low', 'force', 'forcebuy'].includes(label)) return 'low';
  if (['half', 'halfbuy', 'bonus'].includes(label)) return 'half';
  if (['full', 'fullbuy'].includes(label)) return 'full';
  return 'unknown';
}

function roundEconomy(round: Round, team: 'ours' | 'theirs'): EconomyClass {
  const explicit = explicitEconomy(team === 'ours' ? round.buy : round.enemyBuy);
  if (explicit !== 'unknown') return explicit;
  const evidence = round.screenshotEvidence;
  if (!evidence || evidence.reviewStatus !== 'confirmed') return 'unknown';
  const equipment = classifyTeamEquipment(evidence.players || [], team);
  return equipment !== 'unknown'
    ? equipment
    : classifyAverageLoadout(team === 'ours' ? evidence.ourAverageLoadout : evidence.enemyAverageLoadout);
}

function addResult(target: Conversion, result: ReturnType<typeof knownResult>) {
  if (!result) return;
  target.total += 1;
  if (result === 'win') target.won += 1;
}

function sequence(rounds: Map<number, Round>, start: number) {
  return [start, start + 1, start + 2].map(number => {
    const result = knownResult(rounds.get(number)?.result);
    return result === 'win' ? 'W' : result === 'loss' ? 'L' : '–';
  }).join('–');
}

/** Map-level, round-backed conversions. Unknown evidence is excluded, never treated as a loss. */
export function buildMapRoundIntelligence(matches: readonly Match[], rounds: readonly Round[]): MapRoundIntelligence[] {
  const matchById = new Map(matches.map(match => [match.id, match]));
  const rows = new Map<string, MapRoundIntelligence>();
  const roundsByMatch = new Map<string, Map<number, Round>>();

  const ensure = (map: string) => {
    let row = rows.get(map);
    if (!row) {
      row = {
        schemaVersion: 1, calculationVersion: MAP_ROUND_CALCULATION_VERSION, map, matches: 0, coveredRounds: 0,
        openingRounds: [conversion(), conversion(), conversion()], openingThree: conversion(),
        pistol: conversion(), pistolBySide: { attack: conversion(), defense: conversion() },
        postPistol: conversion(), postPistolBySide: { attack: conversion(), defense: conversion() },
        earnedBonus: conversion(), earnedBonusBySide: { attack: conversion(), defense: conversion() },
        lowBuy: conversion(), lowBuyBySide: { attack: conversion(), defense: conversion() },
        fullBuyLosses: losses(), antiEcoLosses: losses(), antiEcoBySide: { attack: losses(), defense: losses() },
        confirmedAntiEcoThrows: 0, latestOpening: null,
      };
      rows.set(map, row);
    }
    return row;
  };

  for (const round of rounds) {
    const match = matchById.get(round.matchId);
    if (!match?.map || !Number.isInteger(round.roundNo) || round.roundNo < 1) continue;
    const numbered = roundsByMatch.get(round.matchId) || new Map<number, Round>();
    if (!numbered.has(round.roundNo)) numbered.set(round.roundNo, round);
    roundsByMatch.set(round.matchId, numbered);
  }

  const orderedMatches = [...matches].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  for (const match of orderedMatches) {
    if (!match.map) continue;
    const numbered = roundsByMatch.get(match.id);
    if (!numbered?.size) {
      const stored = (match as any).roundAnalytics as MapRoundIntelligence | undefined;
      if (!stored || stored.schemaVersion !== 1 || stored.map !== match.map
        || stored.calculationVersion !== MAP_ROUND_CALCULATION_VERSION
        || !/^[a-f0-9]{64}$/.test(stored.sourceHash || '')) continue;
      const row = ensure(match.map);
      row.matches += stored.matches || 1; row.coveredRounds += stored.coveredRounds || 0;
      row.openingRounds.forEach((target, index) => { target.won += stored.openingRounds?.[index]?.won || 0; target.total += stored.openingRounds?.[index]?.total || 0; });
      for (const key of ['openingThree', 'pistol', 'postPistol', 'earnedBonus', 'lowBuy'] as const) { row[key].won += stored[key]?.won || 0; row[key].total += stored[key]?.total || 0; }
      for (const side of ['attack', 'defense'] as const) {
        for (const key of ['pistolBySide', 'postPistolBySide', 'earnedBonusBySide', 'lowBuyBySide'] as const) { row[key][side].won += stored[key]?.[side]?.won || 0; row[key][side].total += stored[key]?.[side]?.total || 0; }
        row.antiEcoBySide[side].lost += stored.antiEcoBySide?.[side]?.lost || 0; row.antiEcoBySide[side].total += stored.antiEcoBySide?.[side]?.total || 0;
      }
      for (const key of ['fullBuyLosses', 'antiEcoLosses'] as const) { row[key].lost += stored[key]?.lost || 0; row[key].total += stored[key]?.total || 0; }
      row.confirmedAntiEcoThrows += stored.confirmedAntiEcoThrows || 0; row.latestOpening = stored.latestOpening || row.latestOpening;
      continue;
    }
    const row = ensure(match.map);
    row.matches += 1;

    for (const round of numbered.values()) {
      const result = knownResult(round.result);
      if (!result) continue;
      row.coveredRounds += 1;
      const ours = roundEconomy(round, 'ours');
      const theirs = roundEconomy(round, 'theirs');
      const side = knownRoundSide(round.side);
      const isPistolRound = round.roundNo === 1 || round.roundNo === 13;
      if (!isPistolRound && (ours === 'eco' || ours === 'low')) {
        addResult(row.lowBuy, result);
        if (side) addResult(row.lowBuyBySide[side === 'Attack' ? 'attack' : 'defense'], result);
      }
      if (ours === 'full') {
        row.fullBuyLosses.total += 1;
        if (result === 'loss') row.fullBuyLosses.lost += 1;
        if (theirs === 'eco' || theirs === 'low') {
          row.antiEcoLosses.total += 1;
          const sideLoss = side ? row.antiEcoBySide[side === 'Attack' ? 'attack' : 'defense'] : null;
          if (sideLoss) sideLoss.total += 1;
          if (result === 'loss') {
            row.antiEcoLosses.lost += 1;
            if (sideLoss) sideLoss.lost += 1;
            if (String(round.isThrow).toLocaleUpperCase() === 'TRUE') row.confirmedAntiEcoThrows += 1;
          }
        }
      }
    }

    for (const start of [1, 13]) {
      const pistol = knownResult(numbered.get(start)?.result);
      const follow = knownResult(numbered.get(start + 1)?.result);
      const bonus = knownResult(numbered.get(start + 2)?.result);
      const openingSide = String(numbered.get(start)?.side || '').toLocaleLowerCase().startsWith('att') ? 'attack'
        : String(numbered.get(start)?.side || '').toLocaleLowerCase().startsWith('def') ? 'defense' : null;
      [pistol, follow, bonus].forEach((result, index) => addResult(row.openingRounds[index], result));
      const knownOpening = [pistol, follow, bonus].filter(Boolean);
      row.openingThree.total += knownOpening.length;
      row.openingThree.won += knownOpening.filter(result => result === 'win').length;
      addResult(row.pistol, pistol);
      if (openingSide) addResult(row.pistolBySide[openingSide], pistol);
      if (pistol === 'win') { addResult(row.postPistol, follow); if (openingSide) addResult(row.postPistolBySide[openingSide], follow); }
      if (pistol === 'win' && follow === 'win') { addResult(row.earnedBonus, bonus); if (openingSide) addResult(row.earnedBonusBySide[openingSide], bonus); }
    }

    row.latestOpening = {
      matchId: match.id,
      label: `${match.opponent || 'Opponent'} · ${match.date}`,
      firstHalf: sequence(numbered, 1),
      secondHalf: sequence(numbered, 13),
    };
  }

  return [...rows.values()].sort((a, b) => a.map.localeCompare(b.map));
}
