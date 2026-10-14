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

export function captureConsistencyIssues(input: {
  ourScore: number | null;
  theirScore: number | null;
  rounds: ReadonlyArray<{ result?: string; screenshotEvidence?: { eventsComplete?: boolean; events?: ScreenshotKillEvent[] } }>;
  players: ReadonlyArray<{ kills?: number | null; deaths?: number | null }>;
}) {
  const issues: string[] = [];
  const decided = input.rounds.filter(round => round.result === 'W' || round.result === 'L');
  if (input.ourScore !== null && input.theirScore !== null && decided.length > 0) {
    const wins = decided.filter(round => round.result === 'W').length;
    const losses = decided.length - wins;
    if (wins !== input.ourScore || losses !== input.theirScore) issues.push(`Round results total ${wins}-${losses}, but the scoreboard is ${input.ourScore}-${input.theirScore}.`);
  }
  const allKda = input.players.length === 10 && input.players.every(player => Number.isInteger(player.kills) && Number.isInteger(player.deaths));
  if (allKda) {
    const kills = input.players.reduce((sum, player) => sum + Number(player.kills), 0);
    const deaths = input.players.reduce((sum, player) => sum + Number(player.deaths), 0);
    // Resurrections and non-player deaths can create a small legitimate gap.
    if (Math.abs(kills - deaths) > 2) issues.push(`Player totals are inconsistent (${kills} kills vs ${deaths} deaths).`);
  }
  for (let index = 0; index < input.rounds.length; index += 1) {
    const evidence = input.rounds[index].screenshotEvidence;
    if (!evidence?.eventsComplete) continue;
    const sequences = (evidence.events || []).map(event => event.sequence);
    if (!sequences.every((sequence, eventIndex) => sequence === eventIndex + 1)) issues.push(`Round ${index + 1} has an incomplete event order.`);
  }
  return issues;
}
