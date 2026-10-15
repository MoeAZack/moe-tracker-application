import { describe, expect, it } from 'vitest';
import { repeatedHourlyScheduleRows } from '../lib/schedule';

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
});
