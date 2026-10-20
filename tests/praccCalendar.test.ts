import { describe, expect, it } from 'vitest';
import { parsePraccCalendar, reconcilePraccSchedule, validatePraccCalendarUrl } from '../lib/praccCalendar';

const feedUrl = 'https://pracc.com/api/matches/example-private-key/calendar.ics';
const calendar = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:practice-1@pracc.com\r
DTSTART:20261015T120000Z\r
DTEND:20261015T140000Z\r
SUMMARY:Practice vs PYO\r
DESCRIPTION:Four Ascent maps\\nServer details later\r
LOCATION:Online\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:all-day-1@pracc.com\r
DTSTART;VALUE=DATE:20261016\r
SUMMARY:Team goal\r
END:VEVENT\r
END:VCALENDAR`;

describe('PRACC calendar integration', () => {
  it('accepts only the narrow secure PRACC feed URL shape', () => {
    expect(validatePraccCalendarUrl(feedUrl)).toBe(feedUrl);
    expect(() => validatePraccCalendarUrl('http://pracc.com/api/matches/key/calendar.ics')).toThrow(/secure pracc.com/i);
    expect(() => validatePraccCalendarUrl('https://example.com/api/matches/key/calendar.ics')).toThrow(/secure pracc.com/i);
    expect(() => validatePraccCalendarUrl('https://pracc.com/other/calendar.ics')).toThrow(/not a PRACC/i);
  });

  it('parses timed and all-day ICS events and converts UTC into Cairo time', () => {
    const events = parsePraccCalendar(calendar);
    expect(events).toHaveLength(2);
    const result = reconcilePraccSchedule([], events, feedUrl, new Date('2026-10-01T00:00:00Z'));
    expect(result.imported).toBe(2);
    expect(result.schedule[0]).toMatchObject({ date: '2026-10-15', startTime: '15:00', durationMinutes: 120, primary: 'Practice vs PYO', source: 'pracc', sourceEventId: 'practice-1@pracc.com' });
    expect(result.schedule[0].notes).toContain('Four Ascent maps\nServer details later');
    expect(result.schedule[1]).toMatchObject({ date: '2026-10-16', allDay: true, primary: 'Team goal' });
  });

  it('updates the same PRACC UID without duplicating it and preserves attendance state', () => {
    const [event] = parsePraccCalendar(calendar);
    const first = reconcilePraccSchedule([], [event], feedUrl).schedule[0];
    const existing = { ...first, coachNotes: 'Focus pistol protocols', attendanceEnabled: true, requiredPlayerIds: ['player-1'], attendanceCheckIns: [{ id: 'check-1' }], attendanceAudit: [{ id: 'audit-1' }] };
    const changed = { ...event, title: 'Practice vs MT Asteria' };
    const second = reconcilePraccSchedule([existing], [changed], feedUrl);
    expect(second.schedule).toHaveLength(1);
    expect(second.schedule[0]).toMatchObject({ id: first.id, primary: 'Practice vs MT Asteria', coachNotes: 'Focus pistol protocols', attendanceEnabled: true, requiredPlayerIds: ['player-1'], attendanceCheckIns: [{ id: 'check-1' }], attendanceAudit: [{ id: 'audit-1' }] });
  });
});
