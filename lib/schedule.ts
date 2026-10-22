type RepeatedScheduleRow<T> = T & { repeatSeriesId?: string; repeatIndex?: number; repeatCount?: number };

export type ScheduleMutationScope = 'single' | 'series';

export type ScheduleNormalizationContext = {
  activePlayerIds: ReadonlySet<string>;
  calendarKeys: ReadonlySet<string>;
};

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

const fail = (message: string) => { throw Object.assign(new Error(message), { status: 400 }); };
const cleanText = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
const validDate = (value: unknown) => { const text = String(value || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false; const [year, month, day] = text.split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day; };

/** Server-side canonical schedule contract shared by manual, series and PRACC rows. */
export function normalizeScheduleRow(input: any, existing: any | null, context: ScheduleNormalizationContext) {
  const providerOwned = existing?.source === 'pracc';
  const date = providerOwned ? existing.date : cleanText(input?.date, 10);
  const primary = providerOwned ? existing.primary : cleanText(input?.primary, 240);
  const allDay = providerOwned ? Boolean(existing.allDay) : Boolean(input?.allDay);
  const startTime = allDay ? '' : providerOwned ? String(existing.startTime || '') : cleanText(input?.startTime, 5);
  if (!validDate(date)) fail('A valid schedule date is required.');
  if (!primary) fail('A schedule title is required.');
  if (!allDay && !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) fail('A valid Cairo start time is required.');
  const requestedCalendar = cleanText(input?.calendarKey, 80) || 'practice';
  if (!context.calendarKeys.has(requestedCalendar)) fail('The selected schedule category is not active.');
  const requiredPlayerIds = [...new Set((Array.isArray(input?.requiredPlayerIds) ? input.requiredPlayerIds : []).filter((id: unknown): id is string => typeof id === 'string' && context.activePlayerIds.has(id)))];
  const attendanceEnabled = Boolean(!allDay && input?.attendanceEnabled && requiredPlayerIds.length);
  const durationMinutes = allDay ? undefined : providerOwned ? existing.durationMinutes : Math.min(720, Math.max(15, Math.round(Number(input?.durationMinutes) || 60)));
  return {
    ...(existing || {}), ...input,
    id: existing?.id || cleanText(input?.id, 200), date, primary, secondary: providerOwned ? existing.secondary : cleanText(input?.secondary, 500), notes: providerOwned ? existing.notes : cleanText(input?.notes, 5000), coachNotes: cleanText(input?.coachNotes, 5000),
    allDay, startTime, durationMinutes, calendarKey: requestedCalendar, requiredPlayerIds, attendanceEnabled,
    attendance: existing?.attendance || input?.attendance || {}, attendanceCheckIns: Array.isArray(existing?.attendanceCheckIns) ? existing.attendanceCheckIns : [],
    attendanceAudit: Array.isArray(existing?.attendanceAudit) ? existing.attendanceAudit : [],
    source: providerOwned ? 'pracc' : 'manual', sourceEventId: providerOwned ? existing.sourceEventId : undefined, sourceCalendarHash: providerOwned ? existing.sourceCalendarHash : undefined,
    // Only a PRACC sync sets or clears the cancelled / no-longer-in-feed flag.
    sourceStatus: providerOwned ? existing.sourceStatus : undefined, sourceStatusAt: providerOwned ? existing.sourceStatusAt : undefined,
  };
}

const SERIES_EDIT_FIELDS = ['calendarKey', 'primary', 'secondary', 'notes', 'coachNotes', 'durationMinutes', 'attendanceEnabled', 'requiredPlayerIds'] as const;

/** Update one event or the editable content of its whole series without moving sibling time slots. */
export function applyScheduleEdit<T extends Record<string, any>>(rows: T[], normalized: T, scope: ScheduleMutationScope): T[] {
  if (scope !== 'series' || !normalized.repeatSeriesId) return rows.map(row => row.id === normalized.id ? normalized : row);
  return rows.map(row => {
    if (row.repeatSeriesId !== normalized.repeatSeriesId) return row;
    const next: any = { ...row };
    for (const field of SERIES_EDIT_FIELDS) next[field] = structuredClone(normalized[field]);
    return next;
  });
}

export function removeScheduleRows<T extends { id: string; repeatSeriesId?: string }>(rows: T[], id: string, scope: ScheduleMutationScope) {
  const selected = rows.find(row => row.id === id);
  if (!selected) return { rows, removedIds: [] as string[] };
  const removedIds = scope === 'series' && selected.repeatSeriesId ? rows.filter(row => row.repeatSeriesId === selected.repeatSeriesId).map(row => row.id) : [id];
  const removed = new Set(removedIds);
  return { rows: rows.filter(row => !removed.has(row.id)), removedIds };
}
