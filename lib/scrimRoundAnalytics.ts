import type { EconomyClass, PlayerScreenshotMetrics, Round } from '../src/types';
import { knownResult } from './analyticsEvidence';
import { normalizeCaptureName } from './scrimCaptureImport';

export function screenshotPlayerIdentity(playerId: unknown, displayName: unknown): string {
  const supplied = typeof playerId === 'string' ? playerId.trim() : '';
  if (supplied && !supplied.toLocaleLowerCase().startsWith('name:')) return supplied;
  const name = supplied ? supplied.slice(5) : displayName;
  return `name:${normalizeCaptureName(name)}`;
}

export function classifyAverageLoadout(value: unknown): EconomyClass {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'unknown';
  if (value < 2_000) return 'eco';
  if (value < 3_500) return 'low';
  if (value < 3_900) return 'half';
  return 'full';
}

const FULL_WEAPONS = ['vandal', 'phantom', 'operator', 'odin', 'guardian', 'outlaw'];
const LOW_WEAPONS = ['spectre', 'stinger', 'bulldog', 'judge', 'bucky', 'marshal', 'ares'];
const PISTOLS = ['classic', 'ghost', 'sheriff', 'frenzy', 'shorty'];

export function classifyTeamEquipment(players: ReadonlyArray<{ team?: string; equippedWeapon?: string | null }>, team: 'ours' | 'theirs'): EconomyClass {
  const weapons = players.filter(player => player.team === team).map(player => String(player.equippedWeapon || '').toLocaleLowerCase().replace(/[^a-z]/g, ''));
  if (weapons.length < 3) return 'unknown';
  const full = weapons.filter(weapon => FULL_WEAPONS.some(name => weapon.includes(name)) || weapon.includes('bandit')).length;
  const low = weapons.filter(weapon => LOW_WEAPONS.some(name => weapon.includes(name))).length;
  const pistols = weapons.filter(weapon => PISTOLS.some(name => weapon.includes(name))).length;
  if (full >= 3) return 'full';
  if (full + low >= 3) return full ? 'half' : 'low';
  if (pistols >= 3) return pistols === weapons.length ? 'eco' : 'low';
  return 'unknown';
}

export type SpecialRoundConversion = { attW: number; attT: number; defW: number; defT: number };

/** Derive pistol, eco and true third-round bonus conversions from round evidence. */
export function deriveSpecialRoundConversions(rounds: readonly Round[]) {
  const result = {
    pistol: { attW: 0, attT: 0, defW: 0, defT: 0 },
    eco: { attW: 0, attT: 0, defW: 0, defT: 0 },
    bonus: { attW: 0, attT: 0, defW: 0, defT: 0 },
  };
  const add = (kind: keyof typeof result, side: 'att' | 'def', won: boolean) => {
    result[kind][side === 'att' ? 'attT' : 'defT'] += 1;
    if (won) result[kind][side === 'att' ? 'attW' : 'defW'] += 1;
  };
  const byMatch = new Map<string, Round[]>();
  for (const round of rounds) {
    const rows = byMatch.get(round.matchId) || []; rows.push(round); byMatch.set(round.matchId, rows);
  }
  for (const matchRounds of byMatch.values()) {
    const numbered = new Map(matchRounds.map(round => [round.roundNo, round]));
    for (const round of matchRounds) {
      const known = knownResult(round.result); const side = String(round.side || '').toLocaleLowerCase();
      const normalizedSide = side.startsWith('att') ? 'att' : side.startsWith('def') ? 'def' : null;
      if (!known || !normalizedSide) continue;
      if (round.roundNo === 1 || round.roundNo === 13) add('pistol', normalizedSide, known === 'win');
      const buy = String(round.buy || '').trim().toLocaleLowerCase();
      if (round.roundNo !== 1 && round.roundNo !== 13 && (buy === 'eco' || buy === 'low')) add('eco', normalizedSide, known === 'win');
    }
    for (const [bonusRound, pistolRound] of [[3, 1], [15, 13]] as const) {
      const round = numbered.get(bonusRound); const pistol = numbered.get(pistolRound); const antiEco = numbered.get(pistolRound + 1);
      if (!round || knownResult(pistol?.result) !== 'win' || knownResult(antiEco?.result) !== 'win') continue;
      const known = knownResult(round.result); const side = String(round.side || '').toLocaleLowerCase();
      const normalizedSide = side.startsWith('att') ? 'att' : side.startsWith('def') ? 'def' : null;
      if (known && normalizedSide) add('bonus', normalizedSide, known === 'win');
    }
  }
  return result;
}

type Mutable = PlayerScreenshotMetrics & { identity: string; displayName: string };
const empty = (identity: string, displayName: string): Mutable => ({
  schemaVersion: 1, identity, displayName, coveredRounds: 0, wins: 0, losses: 0,
  firstKills: 0, firstDeaths: 0, multikills: { two: 0, three: 0, four: 0, ace: 0 },
  lowBudgetWins: 0, highBudgetLosses: 0, antiEcoLosses: 0,
  kast: { successful: 0, covered: 0 }, weapons: [],
});

/** Derive only from confirmed screenshots. Missing fields never become zero-value evidence. */
export function buildPlayerScreenshotMetrics(rounds: readonly Round[]) {
  const players = new Map<string, Mutable>();
  const coveredRoundKeys = new Set<string>();
  for (const round of rounds) {
    const evidence = round.screenshotEvidence;
    const result = knownResult(round.result);
    if (!evidence || evidence.reviewStatus !== 'confirmed' || !result) continue;
    const roundKey = `${round.matchId}\u0000${round.roundNo}`;
    if (coveredRoundKeys.has(roundKey)) continue;
    coveredRoundKeys.add(roundKey);
    const ours = evidence.players.filter(player => player.team === 'ours');
    const ourEquipment = classifyTeamEquipment(evidence.players, 'ours');
    const enemyEquipment = classifyTeamEquipment(evidence.players, 'theirs');
    const ourEconomy = ourEquipment !== 'unknown' ? ourEquipment : classifyAverageLoadout(evidence.ourAverageLoadout);
    const enemyEconomy = enemyEquipment !== 'unknown' ? enemyEquipment : classifyAverageLoadout(evidence.enemyAverageLoadout);
    const events = [...(evidence.events || [])].sort((a, b) => a.sequence - b.sequence);
    const eventsComplete = evidence.eventsComplete === true
      && events.every((event, index) => event.sequence === index + 1);
    const first = eventsComplete ? events[0] : undefined;
    const kills = new Map<string, number>();
    const deaths = new Map<string, number>();
    const weaponKills = new Map<string, Map<string, number>>();
    for (const event of eventsComplete ? events : []) {
      const killerId = event.killerPlayerId ? screenshotPlayerIdentity(event.killerPlayerId, '') : null;
      const victimId = event.victimPlayerId ? screenshotPlayerIdentity(event.victimPlayerId, '') : null;
      if (killerId) kills.set(killerId, (kills.get(killerId) || 0) + 1);
      if (victimId) deaths.set(victimId, (deaths.get(victimId) || 0) + 1);
      const weapon = event.weapon?.trim();
      if (weapon && killerId) {
        const byWeapon = weaponKills.get(killerId) || new Map<string, number>();
        byWeapon.set(weapon, (byWeapon.get(weapon) || 0) + 1); weaponKills.set(killerId, byWeapon);
      }
    }
    const seenOurPlayers = new Set<string>();
    for (const observation of ours) {
      const normalizedName = normalizeCaptureName(observation.displayName);
      if (!observation.playerId && !normalizedName) continue;
      const identity = screenshotPlayerIdentity(observation.playerId, observation.displayName);
      if (seenOurPlayers.has(identity)) continue;
      seenOurPlayers.add(identity);
      const metric = players.get(identity) || empty(identity, observation.displayName);
      players.set(identity, metric);
      metric.coveredRounds += 1;
      result === 'win' ? metric.wins += 1 : metric.losses += 1;
      if (result === 'win' && (ourEconomy === 'eco' || ourEconomy === 'low')) metric.lowBudgetWins += 1;
      if (result === 'loss' && ourEconomy === 'full') metric.highBudgetLosses += 1;
      if (result === 'loss' && ourEconomy === 'full' && (enemyEconomy === 'eco' || enemyEconomy === 'low')) metric.antiEcoLosses += 1;
      const playerId = typeof observation.playerId === 'string' && observation.playerId.length > 0 ? screenshotPlayerIdentity(observation.playerId, observation.displayName) : null;
      const firstKillerId = first?.killerPlayerId ? screenshotPlayerIdentity(first.killerPlayerId, '') : null;
      const firstVictimId = first?.victimPlayerId ? screenshotPlayerIdentity(first.victimPlayerId, '') : null;
      if (playerId && firstKillerId === playerId) metric.firstKills += 1;
      if (playerId && firstVictimId === playerId) metric.firstDeaths += 1;
      const roundKills = playerId && eventsComplete ? kills.get(playerId) : undefined;
      if (roundKills === 2) metric.multikills.two += 1;
      else if (roundKills === 3) metric.multikills.three += 1;
      else if (roundKills === 4) metric.multikills.four += 1;
      else if (roundKills !== undefined && roundKills >= 5) metric.multikills.ace += 1;
      const weapon = observation.equippedWeapon?.trim();
      if (weapon) {
        let row = metric.weapons.find(item => item.weapon.toLocaleLowerCase() === weapon.toLocaleLowerCase());
        if (!row) { row = { weapon, rounds: 0, wins: 0, kills: 0, deaths: 0 }; metric.weapons.push(row); }
        row.rounds += 1; if (result === 'win') row.wins += 1;
        if (playerId && eventsComplete) row.deaths += deaths.get(playerId) || 0;
      }
      if (playerId && eventsComplete) {
        for (const [eventWeapon, count] of weaponKills.get(playerId) || []) {
          let row = metric.weapons.find(item => item.weapon.toLocaleLowerCase() === eventWeapon.toLocaleLowerCase());
          if (!row) { row = { weapon: eventWeapon, rounds: 0, wins: 0, kills: 0, deaths: 0 }; metric.weapons.push(row); }
          row.kills += count;
        }
      }
      const assistsKnown = typeof observation.assists === 'number';
      const survivalKnown = typeof observation.survived === 'boolean';
      const eventCoverage = !!playerId && eventsComplete;
      if (assistsKnown && survivalKnown && eventCoverage) {
        metric.kast!.covered += 1;
        const traded = events.some(event => event.victimPlayerId === observation.playerId && typeof event.tradedWithinSeconds === 'number' && event.tradedWithinSeconds <= 5);
        if ((roundKills || 0) > 0 || observation.assists! > 0 || observation.survived || traded) metric.kast!.successful += 1;
      }
    }
  }
  return [...players.values()].map(metric => ({ ...metric, weapons: metric.weapons.sort((a, b) => b.rounds - a.rounds || a.weapon.localeCompare(b.weapon)) }));
}

export function combineStoredScreenshotMetrics(rows: ReadonlyArray<{ playerId?: string | null; player?: string; displayNameSnapshot?: string; screenshotMetrics?: PlayerScreenshotMetrics }>) {
  const combined = new Map<string, Mutable>();
  for (const row of rows) {
    const source = row.screenshotMetrics;
    if (!source) continue;
    const displayName = row.displayNameSnapshot || row.player || 'Unknown player';
    const identity = screenshotPlayerIdentity(row.playerId, displayName);
    const target = combined.get(identity) || empty(identity, displayName);
    combined.set(identity, target);
    for (const field of ['coveredRounds', 'wins', 'losses', 'firstKills', 'firstDeaths', 'lowBudgetWins', 'highBudgetLosses', 'antiEcoLosses'] as const) target[field] += source[field] || 0;
    for (const field of ['two', 'three', 'four', 'ace'] as const) target.multikills[field] += source.multikills?.[field] || 0;
    if (source.kast) { target.kast!.successful += source.kast.successful; target.kast!.covered += source.kast.covered; }
    for (const weapon of source.weapons || []) {
      let item = target.weapons.find(candidate => candidate.weapon.toLocaleLowerCase() === weapon.weapon.toLocaleLowerCase());
      if (!item) { item = { weapon: weapon.weapon, rounds: 0, wins: 0, kills: 0, deaths: 0 }; target.weapons.push(item); }
      item.rounds += weapon.rounds; item.wins += weapon.wins; item.kills += weapon.kills; item.deaths += weapon.deaths;
    }
  }
  return [...combined.values()].map(metric => ({ ...metric, weapons: metric.weapons.sort((a, b) => b.rounds - a.rounds || a.weapon.localeCompare(b.weapon)) }));
}
