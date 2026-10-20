import type { Schedule } from '../src/types';

function escapeIcs(value: unknown) { return String(value || '').replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;'); }
function compactDate(value: string) { return value.replaceAll('-', ''); }

export function buildScheduleIcs(schedule: readonly Schedule[], now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moe Tracker//Team Schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Moe Tracker Team Schedule', 'X-WR-TIMEZONE:Africa/Cairo'];
  for (const row of schedule) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date || ''))) continue;
    lines.push('BEGIN:VEVENT', `UID:${escapeIcs(row.id)}@moetracker`, `DTSTAMP:${stamp}`, `SUMMARY:${escapeIcs(row.primary)}`);
    if (row.allDay || !/^\d{2}:\d{2}$/.test(String(row.startTime || ''))) {
      const end = new Date(`${row.date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${compactDate(row.date)}`, `DTEND;VALUE=DATE:${compactDate(end.toISOString().slice(0, 10))}`);
    } else {
      const start = `${compactDate(row.date)}T${String(row.startTime).replace(':', '')}00`;
      const [hour, minute] = String(row.startTime).split(':').map(Number); const end = new Date(`${row.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`); end.setUTCMinutes(end.getUTCMinutes() + Math.max(15, Number(row.durationMinutes || 60)));
      lines.push(`DTSTART;TZID=Africa/Cairo:${start}`, `DTEND;TZID=Africa/Cairo:${compactDate(end.toISOString().slice(0, 10))}T${end.toISOString().slice(11, 19).replaceAll(':', '')}`);
    }
    if (row.secondary || row.notes || row.coachNotes) lines.push(`DESCRIPTION:${escapeIcs([row.secondary, row.notes, row.coachNotes].filter(Boolean).join('\n'))}`);
    if (row.calendarKey) lines.push(`CATEGORIES:${escapeIcs(row.calendarKey)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

