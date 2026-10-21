import { describe, expect, it } from 'vitest';
import { fetchPraccCalendar, parsePraccCalendar, reconcilePraccSchedule, validatePraccCalendarUrl } from '../lib/praccCalendar';

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

  it('removes upcoming PRACC rows whose event left the feed and keeps the rest', () => {
    const [practice, goal] = parsePraccCalendar(calendar);
    const now = new Date('2026-10-01T00:00:00Z');
    const both = reconcilePraccSchedule([], [practice, goal], feedUrl, now).schedule;
    const past = { ...both[0], id: 'past', sourceEventId: 'old@pracc.com', date: '2026-09-20' };
    const attended = { ...both[0], id: 'attended', sourceEventId: 'gone-attended@pracc.com', attendanceCheckIns: [{ id: 'check-1' }] };
    const otherFeed = { ...both[1], id: 'other', sourceEventId: 'elsewhere@pracc.com', sourceCalendarHash: 'another-feed' };
    const manual = { id: 'manual', date: '2026-10-20', primary: 'Team review' };
    const result = reconcilePraccSchedule([...both, past, attended, otherFeed, manual], [practice], feedUrl, now);
    expect(result.removed).toBe(1);
    expect(result.schedule.map((row: any) => row.sourceEventId ?? row.id)).toEqual([practice.uid, 'old@pracc.com', 'gone-attended@pracc.com', 'elsewhere@pracc.com', 'manual']);
    expect(reconcilePraccSchedule(both, [], feedUrl, now).schedule).toHaveLength(2);
  });

  it('resolves non-IANA TZIDs through the feed and keeps all-day dates unshifted', () => {
    const feed = ['BEGIN:VCALENDAR', 'X-WR-TIMEZONE:Europe/Berlin',
      'BEGIN:VTIMEZONE', 'TZID:W. Europe Standard Time', 'X-LIC-LOCATION:Europe/Berlin', 'END:VTIMEZONE',
      'BEGIN:VEVENT', 'UID:windows-zone', 'DTSTART;TZID="W. Europe Standard Time":20261015T180000', 'SUMMARY:Windows zone', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:floating', 'DTSTART:20261015T180000', 'SUMMARY:Floating', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:all-day', 'DTSTART;VALUE=DATE;TZID=America/Los_Angeles:20261016', 'SUMMARY:All day', 'END:VEVENT',
      'END:VCALENDAR'].join('\r\n');
    const events = parsePraccCalendar(feed);
    expect(events.find(event => event.uid === 'windows-zone')!.startsAt.toISOString()).toBe('2026-10-15T16:00:00.000Z');
    expect(events.find(event => event.uid === 'floating')!.startsAt.toISOString()).toBe('2026-10-15T16:00:00.000Z');
    const schedule = reconcilePraccSchedule([], events, feedUrl, new Date('2026-10-01T00:00:00Z')).schedule;
    expect(schedule.find(row => row.sourceEventId === 'all-day')).toMatchObject({ date: '2026-10-16', allDay: true });
    expect(() => parsePraccCalendar(feed.replace('X-LIC-LOCATION:Europe/Berlin', 'X-LIC-LOCATION:Nowhere/Zone'))).toThrow(/unsupported calendar timezone/);
  });

  it('gives up on a PRACC feed that never answers', async () => {
    const hang = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    await expect(fetchPraccCalendar(feedUrl, hang, 20)).rejects.toMatchObject({ status: 504 });
  });
});
