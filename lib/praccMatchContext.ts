import { cairoDateTimeToUtc } from './attendance';

export interface PraccSlot { scheduleId: string; date: string; opponent: string | null }

/** PRACC titles read "Practice vs PYO"; the opponent is whatever follows the last "vs". */
export function praccOpponentFromTitle(title: unknown): string | null {
  const match = /\bvs\.?\s+(.+)$/i.exec(String(title || '').trim());
  const opponent = match?.[1].split(/\s+vs\.?\s+/i).at(-1)?.trim() || '';
  return opponent && opponent.length <= 80 ? opponent : null;
}

/**
 * The single timed PRACC slot that contains `instant`, allowing a grace period
 * after the booked end because scrims overrun. Two overlapping slots, or none,
 * give null: a guess would write the wrong opponent onto a match.
 */
export function praccSlotAt(schedule: readonly any[] | undefined, instant: Date, graceMinutes = 90): PraccSlot | null {
  const time = instant.getTime();
  if (!Number.isFinite(time)) return null;
  const slots = (schedule || []).filter(row => {
    if (row?.source !== 'pracc' || row.allDay || !/^\d{2}:\d{2}$/.test(String(row.startTime || ''))) return false;
    let start: number;
    try { start = cairoDateTimeToUtc(row.date, row.startTime).getTime(); } catch { return false; }
    const minutes = Number.isFinite(Number(row.durationMinutes)) && Number(row.durationMinutes) > 0 ? Number(row.durationMinutes) : 60;
    return time >= start && time <= start + (minutes + graceMinutes) * 60_000;
  });
  if (slots.length !== 1) return null;
  return { scheduleId: String(slots[0].id), date: String(slots[0].date), opponent: praccOpponentFromTitle(slots[0].primary) };
}
