import { roundEconomyLabel } from './captureRoundRows';
import { deriveRoundAdvantage } from './roundAdvantage';

/**
 * A coach accepts the screenshot evidence of one saved round. Returns the
 * match's rows with that round confirmed and its screenshot advantage states
 * re-derived and blank buy labels filled, or null when the round has no evidence waiting for review.
 */
export function acceptRoundEvidence(rows: any[], roundNo: number, actor: string, acceptedAt = new Date().toISOString()): any[] | null {
  const target = rows.find(round => Number(round?.roundNo) === roundNo);
  if (!target?.screenshotEvidence || target.screenshotEvidence.reviewStatus === 'confirmed') return null;
  return rows.map(round => {
    if (round !== target) return round;
    const screenshotEvidence = { ...round.screenshotEvidence, reviewStatus: 'confirmed', acceptedBy: actor, acceptedAt };
    // Replay-sourced advantage evidence outranks screenshots and is left alone.
    const advantageEvidence = round.advantageEvidence?.source && round.advantageEvidence.source !== 'screenshot' ? round.advantageEvidence : deriveRoundAdvantage({
      source: 'screenshot', complete: screenshotEvidence.eventsComplete === true, winner: round.result,
      events: (screenshotEvidence.events || []).map((event: any) => ({ sequence: event.sequence, victimTeam: event.victimTeam })),
    });
    // Fill-only: a buy label a coach already entered is never replaced.
    return { ...round, screenshotEvidence, advantageEvidence, buy: round.buy || roundEconomyLabel(screenshotEvidence, 'ours'), enemyBuy: round.enemyBuy || roundEconomyLabel(screenshotEvidence, 'theirs') };
  });
}
