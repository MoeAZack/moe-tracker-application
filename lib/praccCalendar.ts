import crypto from 'crypto';

export type PraccCalendarEvent = {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt?: Date;
  allDay: boolean;
  /** Calendar date (YYYY-MM-DD) of an all-day event, never shifted by a timezone. */
  allDayDate?: string;
  cancelled: boolean;
};

function calendarError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function validatePraccCalendarUrl(value: unknown) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input || input.length > 1000) throw calendarError('Paste a valid PRACC calendar feed URL.');
  let url: URL;
  try { url = new URL(input); } catch { throw calendarError('The PRACC calendar URL is invalid.'); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || (hostname !== 'pracc.com' && !hostname.endsWith('.pracc.com')) || url.username || url.password || url.port) {
    throw calendarError('Only secure pracc.com calendar feeds are allowed.');
  }
  if (!/^\/api\/matches\/[^/]+\/calendar\.ics$/i.test(url.pathname)) throw calendarError('This is not a PRACC match calendar feed URL.');
  url.hash = '';
  return url.toString();
}

export function praccCalendarUrlHash(url: string) {
  return crypto.createHash('sha256').update(validatePraccCalendarUrl(url)).digest('hex');
}

function unfoldIcs(text: string) { return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); }
function unescapeIcs(value: string) { return value.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim(); }

function zonedWallClock(parts: number[], timeZone: string) {
  const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(item => item.type !== 'literal').map(item => [item.type, Number(item.value)]));
    const observedUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    const adjustment = desiredUtc - observedUtc;
    guess += adjustment;
    if (!adjustment) break;
  }
  return new Date(guess);
}

function validTimeZone(value: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
}

/** Resolves an event TZID through the feed's own VTIMEZONE definitions and
 * X-WR-TIMEZONE, so non-IANA ids (for example Windows names) still convert. */
function resolveTimeZone(tzid: string | undefined, zones: Map<string, string>, calendarZone: string | undefined) {
  const candidates = [tzid, tzid ? zones.get(tzid) : undefined, tzid?.replace(/^\//, ''), tzid ? undefined : calendarZone, tzid ? undefined : 'Africa/Cairo'];
  return candidates.find((value): value is string => !!value && validTimeZone(value)) || null;
}

function parseIcsDate(property: string, value: string, zones: Map<string, string> = new Map(), calendarZone?: string) {
  const dateOnly = /^\d{8}$/.test(value);
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (!match) throw calendarError(`PRACC returned an unsupported calendar date: ${value}`, 422);
  const parts = match.slice(1, 7).map(part => Number(part || 0));
  if (match[7]) return { date: new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])), allDay: false };
  const allDay = dateOnly || /VALUE=DATE(?:;|:|$)/i.test(property);
  if (allDay) return { date: new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)), allDay: true, allDayDate: `${match[1]}-${match[2]}-${match[3]}` };
  const tzid = /(?:^|;)TZID=("[^"]+"|[^;:]+)/i.exec(property)?.[1]?.replace(/^"|"$/g, '');
  const timeZone = resolveTimeZone(tzid, zones, calendarZone);
  if (!timeZone) throw calendarError(`PRACC returned an unsupported calendar timezone: ${tzid}`, 422);
  return { date: zonedWallClock(parts, timeZone), allDay: false };
}

export function parsePraccCalendar(text: string): PraccCalendarEvent[] {
  if (typeof text !== 'string' || !text.includes('BEGIN:VCALENDAR')) throw calendarError('PRACC did not return an iCalendar feed.', 422);
  const lines = unfoldIcs(text);
  // VTIMEZONE blocks map a feed-local TZID to an IANA location when they carry one.
  const zones = new Map<string, string>(); let zoneId = ''; let inZone = false;
  for (const line of lines) {
    if (line === 'BEGIN:VTIMEZONE') { inZone = true; zoneId = ''; continue; }
    if (line === 'END:VTIMEZONE') { inZone = false; continue; }
    if (!inZone) continue;
    if (/^TZID[:;]/i.test(line)) zoneId = line.slice(line.indexOf(':') + 1).trim();
    else if (/^X-LIC-LOCATION[:;]/i.test(line) && zoneId) zones.set(zoneId, line.slice(line.indexOf(':') + 1).trim());
  }
  const calendarZone = lines.find(line => /^X-WR-TIMEZONE[:;]/i.test(line))?.replace(/^[^:]*:/, '').trim() || undefined;
  const events: PraccCalendarEvent[] = [];
  let current: Record<string, Array<{ property: string; value: string }>> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') {
      if (!current) continue;
      const first = (key: string) => current?.[key]?.[0];
      const uid = unescapeIcs(first('UID')?.value || ''); const summary = unescapeIcs(first('SUMMARY')?.value || 'PRACC practice'); const start = first('DTSTART');
      if (uid && start) {
        const parsedStart = parseIcsDate(start.property, start.value, zones, calendarZone);
        const end = first('DTEND');
        events.push({ uid, title: summary.slice(0, 200), description: unescapeIcs(first('DESCRIPTION')?.value || '').slice(0, 5000) || undefined, location: unescapeIcs(first('LOCATION')?.value || '').slice(0, 500) || undefined, startsAt: parsedStart.date, endsAt: end ? parseIcsDate(end.property, end.value, zones, calendarZone).date : undefined, allDay: parsedStart.allDay, ...(parsedStart.allDayDate ? { allDayDate: parsedStart.allDayDate } : {}), cancelled: String(first('STATUS')?.value || '').toUpperCase() === 'CANCELLED' });
      }
      current = null; continue;
    }
    if (!current) continue;
    const separator = line.indexOf(':'); if (separator < 1) continue;
    const property = line.slice(0, separator); const key = property.split(';')[0].toUpperCase(); const value = line.slice(separator + 1);
    (current[key] ||= []).push({ property, value });
  }
  return events.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

const cairoParts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));

export function reconcilePraccSchedule(schedule: any[], events: PraccCalendarEvent[], feedUrl: string, now = new Date()) {
  const feedHash = praccCalendarUrlHash(feedUrl); const rows = [...(schedule || [])]; let imported = 0; let updated = 0; let cancelled = 0;
  for (const event of events) {
    const index = rows.findIndex(row => row?.source === 'pracc' && row?.sourceEventId === event.uid && (!row.sourceCalendarHash || row.sourceCalendarHash === feedHash));
    if (event.cancelled) {
      if (index >= 0 && !(rows[index].attendanceCheckIns || []).length && !(rows[index].attendanceAudit || []).length && !rows[index].practiceBlockId && event.startsAt >= now) { rows.splice(index, 1); cancelled += 1; }
      continue;
    }
    const start = cairoParts(event.startsAt); const endMs = event.endsAt?.getTime(); const durationMinutes = endMs && endMs > event.startsAt.getTime() ? Math.max(15, Math.min(720, Math.round((endMs - event.startsAt.getTime()) / 60_000))) : 60;
    const importedFields = { date: event.allDayDate || `${start.year}-${start.month}-${start.day}`, primary: event.title || 'PRACC practice', secondary: event.location || '', notes: event.description || '', startTime: event.allDay ? '' : `${start.hour}:${start.minute}`, allDay: event.allDay, durationMinutes: event.allDay ? undefined : durationMinutes, source: 'pracc' as const, sourceEventId: event.uid, sourceCalendarHash: feedHash, calendarKey: 'practice' };
    if (index >= 0) { rows[index] = { ...rows[index], ...importedFields }; updated += 1; }
    else { rows.push({ id: crypto.randomUUID(), ...importedFields, attendance: {}, attendanceEnabled: false, requiredPlayerIds: [], attendanceCheckIns: [] }); imported += 1; }
  }
  return { schedule: rows, imported, updated, cancelled, total: events.filter(event => !event.cancelled).length };
}

export const PRACC_FETCH_TIMEOUT_MS = 15_000;

export async function fetchPraccCalendar(feedUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = PRACC_FETCH_TIMEOUT_MS) {
  try { return await fetchPraccCalendarOnce(feedUrl, fetchImpl, AbortSignal.timeout(timeoutMs)); }
  catch (error: any) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw calendarError('PRACC did not answer in time. Try the sync again later.', 504);
    throw error;
  }
}

async function fetchPraccCalendarOnce(feedUrl: string, fetchImpl: typeof fetch, signal: AbortSignal) {
  let current = validatePraccCalendarUrl(feedUrl);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetchImpl(current, { redirect: 'manual', signal, headers: { accept: 'text/calendar, text/plain;q=0.9', 'user-agent': 'MoeTracker/0.1' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location'); if (!location || redirect === 3) throw calendarError('PRACC redirected the calendar feed unexpectedly.', 502);
      current = validatePraccCalendarUrl(new URL(location, current).toString()); continue;
    }
    if (!response.ok) throw calendarError(`PRACC calendar returned ${response.status}. Regenerate the calendar link in PRACC and try again.`, 502);
    const text = await response.text(); if (text.length > 2_000_000) throw calendarError('The PRACC calendar feed is too large.', 413);
    return parsePraccCalendar(text);
  }
  throw calendarError('PRACC calendar could not be downloaded.', 502);
}
