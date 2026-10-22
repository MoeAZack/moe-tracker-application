import { deriveRoundAdvantage } from './roundAdvantage';
import { classifyAverageLoadout, classifyTeamEquipment } from './scrimRoundAnalytics';

// One builder for the round log a scoreboard capture saves, used by both the
// automatic save and the coach's capture review, so the two paths can never
// label sides, buys or advantage states differently.

export type CaptureSide = 'Att' | 'Def';

export function sideForRound(roundNo: number, firstHalf: CaptureSide): CaptureSide {
  const opposite = firstHalf === 'Att' ? 'Def' : 'Att';
  if (roundNo <= 12) return firstHalf;
  if (roundNo <= 24) return opposite;
  return roundNo % 2 === 1 ? firstHalf : opposite; // overtime alternates
}

/** Buy label for one side of a round. An unconfirmed round keeps its raw evidence for review but labels nothing from it. */
export function roundEconomyLabel(evidence: any, team: 'ours' | 'theirs') {
  if (evidence?.reviewStatus !== 'confirmed') return '';
  const equipment = classifyTeamEquipment(evidence?.players || [], team);
  const label = equipment !== 'unknown' ? equipment : classifyAverageLoadout(team === 'ours' ? evidence?.ourAverageLoadout : evidence?.enemyAverageLoadout);
  return label === 'unknown' ? '' : label[0].toUpperCase() + label.slice(1);
}

export function captureSideTallies(rounds: readonly any[], firstHalf: CaptureSide) {
  let attW = 0; let attL = 0; let defW = 0; let defL = 0;
  for (const round of rounds) {
    const side = sideForRound(round.roundNo, firstHalf);
    if (round.result === 'W') { if (side === 'Att') attW++; else defW++; }
    if (round.result === 'L') { if (side === 'Att') attL++; else defL++; }
  }
  return { attW, attL, defW, defL };
}

export function captureRoundRows(rounds: readonly any[], firstHalf: CaptureSide) {
  return rounds.map(round => {
    const evidence = round.screenshotEvidence;
    return {
      roundNo: round.roundNo, side: sideForRound(round.roundNo, firstHalf), result: round.result, winBy: round.winBy || '',
      buy: roundEconomyLabel(evidence, 'ours'), enemyBuy: roundEconomyLabel(evidence, 'theirs'),
      ...(evidence ? {
        screenshotEvidence: evidence,
        advantageEvidence: deriveRoundAdvantage({ source: 'screenshot', complete: evidence.reviewStatus === 'confirmed' && evidence.eventsComplete === true, winner: round.result, events: (evidence.events || []).map((event: any) => ({ sequence: event.sequence, victimTeam: event.victimTeam })) }),
      } : {}),
    };
  });
}
