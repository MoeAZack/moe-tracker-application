import { describe, expect, it } from 'vitest';
import { buildScheduleIcs } from '../lib/calendarExport';

describe('provider-neutral calendar export', () => {
  it('exports Cairo hourly events and exclusive all-day end dates', () => {
    const ics = buildScheduleIcs([
      { id: 'hourly', date: '2026-10-15', startTime: '15:00', durationMinutes: 90, primary: 'Practice', secondary: 'Four Ascent maps', attendance: {}, calendarKey: 'practice' },
      { id: 'goal', date: '2026-10-16', allDay: true, primary: 'Main goal', notes: 'Trading; discipline', attendance: {} },
    ], new Date('2026-10-18T10:00:00Z'));
    expect(ics).toContain('DTSTART;TZID=Africa/Cairo:20261015T150000');
    expect(ics).toContain('DTEND;TZID=Africa/Cairo:20261015T163000');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261016');
    expect(ics).toContain('DTEND;VALUE=DATE:20261017');
    expect(ics).toContain('DESCRIPTION:Four Ascent maps');
    expect(ics).toContain('Trading\\; discipline');
  });
});
