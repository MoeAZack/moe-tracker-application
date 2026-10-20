import { describe, expect, it } from 'vitest';
import { matchExtractedRosterName } from '../lib/entryEngine';

describe('screenshot roster name matching', () => {
  it('matches name-only roster entries the way it did before the shared identity resolver', () => {
    const roster = [{ displayName: 'Alpha One' }, { displayName: 'Bravo' }];
    const matched = matchExtractedRosterName('ALPHA ONE', roster);
    expect(matched).toMatchObject({ matchedPlayerId: null, matchedPlayerName: 'Alpha One', rosterMatch: { status: 'matched', candidatePlayerNames: ['Alpha One'] } });
    expect(matchExtractedRosterName('Charlie', roster).rosterMatch.status).toBe('unmatched');
  });

  it('keeps id-backed matches and ambiguity across mixed rosters', () => {
    const roster = [{ id: 'p1', displayName: 'Delta' }, { displayName: 'Delta' }, { id: 'p3', displayName: 'Echo' }];
    expect(matchExtractedRosterName('Echo', roster)).toMatchObject({ matchedPlayerId: 'p3', rosterMatch: { status: 'matched', candidatePlayerIds: ['p3'] } });
    expect(matchExtractedRosterName('Delta', roster).rosterMatch).toMatchObject({ status: 'ambiguous', candidatePlayerIds: ['p1'], candidatePlayerNames: ['Delta', 'Delta'] });
  });
});
