import type { EconomyClass, PlayerScreenshotMetrics, Round } from '../src/types';
import { knownResult } from './analyticsEvidence';
import { normalizeCaptureName } from './scrimCaptureImport';

export const PLAYER_SCREENSHOT_CALCULATION_VERSION = 'player-screenshot-metrics/v2' as const;

export function screenshotPlayerIdentity(playerId: unknown, displayName: unknown): string {
  const supplied = typeof playerId === 'string' ? playerId.trim() : '';
  if (supplied && !supplied.toLocaleLowerCase().startsWith('name:')) return supplied;
  const name = supplied ? supplied.slice(5) : displayName;
  return `name:${normalizeCaptureName(name)}`;
}

function roundPlayerIdentity(matchId: string, playerId: unknown, displayName: unknown): string {
  const supplied = typeof playerId === 'string' ? playerId.trim() : '';
  if (supplied && !supplied.toLocaleLowerCase().startsWith('name:')) return supplied;
  const observed = supplied ? supplied.slice(5) : displayName;
  return `unlinked:${matchId}:${normalizeCaptureName(observed)}`;
}

function stablePlayerIdentity(playerId: unknown): string | null {
  const supplied = typeof playerId === 'string' ? playerId.trim() : '';
  return supplied && !supplied.toLocaleLowerCase().startsWith('name:') ? supplied : null;
}

function observedPlayerName(playerId: unknown, displayName: unknown): string {
  const supplied = typeof playerId === 'string' ? playerId.trim() : '';
  return normalizeCaptureName(supplied.toLocaleLowerCase().startsWith('name:') ? supplied.slice(5) : displayName);
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
const PISTOLS = ['classic', 'ghost', 'sheriff', 'frenzy', 'shorty', 'bandit'];

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
  schemaVersion: 1, calculationVersion: PLAYER_SCREENSHOT_CALCULATION_VERSION, identity, displayName, coveredRounds: 0, wins: 0, losses: 0,
  firstKills: 0, firstDeaths: 0, trades: 0, multikills: { two: 0, three: 0, four: 0, ace: 0 },
  lowBudgetWins: 0, highBudgetLosses: 0, antiEcoLosses: 0,
  kast: { successful: 0, covered: 0 }, weapons: [],
});

/** Derive only from confirmed screenshots. Missing fields never become zero-value evidence. */
export function buildPlayerScreenshotMetrics(rounds: readonly Round[]) {
  const players = new Map<string, Mutable>();
  const coveredRoundKeys = new Set<string>();
  const cumulativeAssists = new Map<string, { roundNo: number; value: number }>();
  const orderedRounds = [...rounds].sort((a, b) => a.matchId.localeCompare(b.matchId) || a.roundNo - b.roundNo);
  for (const round of orderedRounds) {
    const evidence = round.screenshotEvidence;
    const result = knownResult(round.result);
    if (!evidence || evidence.reviewStatus !== 'confirmed' || !result) continue;
    const roundKey = `${round.matchId}\u0000${round.roundNo}`;
    if (coveredRoundKeys.has(roundKey)) continue;
    coveredRoundKeys.add(roundKey);
    const ours = evidence.players.filter(player => player.team === 'ours');
    const unlinkedNameCounts = new Map<string, number>();
    for (const observation of ours) {
      if (stablePlayerIdentity(observation.playerId)) continue;
      const name = observedPlayerName(observation.playerId, observation.displayName);
      if (name) unlinkedNameCounts.set(name, (unlinkedNameCounts.get(name) || 0) + 1);
    }
    const ambiguousNames = new Set([...unlinkedNameCounts].filter(([, count]) => count > 1).map(([name]) => name));
    const ambiguousOccurrences = new Map<string, number>();
    const ourEquipment = classifyTeamEquipment(evidence.players, 'ours');
    const enemyEquipment = classifyTeamEquipment(evidence.players, 'theirs');
    const ourEconomy = ourEquipment !== 'unknown' ? ourEquipment : classifyAverageLoadout(evidence.ourAverageLoadout);
    const enemyEconomy = enemyEquipment !== 'unknown' ? enemyEquipment : classifyAverageLoadout(evidence.enemyAverageLoadout);
    const events = [...(evidence.events || [])].sort((a, b) => a.sequence - b.sequence);
    const eventsComplete = evidence.eventsComplete === true
      && events.every((event, index) => event.sequence === index + 1);
    const openingComplete = (evidence.openingEventComplete === true || (evidence.openingEventComplete === undefined && eventsComplete))
      && events[0]?.sequence === 1
      && !!events[0].killerPlayerId
      && !!events[0].victimPlayerId;
    const first = openingComplete ? events[0] : undefined;
    const kills = new Map<string, number>();
    const deaths = new Map<string, number>();
    const tradeKills = new Map<string, number>();
    const weaponKills = new Map<string, Map<string, number>>();
    for (const event of eventsComplete ? events : []) {
      const killerName = observedPlayerName(event.killerPlayerId, '');
      const victimName = observedPlayerName(event.victimPlayerId, '');
      const killerId = event.killerPlayerId && !ambiguousNames.has(killerName) ? roundPlayerIdentity(round.matchId, event.killerPlayerId, '') : null;
      const victimId = event.victimPlayerId && !ambiguousNames.has(victimName) ? roundPlayerIdentity(round.matchId, event.victimPlayerId, '') : null;
      if (killerId) kills.set(killerId, (kills.get(killerId) || 0) + 1);
      if (victimId) deaths.set(victimId, (deaths.get(victimId) || 0) + 1);
      const weapon = event.weapon?.trim();
      if (weapon && killerId) {
        const byWeapon = weaponKills.get(killerId) || new Map<string, number>();
        byWeapon.set(weapon, (byWeapon.get(weapon) || 0) + 1); weaponKills.set(killerId, byWeapon);
      }
    }
    if (eventsComplete) {
      for (const [index, death] of events.entries()) {
        if (typeof death.tradedWithinSeconds !== 'number' || death.tradedWithinSeconds < 0 || death.tradedWithinSeconds > 5
          || !death.killerPlayerId || !death.victimTeam || typeof death.occurredAtSeconds !== 'number') continue;
        const trade = events.slice(index + 1).find(candidate => candidate.victimPlayerId === death.killerPlayerId
          && candidate.killerTeam === death.victimTeam
          && typeof candidate.occurredAtSeconds === 'number'
          && candidate.occurredAtSeconds >= death.occurredAtSeconds!
          && candidate.occurredAtSeconds - death.occurredAtSeconds! <= 5);
        const traderName = observedPlayerName(trade?.killerPlayerId, '');
        const traderId = trade?.killerPlayerId && !ambiguousNames.has(traderName)
          ? roundPlayerIdentity(round.matchId, trade.killerPlayerId, '') : null;
        if (traderId) tradeKills.set(traderId, (tradeKills.get(traderId) || 0) + 1);
      }
    }
    const seenOurPlayers = new Set<string>();
    for (const observation of ours) {
      const normalizedName = normalizeCaptureName(observation.displayName);
      if (!observation.playerId && !normalizedName) continue;
      const stableIdentity = stablePlayerIdentity(observation.playerId);
      const observedName = observedPlayerName(observation.playerId, observation.displayName);
      const ambiguous = !stableIdentity && ambiguousNames.has(observedName);
      const occurrence = ambiguous ? (ambiguousOccurrences.get(observedName) || 0) + 1 : 0;
      if (ambiguous) ambiguousOccurrences.set(observedName, occurrence);
      const identity = stableIdentity || (ambiguous
        ? `unlinked:${round.matchId}:${round.roundNo}:${observedName}:${occurrence}`
        : roundPlayerIdentity(round.matchId, observation.playerId, observation.displayName));
      if (seenOurPlayers.has(identity)) continue;
      seenOurPlayers.add(identity);
      const metric = players.get(identity) || empty(identity, observation.displayName);
      players.set(identity, metric);
      metric.coveredRounds += 1;
      result === 'win' ? metric.wins += 1 : metric.losses += 1;
      if (result === 'win' && (ourEconomy === 'eco' || ourEconomy === 'low')) metric.lowBudgetWins += 1;
      if (result === 'loss' && ourEconomy === 'full') metric.highBudgetLosses += 1;
      if (result === 'loss' && ourEconomy === 'full' && (enemyEconomy === 'eco' || enemyEconomy === 'low')) metric.antiEcoLosses += 1;
      const playerId = stableIdentity || (!ambiguous && typeof observation.playerId === 'string' && observation.playerId.length > 0
        ? roundPlayerIdentity(round.matchId, observation.playerId, observation.displayName)
        : null);
      const firstKillerName = observedPlayerName(first?.killerPlayerId, '');
      const firstVictimName = observedPlayerName(first?.victimPlayerId, '');
      const firstKillerId = first?.killerPlayerId && !ambiguousNames.has(firstKillerName) ? roundPlayerIdentity(round.matchId, first.killerPlayerId, '') : null;
      const firstVictimId = first?.victimPlayerId && !ambiguousNames.has(firstVictimName) ? roundPlayerIdentity(round.matchId, first.victimPlayerId, '') : null;
      if (playerId && firstKillerId === playerId) metric.firstKills += 1;
      if (playerId && firstVictimId === playerId) metric.firstDeaths += 1;
      if (playerId && eventsComplete) metric.trades! += tradeKills.get(playerId) || 0;
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
      const assistKey = `${round.matchId}\u0000${identity}`;
      const previousAssists = cumulativeAssists.get(assistKey);
      let roundAssists: number | null = null;
      if (typeof observation.assists === 'number' && Number.isFinite(observation.assists) && observation.assists >= 0) {
        if (round.roundNo === 1) roundAssists = observation.assists;
        else if (previousAssists?.roundNo === round.roundNo - 1 && observation.assists >= previousAssists.value) roundAssists = observation.assists - previousAssists.value;
        cumulativeAssists.set(assistKey, { roundNo: round.roundNo, value: observation.assists });
      }
      const assistsKnown = roundAssists !== null;
      const survivalKnown = typeof observation.survived === 'boolean';
      const eventCoverage = !!playerId && eventsComplete;
      if (survivalKnown && eventCoverage) {
        const traded = events.some(event => event.victimPlayerId === observation.playerId && typeof event.tradedWithinSeconds === 'number' && event.tradedWithinSeconds <= 5);
        const successWithoutAssist = (roundKills || 0) > 0 || observation.survived || traded;
        // A kill, survival, or traded death proves KAST success even when the
        // cumulative scoreboard cannot yield an exact assist delta. A failed
        // round is covered only when assists are also known to be zero.
        if (successWithoutAssist || assistsKnown) {
          metric.kast!.covered += 1;
          if (successWithoutAssist || roundAssists! > 0) metric.kast!.successful += 1;
        }
      }
    }
  }
  return [...players.values()].map(metric => ({ ...metric, weapons: metric.weapons.sort((a, b) => b.rounds - a.rounds || a.weapon.localeCompare(b.weapon)) }));
}

/** Refresh saved match summaries from their retained confirmed round evidence. */
export function materializeScreenshotMetricsFromRoundEvidence(data: { rounds?: Round[]; playerStats?: any[] }, matchId?: string) {
  const rounds = data.rounds || []; const stats = data.playerStats || [];
  const matchIds = [...new Set(rounds.filter(round => round.screenshotEvidence && (!matchId || round.matchId === matchId)).map(round => round.matchId))];
  let changed = 0;
  for (const id of matchIds) {
    const byIdentity = new Map(buildPlayerScreenshotMetrics(rounds.filter(round => round.matchId === id)).map(metric => [metric.identity, metric]));
    for (const stat of stats.filter(stat => stat.matchId === id)) {
      const metric = byIdentity.get(screenshotPlayerIdentity(stat.playerId, stat.displayNameSnapshot || stat.player || ''));
      if (!metric) continue;
      const { identity: _identity, displayName: _displayName, ...screenshotMetrics } = metric;
      stat.screenshotMetrics = screenshotMetrics; changed += 1;
    }
  }
  return changed;
}

/**
 * Fill scoreboard FD totals when every played round has a securely resolved
 * opening event. Legacy captures predate openingEventComplete; source row zero
 * is their conservative proof that no earlier kill row was skipped.
 */
export function materializeFirstDeathsFromRoundEvidence(
  data: { matches?: any[]; rounds?: any[]; playerStats?: any[] },
  options: { overwrite?: boolean; matchId?: string } = {},
) {
  let changed = 0;
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const allRounds = Array.isArray(data.rounds) ? data.rounds : [];
  const stats = Array.isArray(data.playerStats) ? data.playerStats : [];
  for (const match of matches) {
    if (options.matchId && match.id !== options.matchId) continue;
    const rounds = allRounds.filter(round => round.matchId === match.id).sort((a, b) => Number(a.roundNo) - Number(b.roundNo));
    const expectedRounds = Number.isInteger(match.ourScore) && Number.isInteger(match.theirScore) ? Number(match.ourScore) + Number(match.theirScore) : null;
    if (!rounds.length || (expectedRounds !== null && rounds.length !== expectedRounds)) continue;
    const firstDeaths = new Map<string, number>();
    let complete = true;
    for (const round of rounds) {
      const evidence = round.screenshotEvidence;
      const first = [...(evidence?.events || [])].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence))[0];
      const legacyOpening = evidence?.openingEventComplete === undefined
        && (evidence?.eventsComplete === true || first?.sourceRow === 0);
      if (!(evidence?.openingEventComplete === true || legacyOpening)
        || first?.sequence !== 1 || !first.killerPlayerId || !first.victimPlayerId || !first.killerTeam || !first.victimTeam) {
        complete = false; break;
      }
      if (first.victimTeam === 'ours') firstDeaths.set(first.victimPlayerId, (firstDeaths.get(first.victimPlayerId) || 0) + 1);
    }
    if (!complete) continue;
    for (const stat of stats) {
      if (stat.matchId !== match.id || (!options.overwrite && stat.fd !== null && stat.fd !== undefined)) continue;
      const identity = screenshotPlayerIdentity(stat.playerId, stat.displayNameSnapshot || stat.player || '');
      stat.fd = firstDeaths.get(identity) || 0;
      changed += 1;
    }
  }
  return changed;
}

/**
 * Fill the round-log opening columns from securely resolved screenshot kill
 * feeds. Existing values may be coach corrections, so migration only fills
 * blanks and never replaces them.
 */
export function materializeRoundOpeningsFromScreenshotEvidence(
  data: { rounds?: any[] },
  options: { matchId?: string } = {},
) {
  let changed = 0;
  const rounds = Array.isArray(data.rounds) ? data.rounds : [];
  for (const round of rounds) {
    if (options.matchId && round.matchId !== options.matchId) continue;
    const evidence = round.screenshotEvidence;
    const first = [...(evidence?.events || [])].sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence))[0];
    const legacyOpening = evidence?.openingEventComplete === undefined
      && (evidence?.eventsComplete === true || first?.sourceRow === 0);
    if (!(evidence?.openingEventComplete === true || legacyOpening)
      || first?.sequence !== 1 || !first.killerPlayerId || !first.victimPlayerId) continue;

    const names = new Map<string, string>();
    for (const player of evidence.players || []) {
      const displayName = typeof player.displayName === 'string' ? player.displayName.trim() : '';
      if (!displayName) continue;
      const rawId = typeof player.playerId === 'string' ? player.playerId.trim() : '';
      if (rawId) names.set(rawId, displayName);
      names.set(screenshotPlayerIdentity(player.playerId, player.displayName), displayName);
    }
    const resolve = (playerId: unknown) => {
      const rawId = typeof playerId === 'string' ? playerId.trim() : '';
      return rawId ? names.get(rawId) || names.get(screenshotPlayerIdentity(rawId, '')) || null : null;
    };
    const firstKillBy = resolve(first.killerPlayerId);
    const firstDeathBy = resolve(first.victimPlayerId);
    if (!round.firstKillBy && firstKillBy) { round.firstKillBy = firstKillBy; changed += 1; }
    if (!round.firstDeathBy && firstDeathBy) { round.firstDeathBy = firstDeathBy; changed += 1; }
  }
  return changed;
}

/**
 * Retained objective rows are authoritative positive evidence that a plant
 * occurred. Only fill an unknown legacy flag: an explicit coach Yes/No remains
 * a correction and is never replaced by the migration.
 */
export function materializeRoundPlantsFromScreenshotEvidence(
  data: { rounds?: any[] },
  options: { matchId?: string } = {},
) {
  let changed = 0;
  const rounds = Array.isArray(data.rounds) ? data.rounds : [];
  for (const round of rounds) {
    if (options.matchId && round.matchId !== options.matchId) continue;
    if (round.plant !== undefined && round.plant !== null && String(round.plant).trim() !== '') continue;
    const hasPlant = (round.screenshotEvidence?.objectives || []).some((event: any) => event?.type === 'plant');
    if (!hasPlant) continue;
    round.plant = 'TRUE';
    changed += 1;
  }
  return changed;
}

export function combinePlayerScreenshotMetrics(metrics: ReadonlyArray<PlayerScreenshotMetrics & { identity: string; displayName: string }>) {
  const combined = new Map<string, Mutable>();
  for (const source of metrics) {
    const displayName = source.displayName || 'Unknown player';
    const identity = source.identity.startsWith('unlinked:')
      ? `unlinked-name:${normalizeCaptureName(displayName)}`
      : source.identity;
    const target = combined.get(identity) || empty(identity, displayName);
    combined.set(identity, target);
    for (const field of ['coveredRounds', 'wins', 'losses', 'firstKills', 'firstDeaths', 'lowBudgetWins', 'highBudgetLosses', 'antiEcoLosses'] as const) target[field] += source[field] || 0;
    target.trades! += source.trades || 0;
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

export function combineStoredScreenshotMetrics(rows: ReadonlyArray<{ id?: string; playerId?: string | null; player?: string; displayNameSnapshot?: string; screenshotMetrics?: PlayerScreenshotMetrics }>) {
  const metrics = rows.flatMap((row, index) => {
    if (!row.screenshotMetrics) return [];
    const displayName = row.displayNameSnapshot || row.player || 'Unknown player';
    return [{
      ...row.screenshotMetrics,
      identity: row.playerId ? screenshotPlayerIdentity(row.playerId, displayName) : `unlinked:${row.id?.trim() || index}`,
      displayName,
    }];
  });
  return combinePlayerScreenshotMetrics(metrics);
}
