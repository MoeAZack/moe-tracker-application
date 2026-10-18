import { describe, expect, it } from 'vitest';
import { confidentMatchesForSession, linkPracticeSession, practiceMatchSuggestions, practiceSessionProgress, suggestedMatchesForSession } from '../lib/practiceSessionProgress';

const scheduleId = '00000000-0000-4000-8000-000000000010';
const data = () => ({
  settings: { inactiveMaps: [] }, rosterPlayers: [],
  schedule: [{ id: scheduleId, date: '2026-10-18', primary: 'Scrim vs PYO', secondary: 'Ascent', attendance: {}, requiredPlayerIds: ['p1'], attendanceCheckIns: [{ id: 'a1', playerId: 'p1', checkedInAt: '', status: 'late' }] }],
  goals: [{ id: 'g1', date: '2026-10-18', goal: 'Improve anti-eco', status: 'Done' }],
  matches: [{ id: 'm1', date: '2026-10-18', opponent: 'PYO', map: 'Ascent', attW: 5, attL: 7, defW: 8, defL: 4, sourceMetadata: { method: 'manual', capturedAt: '2026-10-18T12:00:00Z' } }, { id: 'm2', date: '2026-10-18', opponent: 'MT', map: 'Lotus', attW: 6, attL: 6, defW: 5, defL: 7 }],
  playerStats: [], rounds: [], practiceBlocks: [], coachingSignals: [],
} as any);

describe('PRACC practice-to-progress linkage', () => {
  it('suggests same-day matches with the named opponent first', () => {
    expect(suggestedMatchesForSession(data().schedule[0], data().matches).map(match => match.id)).toEqual(['m1', 'm2']);
    expect(practiceMatchSuggestions(data().schedule[0], data().matches).map(item => [item.match.id, item.confidence])).toEqual([['m1', 'confident'], ['m2', 'possible']]);
    expect(confidentMatchesForSession(data().schedule[0], data().matches).map(match => match.id)).toEqual(['m1']);
  });

  it('does not treat an empty opponent or a shared map alone as a confident multi-match link', () => {
    const fixture = data(); fixture.schedule[0].primary = 'Practice'; fixture.schedule[0].secondary = 'Ascent';
    fixture.matches = [{ ...fixture.matches[0], opponent: '' }, { ...fixture.matches[1], id: 'm3', opponent: '', map: 'Ascent' }];
    expect(practiceMatchSuggestions(fixture.schedule[0], fixture.matches).map(item => item.confidence)).toEqual(['possible', 'possible']);
    expect(confidentMatchesForSession(fixture.schedule[0], fixture.matches)).toEqual([]);
  });

  it('persists one practice block and combines match, goal, attendance and finding progress', () => {
    const db = data();
    const result = linkPracticeSession(db, { scheduleId, matchIds: ['m1'], goalIds: ['g1'] }, 'Coach', '2026-10-18T20:00:00Z');
    db.coachingSignals = [{ blockId: result.block.id, status: 'accepted' }];
    const progress = practiceSessionProgress(db, scheduleId, '2026-10-18T21:00:00Z');
    expect(progress).toMatchObject({ linked: true, matchIds: ['m1'], goals: { total: 1, done: 1 }, attendance: { assigned: 1, checkedIn: 1, late: 1 }, findings: { total: 1, accepted: 1 } });
    expect(db.schedule[0]).toMatchObject({ practiceBlockId: result.block.id, linkedGoalIds: ['g1'], progressLinkedBy: 'Coach' });
  });

  it('rejects unknown goals without creating a practice block', () => {
    const db = data();
    expect(() => linkPracticeSession(db, { scheduleId, matchIds: ['m1'], goalIds: ['missing'] }, 'Coach')).toThrow('unknown goal');
    expect(db.practiceBlocks).toEqual([]);
  });

  it('rejects an overlapping practice link without mutating the second schedule', () => {
    const db = data();
    db.schedule.push({ ...db.schedule[0], id: '00000000-0000-4000-8000-000000000011', primary: 'Later debrief', practiceBlockId: undefined });
    linkPracticeSession(db, { scheduleId, matchIds: ['m1'] }, 'Coach');
    expect(() => linkPracticeSession(db, { scheduleId: db.schedule[1].id, matchIds: ['m1'] }, 'Coach')).toThrow('only one explicit practice block');
    expect(db.schedule[1].practiceBlockId).toBeUndefined();
  });
});
