type RepeatedScheduleRow<T> = T & { repeatSeriesId?: string; repeatIndex?: number; repeatCount?: number };

export function repeatedHourlyScheduleRows<T extends { id?: string; allDay?: boolean; startTime?: string }>(row: T, requestedCount: number, seriesId: string): RepeatedScheduleRow<T>[] {
  if (row.id || row.allDay || requestedCount <= 1) return [row];
  const match = /^(\d{2}):(\d{2})$/.exec(String(row.startTime || ''));
  if (!match) return [row];
  const startHour = Number(match[1]); const minute = match[2];
  const count = Math.min(Math.max(1, Math.round(requestedCount)), 24 - startHour);
  return Array.from({ length: count }, (_, index) => ({ ...row, id: '', startTime: `${String(startHour + index).padStart(2, '0')}:${minute}`, repeatSeriesId: seriesId, repeatIndex: index + 1, repeatCount: count } as RepeatedScheduleRow<T>));
}
