import { describe, expect, it } from 'vitest';
import { attendancePolicy, attendanceStatus, attendanceSummary, attendanceWindow, cairoDateTimeToUtc } from '../lib/attendance';

const playerId = '00000000-0000-4000-8000-000000000001';
const event = (id: string, date: string, startTime = '15:00', checkIn?: any) => ({
  id, date, startTime, attendanceEnabled: true, requiredPlayerIds: [playerId],
  attendanceCheckIns: checkIn ? [{ id: `${id}-check`, playerId, ...checkIn }] : [],
});

describe('attendance ledger', () => {
  it('resolves Cairo daylight-saving time per event date', () => {
    expect(cairoDateTimeToUtc('2026-01-15', '15:00').toISOString()).toBe('2026-01-15T13:00:00.000Z');
    expect(cairoDateTimeToUtc('2026-07-15', '15:00').toISOString()).toBe('2026-07-15T12:00:00.000Z');
  });

  it('opens early, grants ten on-time minutes, then records a late window and absence', () => {
    const policy = attendancePolicy({}); const schedule = event('practice', '2026-10-15');
    const window = attendanceWindow(schedule, policy);
    expect(attendanceStatus(schedule, playerId, new Date(window.opensAt.getTime() - 1), policy)).toBe('upcoming');
    expect(attendanceStatus(schedule, playerId, window.opensAt, policy)).toBe('open');
    expect(attendanceStatus(schedule, playerId, window.graceEndsAt, policy)).toBe('open');
    expect(attendanceStatus(schedule, playerId, new Date(window.graceEndsAt.getTime() + 1), policy)).toBe('late-window');
    expect(attendanceSummary({ settings: {}, schedule: [schedule], attendanceCredits: [] }, playerId, new Date(window.graceEndsAt.getTime() + 1))).toMatchObject({ late: 1, strikes: 1 });
    expect(attendanceStatus(schedule, playerId, new Date(window.closesAt.getTime() + 1), policy)).toBe('absent');
  });

  it('turns every three late or missed events into a red dot and lets one green dot remove it', () => {
    const db: any = {
      settings: { attendanceStrikesPerRedDot: 3, attendanceRedDotCost: 75, attendanceCurrency: 'EGP' },
      schedule: [
        event('one', '2026-10-10', '15:00', { checkedInAt: '2026-10-10T12:11:00.000Z', status: 'late' }),
        event('two', '2026-10-11', '15:00', { checkedInAt: '2026-10-11T12:12:00.000Z', status: 'late' }),
        event('three', '2026-10-12', '15:00'),
      ],
      attendanceCredits: [],
    };
    const penalized = attendanceSummary(db, playerId, new Date('2026-10-15T20:00:00.000Z'));
    expect(penalized).toMatchObject({ late: 2, absent: 1, strikes: 3, redDots: 1, cost: 75, currency: 'EGP' });
    db.attendanceCredits.push({ id: 'green', playerId, kind: 'green', createdAt: '2026-10-15T20:01:00.000Z' });
    expect(attendanceSummary(db, playerId, new Date('2026-10-15T20:00:00.000Z'))).toMatchObject({ greenDots: 1, redDots: 0, cost: 0 });
  });

  it('does not penalize an excused event', () => {
    const db: any = { settings: {}, schedule: [event('excused', '2026-10-10', '15:00', { checkedInAt: '2026-10-10T12:00:00.000Z', status: 'excused' })], attendanceCredits: [] };
    expect(attendanceSummary(db, playerId, new Date('2026-10-15T20:00:00.000Z'))).toMatchObject({ strikes: 0, absent: 0, late: 0 });
  });
});
