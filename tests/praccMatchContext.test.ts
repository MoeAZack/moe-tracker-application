import { describe, expect, it } from 'vitest';
import { praccOpponentFromTitle, praccSlotAt } from '../lib/praccMatchContext';
import { buildAutomaticCaptureImport } from '../lib/automaticCaptureImport';
import { autoLinkPracticeSession } from '../lib/practiceSessionProgress';

// 2026-10-18 is Egypt summer time (UTC+3): a 20:00 Cairo slot starts at 17:00 UTC.
const slot = (over: any = {}) => ({ id: 's1', source: 'pracc', date: '2026-10-18', startTime: '20:00', durationMinutes: 120, allDay: false, primary: 'Practice vs PYO', secondary: 'Online', attendance: {}, ...over });

const capture = () => ({
  meta: { map: 'Ascent', ourScore: 13, theirScore: 9 }, startingSide: { firstHalf: 'Att' }, reconciled: { missing: [] },
  players: Array.from({ length: 10 }, (_, index) => ({ include: index < 5, matchedPlayerId: index < 5 ? `p${index}` : null, extractedName: `Player ${index}`, kills: 10 + index, deaths: 8, assists: 4 })),
  rounds: Array.from({ length: 22 }, (_, index) => ({ roundNo: index + 1, result: index < 13 ? 'W' : 'L', screenshotEvidence: { reviewStatus: 'confirmed' } })),
});
const data = (schedule: any[]): any => ({ settings: { maps: ['Ascent'] }, playerStats: [], matches: [], coreMemberships: [], tryoutBatches: [], schedule });

describe('PRACC slot lookup', () => {
  it('reads the opponent after the last "vs"', () => {
    expect(praccOpponentFromTitle('Practice vs PYO')).toBe('PYO');
    expect(praccOpponentFromTitle('Scrim vs. Team Nova')).toBe('Team Nova');
    expect(praccOpponentFromTitle('Team goal')).toBeNull();
    expect(praccOpponentFromTitle('')).toBeNull();
  });

  it('finds the one slot covering the capture, including the overrun grace, in Cairo time', () => {
    expect(praccSlotAt([slot()], new Date('2026-10-18T18:30:00Z'))).toEqual({ scheduleId: 's1', date: '2026-10-18', opponent: 'PYO' });
    expect(praccSlotAt([slot()], new Date('2026-10-18T20:20:00Z'))?.scheduleId).toBe('s1');
    expect(praccSlotAt([slot()], new Date('2026-10-18T16:59:00Z'))).toBeNull();
    expect(praccSlotAt([slot()], new Date('2026-10-18T20:31:00Z'))).toBeNull();
  });

  it('refuses to guess between overlapping slots, manual rows or all-day rows', () => {
    const at = new Date('2026-10-18T18:30:00Z');
    expect(praccSlotAt([slot(), slot({ id: 's2', primary: 'Practice vs MT' })], at)).toBeNull();
    expect(praccSlotAt([slot({ source: 'manual' })], at)).toBeNull();
    expect(praccSlotAt([slot({ allDay: true })], at)).toBeNull();
  });
});

describe('automatic capture match context', () => {
  it('takes the date and opponent from the PRACC slot the game was captured in', () => {
    const { payload } = buildAutomaticCaptureImport(capture(), data([slot()]), 'cap-1', '2026-10-18T19:50:00Z');
    expect(payload!.match).toMatchObject({ date: '2026-10-18', opponent: 'PYO', automation: { praccScheduleId: 's1' } });
  });

  it('uses the capture day, not the processing day, when no slot matches', () => {
    // 22:30 UTC on the 18th is already the 19th in Cairo.
    const { payload } = buildAutomaticCaptureImport(capture(), data([]), 'cap-1', '2026-10-18T22:30:00Z');
    expect(payload!.match).toMatchObject({ date: '2026-10-19', opponent: 'Unknown opponent', automation: { praccScheduleId: null } });
  });
});

describe('automatic practice-session link', () => {
  const db = () => ({
    schedule: [slot()], goals: [], practiceBlocks: [] as any[], rosterPlayers: [], settings: {}, playerStats: [], rounds: [], coachingSignals: [],
    matches: [{ id: 'm1', date: '2026-10-18', opponent: 'PYO', map: 'Ascent', automation: { praccScheduleId: 's1' } }],
  } as any);

  it('links the first map and adds later maps of the same session', () => {
    const fixture = db();
    expect(autoLinkPracticeSession(fixture, 'm1', 'Coach', '2026-10-18T22:00:00Z')).not.toBeNull();
    expect(fixture.schedule[0]).toMatchObject({ progressLinkedAutomatically: true });
    expect(fixture.practiceBlocks[0].matchIds).toEqual(['m1']);
    fixture.matches.push({ id: 'm2', date: '2026-10-18', opponent: 'PYO', map: 'Lotus', automation: { praccScheduleId: 's1' } });
    autoLinkPracticeSession(fixture, 'm2', 'Coach', '2026-10-18T23:00:00Z');
    expect(fixture.practiceBlocks).toHaveLength(1);
    expect(fixture.practiceBlocks[0].matchIds).toEqual(['m1', 'm2']);
  });

  it('never changes a coach-made link, a match without a slot, or a quarantined duplicate', () => {
    const coachLinked = db(); coachLinked.schedule[0].practiceBlockId = 'b1'; coachLinked.practiceBlocks = [{ id: 'b1', name: 'x', matchIds: [] }];
    expect(autoLinkPracticeSession(coachLinked, 'm1', 'Coach')).toBeNull();
    const noSlot = db(); delete noSlot.matches[0].automation;
    expect(autoLinkPracticeSession(noSlot, 'm1', 'Coach')).toBeNull();
    const quarantined = db(); quarantined.matches[0].duplicateReview = { status: 'quarantined' };
    expect(autoLinkPracticeSession(quarantined, 'm1', 'Coach')).toBeNull();
    expect([coachLinked, noSlot, quarantined].map(item => item.schedule[0].progressLinkedAutomatically)).toEqual([undefined, undefined, undefined]);
  });

  it('does not link the first map when the session already has two confident matches', () => {
    const fixture = db(); fixture.matches.push({ id: 'm0', date: '2026-10-18', opponent: 'PYO', map: 'Bind' });
    expect(autoLinkPracticeSession(fixture, 'm1', 'Coach')).toBeNull();
    expect(fixture.practiceBlocks).toEqual([]);
  });
});
