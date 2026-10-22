import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAutomaticCaptureImport } from '../lib/automaticCaptureImport';
import { captureRoundRows, captureSideTallies, sideForRound } from '../lib/captureRoundRows';

const events = [{ sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'ours' }, { sequence: 3, victimTeam: 'theirs' }];
const evidence = (reviewStatus: string) => ({ reviewStatus, confidence: 'high', eventsComplete: true, events, ourAverageLoadout: 4800, enemyAverageLoadout: 900 });
const capture = () => ({
  meta: { map: 'Ascent', ourScore: 13, theirScore: 9 },
  startingSide: { firstHalf: 'Att' }, reconciled: { missing: [] },
  players: Array.from({ length: 10 }, (_, index) => ({ include: index < 5, matchedPlayerId: index < 5 ? `p${index}` : null, extractedName: `Player ${index}`, kills: 10 + index, deaths: 8, assists: 4 })),
  rounds: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index < 13 ? 'W' : 'L', extractionIssues: [] as string[], screenshotEvidence: evidence(index === 4 ? 'review-required' : 'confirmed') as any })),
});

describe('one round-row builder for both capture paths', () => {
  it('assigns sides through both halves and alternating overtime', () => {
    expect([1, 12, 13, 24, 25, 26].map(roundNo => sideForRound(roundNo, 'Att'))).toEqual(['Att', 'Att', 'Def', 'Def', 'Att', 'Def']);
    expect(captureSideTallies([{ roundNo: 1, result: 'W' }, { roundNo: 13, result: 'W' }, { roundNo: 14, result: 'L' }, { roundNo: 2, result: '' }], 'Att')).toEqual({ attW: 1, attL: 0, defW: 1, defL: 1 });
  });

  it('labels buys and advantage states only from confirmed evidence', () => {
    const [confirmed, pending, manual] = captureRoundRows([
      { roundNo: 1, result: 'W', screenshotEvidence: evidence('confirmed') },
      { roundNo: 2, result: 'W', screenshotEvidence: evidence('review-required') },
      { roundNo: 3, result: 'L' },
    ], 'Def');
    expect(confirmed).toMatchObject({ side: 'Def', buy: 'Full', enemyBuy: expect.stringMatching(/\w/), advantageEvidence: { status: 'complete' } });
    expect(pending).toMatchObject({ buy: '', enemyBuy: '', screenshotEvidence: { reviewStatus: 'review-required' }, advantageEvidence: { status: 'partial' } });
    // A round typed in by hand carries no evidence keys at all.
    expect(manual).toEqual({ roundNo: 3, side: 'Def', result: 'L', winBy: '', buy: '', enemyBuy: '' });
  });

  it('is exactly what the automatic save stores', () => {
    const extracted = capture();
    const { payload } = buildAutomaticCaptureImport(extracted, { settings: { maps: ['Ascent'] }, matches: [], playerStats: [] } as any, 'capture-1');
    expect(payload!.roundRows).toEqual(captureRoundRows(extracted.rounds, 'Att'));
    expect(payload!.match).toMatchObject(captureSideTallies(extracted.rounds, 'Att'));
  });

  it('is what the coach capture review saves (no second builder left in the component)', () => {
    const component = fs.readFileSync('src/components/ScrimImport.tsx', 'utf8');
    expect(component).toContain('captureRoundRows(rounds, meta.firstHalf)');
    expect(component).toContain('captureSideTallies(');
    expect(component).not.toMatch(/const (sideForRound|economyLabel) =/);
  });
});
