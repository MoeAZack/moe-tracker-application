import { describe, expect, it } from 'vitest';
import { deriveRoundAdvantage, summarizeRoundAdvantages, summarizeRoundAdvantageTotals } from '../lib/roundAdvantage';

describe('round advantage evidence', () => {
  it('records exact 5v3, 3v1 and 2v1 states when the round is lost', () => {
    const evidence = deriveRoundAdvantage({ source: 'replay', complete: true, winner: 'theirs', events: [
      { sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'theirs' },
      { sequence: 3, victimTeam: 'ours' }, { sequence: 4, victimTeam: 'ours' },
      { sequence: 5, victimTeam: 'theirs' }, { sequence: 6, victimTeam: 'theirs' },
      { sequence: 7, victimTeam: 'ours' }, { sequence: 8, victimTeam: 'ours' }, { sequence: 9, victimTeam: 'ours' },
    ] });
    expect(evidence).toMatchObject({ status: 'complete', roundOutcome: 'lost' });
    expect(evidence.states).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '5v3', outcome: 'lost' }),
      expect.objectContaining({ label: '3v1', outcome: 'lost' }),
      expect.objectContaining({ label: '2v1', outcome: 'lost' }),
    ]));
  });

  it('withholds advantage states when the ordered feed is incomplete', () => {
    expect(deriveRoundAdvantage({ source: 'vod', complete: false, winner: 'W', events: [{ sequence: 1, victimTeam: 'theirs' }] })).toMatchObject({ status: 'partial', roundOutcome: 'unknown', states: [] });
  });

  it('excludes a one-player 5v4 edge from user-facing throw counts', () => {
    const won = deriveRoundAdvantage({ source: 'screenshot', complete: true, winner: 'W', events: [{ sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'ours' }, { sequence: 3, victimTeam: 'theirs' }] });
    const lost = deriveRoundAdvantage({ source: 'replay', complete: true, winner: 'L', events: [{ sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'ours' }, { sequence: 3, victimTeam: 'ours' }, { sequence: 4, victimTeam: 'ours' }, { sequence: 5, victimTeam: 'ours' }] });
    expect(summarizeRoundAdvantages([{ advantageEvidence: won }, { advantageEvidence: lost }]).find(row => row.label === '5v4')).toBeUndefined();
    expect(summarizeRoundAdvantageTotals([{ advantageEvidence: won }, { advantageEvidence: lost }])).toMatchObject({ opportunities: 0, converted: 0, lost: 0, conversionRate: null });
  });

  it('does not infer a lost round without a proven winner', () => {
    const evidence = deriveRoundAdvantage({ source: 'vod', complete: true, winner: 'unknown', events: [
      { sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'theirs' },
      { sequence: 3, victimTeam: 'ours' }, { sequence: 4, victimTeam: 'ours' },
    ] });
    expect(evidence).toMatchObject({ status: 'complete', roundOutcome: 'unknown', reason: 'Round winner is not proven.' });
    expect(summarizeRoundAdvantageTotals([{ advantageEvidence: evidence }])).toMatchObject({ opportunities: 1, lost: 0, unknown: 1 });
  });

  it('accepts a terminal elimination state as proof when no winner label was read', () => {
    const evidence = deriveRoundAdvantage({ source: 'replay', complete: true, winner: 'unknown', events: [
      { sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'theirs' }, { sequence: 3, victimTeam: 'theirs' }, { sequence: 4, victimTeam: 'theirs' }, { sequence: 5, victimTeam: 'theirs' },
    ] });
    expect(evidence.roundOutcome).toBe('converted');
  });

  it('counts one overall opportunity when a round passes through several advantage states', () => {
    const lost = deriveRoundAdvantage({ source: 'replay', complete: true, winner: 'L', events: [
      { sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'theirs' }, { sequence: 3, victimTeam: 'ours' },
      { sequence: 4, victimTeam: 'ours' }, { sequence: 5, victimTeam: 'theirs' }, { sequence: 6, victimTeam: 'theirs' },
      { sequence: 7, victimTeam: 'ours' }, { sequence: 8, victimTeam: 'ours' }, { sequence: 9, victimTeam: 'ours' },
    ] });
    expect(lost.states.length).toBeGreaterThan(1);
    expect(summarizeRoundAdvantageTotals([{ advantageEvidence: lost }])).toMatchObject({ opportunities: 1, converted: 0, lost: 1 });
  });
});
