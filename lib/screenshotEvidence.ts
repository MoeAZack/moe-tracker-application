import type { ScreenshotKillEvent, ScreenshotPlayerRoundEvidence } from '../src/types';

export interface ScreenshotEventDetail {
  sourceRow: number;
  occurredAtSeconds: number | null;
  distanceMeters: number | null;
}

/** Merge OCR-only event details with portrait-classified identities. */
export function enrichScreenshotEvents(
  events: readonly ScreenshotKillEvent[],
  details: readonly ScreenshotEventDetail[],
): ScreenshotKillEvent[] {
  const detailByRow = new Map(details.map(detail => [detail.sourceRow, detail]));
  const enriched = events.map(event => {
    const detail = typeof event.sourceRow === 'number' ? detailByRow.get(event.sourceRow) : undefined;
    return {
      ...event,
      occurredAtSeconds: detail?.occurredAtSeconds ?? null,
      distanceMeters: detail?.distanceMeters ?? null,
      tradedWithinSeconds: null,
    };
  });
  for (let index = 0; index < enriched.length; index += 1) {
    const death = enriched[index];
    if (!death.killerPlayerId || !death.victimTeam || typeof death.occurredAtSeconds !== 'number') continue;
    const trade = enriched.slice(index + 1).find(candidate => candidate.victimPlayerId === death.killerPlayerId
      && candidate.killerTeam === death.victimTeam
      && typeof candidate.occurredAtSeconds === 'number'
      && candidate.occurredAtSeconds >= death.occurredAtSeconds!
      && candidate.occurredAtSeconds - death.occurredAtSeconds! <= 5);
    if (trade && typeof trade.occurredAtSeconds === 'number') death.tradedWithinSeconds = trade.occurredAtSeconds - death.occurredAtSeconds;
  }
  return enriched;
}

/** The identity key the kill-feed classifier assigns to a player that has no roster id yet. */
export function rawEventIdentity(displayName: string): string {
  return `name:${String(displayName || '').trim().toLocaleLowerCase()}`;
}

/**
 * Re-key round players and kill events onto one canonical identity.
 *
 * Kill events are classified before roster matching, so their ids are raw
 * `name:<ocr text>` keys, while players are later keyed by roster id. Every
 * key the classifier could have produced is mapped to the canonical id so
 * FK/FD, survival, KAST, trades and weapon kills join on the same player.
 */
export function canonicalizeRoundIdentities<P extends ScreenshotPlayerRoundEvidence>(input: {
  players: readonly P[];
  events: readonly ScreenshotKillEvent[];
  resolve: (rawName: string) => { displayName: string; playerId: string };
  extraRawNames?: readonly string[];
}): { players: P[]; events: ScreenshotKillEvent[] } {
  const identities = new Map<string, string>();
  for (const rawName of input.extraRawNames || []) identities.set(rawEventIdentity(rawName), input.resolve(rawName).playerId);
  const players = input.players.map(player => {
    const { displayName, playerId } = input.resolve(player.displayName);
    identities.set(rawEventIdentity(player.displayName), playerId);
    if (player.playerId) identities.set(player.playerId, playerId);
    return { ...player, displayName, playerId };
  });
  const remap = (id: string | null | undefined) => (id ? identities.get(id) || id : null);
  const events = input.events.map(event => ({ ...event, killerPlayerId: remap(event.killerPlayerId), victimPlayerId: remap(event.victimPlayerId) }));
  return { players, events };
}

/** Survival is exact only when every elimination identity was resolved. */
export function addSurvivalEvidence(
  players: readonly ScreenshotPlayerRoundEvidence[],
  events: readonly ScreenshotKillEvent[],
  eventsComplete: boolean,
): ScreenshotPlayerRoundEvidence[] {
  if (!eventsComplete) return players.map(player => ({ ...player, survived: null }));
  const victims = new Set(events.map(event => event.victimPlayerId).filter((id): id is string => typeof id === 'string' && id.length > 0));
  return players.map(player => {
    const identity = player.playerId || `name:${player.displayName.trim().toLocaleLowerCase()}`;
    return { ...player, survived: !victims.has(identity) };
  });
}

export interface CaptureConsistencyReport {
  /** Contradictions the coach must resolve (edit rounds or score) before saving. */
  errors: string[];
  /** Plausible-but-unusual totals; saving needs an explicit acknowledgement. */
  warnings: string[];
}

export function captureConsistencyReport(input: {
  ourScore: number | null;
  theirScore: number | null;
  rounds: ReadonlyArray<{ result?: string; screenshotEvidence?: { eventsComplete?: boolean; events?: ScreenshotKillEvent[] } }>;
  players: ReadonlyArray<{ kills?: number | null; deaths?: number | null }>;
}): CaptureConsistencyReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const decided = input.rounds.filter(round => round.result === 'W' || round.result === 'L');
  if (input.ourScore !== null && input.theirScore !== null && decided.length > 0) {
    const wins = decided.filter(round => round.result === 'W').length;
    const losses = decided.length - wins;
    if (wins !== input.ourScore || losses !== input.theirScore) errors.push(`Round results total ${wins}-${losses}, but the scoreboard is ${input.ourScore}-${input.theirScore}.`);
  }
  const allKda = input.players.length === 10 && input.players.every(player => Number.isInteger(player.kills) && Number.isInteger(player.deaths));
  if (allKda) {
    const kills = input.players.reduce((sum, player) => sum + Number(player.kills), 0);
    const deaths = input.players.reduce((sum, player) => sum + Number(player.deaths), 0);
    // Spike detonations, fall/self damage and revives legitimately separate
    // kills from deaths, so a gap is a warning to double-check, not a block.
    const roundCount = Math.max(1, input.rounds.length);
    if (kills > deaths + 2) warnings.push(`More kills than deaths (${kills} vs ${deaths}); check for a misread digit.`);
    else if (deaths - kills > Math.max(3, Math.ceil(roundCount * 0.25))) warnings.push(`Deaths exceed kills by ${deaths - kills} (${kills} vs ${deaths}); spike or fall deaths explain a small gap, a larger one usually means a misread digit.`);
  }
  for (let index = 0; index < input.rounds.length; index += 1) {
    const evidence = input.rounds[index].screenshotEvidence;
    if (!evidence?.eventsComplete) continue;
    const sequences = (evidence.events || []).map(event => event.sequence);
    if (!sequences.every((sequence, eventIndex) => sequence === eventIndex + 1)) warnings.push(`Round ${index + 1} has an incomplete event order.`);
  }
  return { errors, warnings };
}

/** Back-compatible flat list of every consistency finding. */
export function captureConsistencyIssues(input: Parameters<typeof captureConsistencyReport>[0]) {
  const report = captureConsistencyReport(input);
  return [...report.errors, ...report.warnings];
}

/**
 * VALORANT can show a previous match's player table under a new header
 * (seen on real captures: two sessions with identical KDA tables but
 * different scores and dates). Flag a draft whose allied K/D/A lines exactly
 * match an already-saved match so the coach doesn't import the same game twice.
 */
export function findDuplicateScoreboardMatch(
  draftPlayers: ReadonlyArray<{ include?: boolean; kills?: number | null; deaths?: number | null; assists?: number | null }>,
  savedStats: ReadonlyArray<{ matchId?: string; kills?: number | null; deaths?: number | null; assists?: number | null }>,
): string | null {
  const line = (row: { kills?: number | null; deaths?: number | null; assists?: number | null }) => `${row.kills}/${row.deaths}/${row.assists}`;
  const allied = draftPlayers.filter(player => player.include && Number.isInteger(player.kills) && Number.isInteger(player.deaths) && Number.isInteger(player.assists)).map(line).sort();
  if (allied.length < 4) return null;
  const byMatch = new Map<string, string[]>();
  for (const row of savedStats) {
    if (!row.matchId || !Number.isInteger(row.kills) || !Number.isInteger(row.deaths) || !Number.isInteger(row.assists)) continue;
    byMatch.set(row.matchId, [...(byMatch.get(row.matchId) || []), line(row)]);
  }
  const signature = allied.join('|');
  for (const [matchId, lines] of byMatch) if (lines.sort().join('|') === signature) return matchId;
  return null;
}
