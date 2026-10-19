import { describe, expect, it } from 'vitest';
import { deriveRoundAdvantage, summarizeRoundAdvantages } from '../lib/roundAdvantage';

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

  it('summarizes conversions and losses by exact state', () => {
    const won = deriveRoundAdvantage({ source: 'screenshot', complete: true, winner: 'W', events: [{ sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'ours' }, { sequence: 3, victimTeam: 'theirs' }] });
    const lost = deriveRoundAdvantage({ source: 'replay', complete: true, winner: 'L', events: [{ sequence: 1, victimTeam: 'theirs' }, { sequence: 2, victimTeam: 'ours' }, { sequence: 3, victimTeam: 'ours' }, { sequence: 4, victimTeam: 'ours' }, { sequence: 5, victimTeam: 'ours' }] });
    expect(summarizeRoundAdvantages([{ advantageEvidence: won }, { advantageEvidence: lost }]).find(row => row.label === '5v4')).toMatchObject({ opportunities: 2, converted: 1, lost: 1, conversionRate: 50 });
  });
});
