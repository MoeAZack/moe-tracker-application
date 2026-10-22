import { describe, expect, it } from 'vitest';
import { autonomousCaptureDecision } from '../lib/ocrAutonomy';
import { buildAutomaticCaptureImport } from '../lib/automaticCaptureImport';

const capture = () => ({
  meta: { map: 'Ascent', ourScore: 13, theirScore: 9 },
  startingSide: { firstHalf: 'Att' }, reconciled: { missing: [] },
  players: Array.from({ length: 10 }, (_, index) => ({ include: index < 5, matchedPlayerId: index < 5 ? `p${index}` : null, extractedName: `Player ${index}`, kills: 10 + index, deaths: 8, assists: 4 })),
  rounds: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index < 13 ? 'W' : 'L', extractionIssues: [] as string[], screenshotEvidence: { reviewStatus: 'confirmed', confidence: 'high' } as any })),
});
const uncertain = (round: any, confidence: string, issues: string[] = ['economy']) => {
  round.screenshotEvidence = { ...round.screenshotEvidence, reviewStatus: 'review-required', confidence };
  round.extractionIssues = issues;
};

describe('per-round automatic save', () => {
  it('saves the match when a few rounds only need their detail reviewed', () => {
    const extracted = capture(); uncertain(extracted.rounds[6], 'medium'); uncertain(extracted.rounds[2], 'high', ['event-log']);
    const decision = autonomousCaptureDecision(extracted, ['Ascent'], []);
    expect(decision).toMatchObject({ automatic: true, roundsNeedingReview: [3, 7] });
  });

  it('keeps blocking when a round result itself was not read', () => {
    const extracted = capture(); uncertain(extracted.rounds[6], 'medium', ['round-result']);
    expect(autonomousCaptureDecision(extracted, ['Ascent'], [])).toMatchObject({ automatic: false, reasons: expect.arrayContaining(['round-evidence-needs-review']) });
  });

  it('keeps blocking on a low-quality frame or an unknown confidence', () => {
    const low = capture(); uncertain(low.rounds[6], 'low');
    expect(autonomousCaptureDecision(low, ['Ascent'], []).automatic).toBe(false);
    const unknown = capture(); unknown.rounds[6].screenshotEvidence = { reviewStatus: 'review-required' };
    expect(autonomousCaptureDecision(unknown, ['Ascent'], []).automatic).toBe(false);
  });

  it('keeps blocking when more than a third of the rounds need review', () => {
    const extracted = capture(); for (const round of extracted.rounds.slice(0, 8)) uncertain(round, 'medium');
    expect(autonomousCaptureDecision(extracted, ['Ascent'], []).automatic).toBe(false);
    const atLimit = capture(); for (const round of atLimit.rounds.slice(0, 7)) uncertain(round, 'medium');
    expect(autonomousCaptureDecision(atLimit, ['Ascent'], []).automatic).toBe(true);
  });

  it('saves uncertain rounds unconfirmed and names them on the match', () => {
    const extracted = capture(); uncertain(extracted.rounds[6], 'medium');
    for (const round of extracted.rounds) Object.assign(round.screenshotEvidence, { ourAverageLoadout: 4200, enemyAverageLoadout: 4100 });
    const data: any = { settings: { maps: ['Ascent'] }, playerStats: [], matches: [], coreMemberships: [], tryoutBatches: [] };
    const { payload } = buildAutomaticCaptureImport(extracted, data, 'cap-1');
    expect(payload).not.toBeNull();
    expect(payload!.match.automation).toMatchObject({ mode: 'partial-round-review', roundsNeedingReview: [7] });
    expect(payload!.match.notes).toContain('Round 7 still needs review');
    const row = payload!.roundRows.find((item: any) => item.roundNo === 7);
    expect(row.screenshotEvidence.reviewStatus).toBe('review-required');
    expect(row.advantageEvidence.status).not.toBe('complete');
    expect(row.buy).toBe('');
    expect(row.enemyBuy).toBe('');
    expect(payload!.roundRows.find((item: any) => item.roundNo === 8).buy).not.toBe('');
  });
});
