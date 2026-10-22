import { describe, expect, it } from 'vitest';
import { findMatchCandidates, sameMatchHeader, similarMatchName } from '../lib/matchIdentity';

const roster = ['p1', 'p2', 'p3', 'p4', 'p5'];
const statsFor = (matchId: string) => roster.map(playerId => ({ matchId, playerId }));
const data: any = {
  matches: [
    { id: 'captured', date: '2026-10-20', map: 'Ascent', opponent: 'Other', ourScore: 9, theirScore: 13, screenshotEvidence: { captureId: 'cap-1' } },
    { id: 'header', date: '2026-10-21', map: 'Lotus', opponent: 'Nova Esports', ourScore: 13, theirScore: 11 },
    { id: 'physical', date: '2026-10-21', map: 'Lotus', opponent: 'Nova Esports', ourScore: 13, theirScore: 11 },
    { id: 'blank', date: '2026-10-22', map: 'Unknown map', opponent: 'Unknown opponent', ourScore: null, theirScore: null },
  ],
  playerStats: statsFor('physical'),
};

describe('one match identity for every source', () => {
  it('prefers an exact source id over any header, even when the header disagrees', () => {
    const found = findMatchCandidates(data, { date: '2026-10-21', map: 'Lotus', ourScore: 13, theirScore: 11, screenshotEvidence: { captureId: 'CAP-1' } });
    expect(found).toMatchObject({ basis: 'source', matches: [{ id: 'captured' }] });
  });

  it('uses the five-player physical identity before a bare header', () => {
    const game = { date: '2026-10-21', map: 'lotus', opponent: 'Nova Esports', ourScore: 13, theirScore: 11 };
    expect(findMatchCandidates(data, game, { stats: roster.map(playerId => ({ playerId })) })).toMatchObject({ basis: 'physical', matches: [{ id: 'physical' }] });
    // Without player evidence both rows share the header; callers must narrow it.
    expect(findMatchCandidates(data, game).matches.map(match => match.id)).toEqual(['header', 'physical']);
  });

  it('compares map and opponent names the same way for every source', () => {
    expect(sameMatchHeader({ date: '2026-10-21', map: ' LOTUS ', opponent: 'Nova Esprts', ourScore: 13, theirScore: 11 }, data.matches[1])).toBe(true);
    expect(sameMatchHeader({ date: '2026-10-21', map: 'Lotus', opponent: 'Paper Rex', ourScore: 13, theirScore: 11 }, data.matches[1])).toBe(false);
    expect(sameMatchHeader({ date: '2026-10-21', map: 'Lotus', ourScore: 11, theirScore: 13 }, data.matches[1])).toBe(false);
    expect(sameMatchHeader({ date: '2026-10-20', map: 'Lotus', ourScore: 13, theirScore: 11 }, data.matches[1])).toBe(false);
    expect(similarMatchName('PYO', 'PY0')).toBe(false); // too short to tolerate an edit
    expect(similarMatchName('Nova', 'Nove')).toBe(true);
  });

  it('never lets an unknown field prove a match unless the caller allows it', () => {
    const game = { date: '2026-10-22', map: 'Bind', ourScore: 13, theirScore: 5 };
    expect(findMatchCandidates(data, game)).toEqual({ basis: null, matches: [] });
    expect(findMatchCandidates(data, game, { unknownMatches: true }).matches.map(match => match.id)).toEqual(['blank']);
    expect(findMatchCandidates(data, { date: '2026-10-21', map: null, ourScore: null, theirScore: null })).toEqual({ basis: null, matches: [] });
  });

  it('skips matches the caller may not reuse', () => {
    const found = findMatchCandidates(data, { date: '2026-10-21', map: 'Lotus', ourScore: 13, theirScore: 11 }, { exclude: match => match.id === 'header' });
    expect(found.matches.map(match => match.id)).toEqual(['physical']);
  });
});
