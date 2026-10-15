export const ATTENDANCE_TIME_ZONE = 'Africa/Cairo';

export type AttendancePolicy = {
  graceMinutes: number;
  checkInOpenMinutes: number;
  checkInCloseMinutes: number;
  strikesPerRedDot: number;
  redDotCost: number;
  currency: string;
};

export type AttendanceStatus = 'not-required' | 'upcoming' | 'open' | 'late-window' | 'on-time' | 'late' | 'excused' | 'absent';

export const DEFAULT_ATTENDANCE_POLICY: AttendancePolicy = {
  graceMinutes: 10,
  checkInOpenMinutes: 60,
  checkInCloseMinutes: 180,
  strikesPerRedDot: 3,
  redDotCost: 0,
  currency: 'EGP',
};

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
};

export function attendancePolicy(settings: any): AttendancePolicy {
  return {
    graceMinutes: clampInt(settings?.attendanceGraceMinutes, 10, 0, 120),
    checkInOpenMinutes: clampInt(settings?.attendanceCheckInOpenMinutes, 60, 0, 1440),
    checkInCloseMinutes: clampInt(settings?.attendanceCheckInCloseMinutes, 180, 10, 1440),
    strikesPerRedDot: clampInt(settings?.attendanceStrikesPerRedDot, 3, 1, 20),
    redDotCost: Math.max(0, Number(settings?.attendanceRedDotCost) || 0),
    currency: String(settings?.attendanceCurrency || 'EGP').trim().slice(0, 12) || 'EGP',
  };
}

function cairoParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

/** Convert an Africa/Cairo wall time to an instant without hard-coding Egypt's DST offset. */
export function cairoDateTimeToUtc(date: string, time: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  const clock = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!match || !clock) throw Object.assign(new Error('A valid event date and Cairo start time are required.'), { status: 400 });
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]), 0);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const shown = cairoParts(new Date(guess));
    const observed = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute), Number(shown.second));
    const delta = desired - observed;
    if (delta === 0) return new Date(guess);
    guess += delta;
  }
  return new Date(guess);
}

export function attendanceWindow(schedule: any, policy: AttendancePolicy) {
  const start = cairoDateTimeToUtc(schedule.date, schedule.startTime);
  return {
    start,
    opensAt: new Date(start.getTime() - policy.checkInOpenMinutes * 60_000),
    graceEndsAt: new Date(start.getTime() + policy.graceMinutes * 60_000),
    closesAt: new Date(start.getTime() + policy.checkInCloseMinutes * 60_000),
  };
}

export function attendanceStatus(schedule: any, playerId: string, now: Date, policy: AttendancePolicy): AttendanceStatus {
  if (!schedule?.attendanceEnabled || !schedule.requiredPlayerIds?.includes(playerId) || !schedule.startTime) return 'not-required';
  const checkIn = (schedule.attendanceCheckIns || []).find((item: any) => item.playerId === playerId);
  if (checkIn?.status === 'on-time' || checkIn?.status === 'late' || checkIn?.status === 'excused') return checkIn.status;
  const window = attendanceWindow(schedule, policy);
  if (now < window.opensAt) return 'upcoming';
  if (now <= window.graceEndsAt) return 'open';
  if (now <= window.closesAt) return 'late-window';
  return 'absent';
}

export function attendanceSummary(db: any, playerId: string, now = new Date()) {
  const policy = attendancePolicy(db.settings);
  const events = (db.schedule || []).filter((event: any) => event?.attendanceEnabled && event.requiredPlayerIds?.includes(playerId) && event.startTime);
  let onTime = 0; let late = 0; let absent = 0;
  const chronological: Array<{ at: number; status: AttendanceStatus }> = [];
  for (const event of events) {
    const status = attendanceStatus(event, playerId, now, policy);
    const at = attendanceWindow(event, policy).start.getTime();
    if (status === 'on-time') { onTime += 1; chronological.push({ at, status }); }
    if (status === 'late' || status === 'late-window') { late += 1; chronological.push({ at, status }); }
    if (status === 'absent') { absent += 1; chronological.push({ at, status }); }
  }
  const strikes = late + absent;
  const greenDots = (db.attendanceCredits || []).filter((entry: any) => entry.playerId === playerId && entry.kind === 'green' && !entry.revokedAt).length;
  const earnedRedDots = Math.floor(strikes / policy.strikesPerRedDot);
  const redDots = Math.max(0, earnedRedDots - greenDots);
  let onTimeStreak = 0;
  for (const entry of chronological.sort((a, b) => b.at - a.at)) {
    if (entry.status !== 'on-time') break;
    onTimeStreak += 1;
  }
  return { playerId, onTime, late, absent, strikes, strikesTowardNextRedDot: strikes % policy.strikesPerRedDot, earnedRedDots, greenDots, redDots, cost: redDots * policy.redDotCost, currency: policy.currency, onTimeStreak };
}
