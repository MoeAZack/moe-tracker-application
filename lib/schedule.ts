type RepeatedScheduleRow<T> = T & { repeatSeriesId?: string; repeatIndex?: number; repeatCount?: number };

export type ScheduleCalendar = { key: string; name: string; color: string; gcalId?: string; sync?: boolean };

export const DEFAULT_SCHEDULE_CALENDARS: ReadonlyArray<ScheduleCalendar> = [
  { key: 'practice', name: 'Practice', color: '#ff4655', gcalId: '', sync: false },
  { key: 'official', name: 'Official', color: '#3aa0ff', gcalId: '', sync: false },
  { key: 'review', name: 'VOD Review', color: '#3ddc84', gcalId: '', sync: false },
  { key: 'offline', name: 'Offline', color: '#64748b', gcalId: '', sync: false },
  { key: 'team-talk', name: 'Team Talk', color: '#a78bfa', gcalId: '', sync: false },
  { key: 'debrief', name: 'Debrief', color: '#f59e0b', gcalId: '', sync: false },
];

const LEGACY_BUILT_IN_NAMES: Record<string, string> = {
  official: 'Officials',
  review: 'VOD review',
};

export function ensureScheduleCalendars(settings: any): ScheduleCalendar[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return [];
  if (!Array.isArray(settings.calendars)) settings.calendars = [];
  const existingByKey = new Map<string, ScheduleCalendar>(settings.calendars
    .filter((calendar: any) => calendar && typeof calendar === 'object' && typeof calendar.key === 'string')
    .map((calendar: ScheduleCalendar) => [calendar.key, calendar]));

  for (const preset of DEFAULT_SCHEDULE_CALENDARS) {
    const existing = existingByKey.get(preset.key);
    if (!existing) {
      settings.calendars.push({ ...preset });
      existingByKey.set(preset.key, settings.calendars.at(-1));
      continue;
    }
    if (existing.name === LEGACY_BUILT_IN_NAMES[preset.key]) existing.name = preset.name;
  }

  return settings.calendars;
}

export function repeatedHourlyScheduleRows<T extends { id?: string; allDay?: boolean; startTime?: string }>(row: T, requestedCount: number, seriesId: string): RepeatedScheduleRow<T>[] {
  if (row.id || row.allDay || requestedCount <= 1) return [row];
  const match = /^(\d{2}):(\d{2})$/.exec(String(row.startTime || ''));
  if (!match) return [row];
  const startHour = Number(match[1]); const minute = match[2];
  const count = Math.min(Math.max(1, Math.round(requestedCount)), 24 - startHour);
  return Array.from({ length: count }, (_, index) => ({ ...row, id: '', startTime: `${String(startHour + index).padStart(2, '0')}:${minute}`, repeatSeriesId: seriesId, repeatIndex: index + 1, repeatCount: count } as RepeatedScheduleRow<T>));
}
