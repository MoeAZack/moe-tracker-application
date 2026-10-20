import { describe, expect, it } from 'vitest';
import { applyScheduleEdit, DEFAULT_SCHEDULE_CALENDARS, ensureScheduleCalendars, normalizeScheduleRow, removeScheduleRows, repeatedHourlyScheduleRows } from '../lib/schedule';

describe('schedule categories', () => {
  it('adds the standard categories while preserving existing custom values', () => {
    const settings = { calendars: [{ key: 'practice', name: 'Team Practice', color: '#123456', gcalId: 'custom', sync: true }] };
    ensureScheduleCalendars(settings);
    expect(settings.calendars.map(calendar => calendar.name)).toEqual(['Team Practice', 'Official', 'VOD Review', 'Offline', 'Team Talk', 'Debrief']);
    expect(settings.calendars[0]).toEqual({ key: 'practice', name: 'Team Practice', color: '#123456', gcalId: 'custom', sync: true });
  });

  it('normalizes only old built-in labels and remains idempotent', () => {
    const settings = { calendars: [
      { key: 'official', name: 'Officials', color: '#111111' },
      { key: 'review', name: 'VOD review', color: '#222222' },
    ] };
    ensureScheduleCalendars(settings);
    ensureScheduleCalendars(settings);
    expect(settings.calendars.map(calendar => calendar.name)).toEqual(['Official', 'VOD Review', 'Practice', 'Offline', 'Team Talk', 'Debrief']);
    expect(settings.calendars).toHaveLength(DEFAULT_SCHEDULE_CALENDARS.length);
  });
});

describe('hourly schedule repetition', () => {
  it('creates consecutive same-day slots for repeated practice blocks', () => {
    const rows = repeatedHourlyScheduleRows({ id: '', date: '2026-10-15', startTime: '15:00', primary: 'Ascent map', allDay: false }, 4, 'series-one');
    expect(rows.map(row => row.startTime)).toEqual(['15:00', '16:00', '17:00', '18:00']);
    expect(rows.map(row => [row.repeatIndex, row.repeatCount, row.repeatSeriesId])).toEqual([[1, 4, 'series-one'], [2, 4, 'series-one'], [3, 4, 'series-one'], [4, 4, 'series-one']]);
  });

  it('never spills repeated blocks into the next date and never repeats an all-day goal', () => {
    expect(repeatedHourlyScheduleRows({ id: '', startTime: '22:30', allDay: false }, 4, 'series').map(row => row.startTime)).toEqual(['22:30', '23:30']);
    expect(repeatedHourlyScheduleRows({ id: '', allDay: true, primary: 'Main goal' }, 4, 'series')).toHaveLength(1);
  });

  it('normalizes manual rows and preserves provider-owned PRACC identity and timing', () => {
    const context = { activePlayerIds: new Set(['p1']), calendarKeys: new Set(['practice', 'review']) };
    const manual = normalizeScheduleRow({ date: '2026-10-15', startTime: '15:00', primary: ' Ascent ', calendarKey: 'practice', attendanceEnabled: true, requiredPlayerIds: ['p1', 'retired'] }, null, context);
    expect(manual).toMatchObject({ primary: 'Ascent', attendanceEnabled: true, requiredPlayerIds: ['p1'], source: 'manual', durationMinutes: 60 });
    const pracc = { ...manual, id: 'pracc', source: 'pracc', sourceEventId: 'event', sourceCalendarHash: 'hash', date: '2026-10-16', startTime: '17:00', primary: 'Provider scrim' };
    expect(normalizeScheduleRow({ ...pracc, date: '2026-10-20', startTime: '20:00', primary: 'Changed locally', calendarKey: 'review' }, pracc, context)).toMatchObject({ date: '2026-10-16', startTime: '17:00', primary: 'Provider scrim', calendarKey: 'review', sourceEventId: 'event' });
  });

  it('updates or removes a repeated series atomically while retaining sibling times and check-ins', () => {
    const rows: any[] = [
      { id: 'one', repeatSeriesId: 'series', repeatIndex: 1, startTime: '15:00', primary: 'Ascent', attendanceCheckIns: [{ id: 'c1' }] },
      { id: 'two', repeatSeriesId: 'series', repeatIndex: 2, startTime: '16:00', primary: 'Ascent', attendanceCheckIns: [] },
      { id: 'other', startTime: '17:00', primary: 'Review' },
    ];
    const edited = applyScheduleEdit(rows, { ...rows[0], primary: 'Bind', attendanceEnabled: true, requiredPlayerIds: ['p1'] }, 'series');
    expect(edited.slice(0, 2).map(row => [row.primary, row.startTime])).toEqual([['Bind', '15:00'], ['Bind', '16:00']]); expect(edited[0].attendanceCheckIns).toEqual([{ id: 'c1' }]);
    expect(removeScheduleRows(edited, 'one', 'series')).toMatchObject({ rows: [{ id: 'other' }], removedIds: ['one', 'two'] });
  });
});
