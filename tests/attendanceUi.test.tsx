import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import CalendarGoals from '../src/components/CalendarGoals';

const playerId = '00000000-0000-4000-8000-000000000001';
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(part => [part.type, part.value]));
const data: any = {
  authenticatedViewer: { playerId },
  settings: { theme: 'radiant', weekStart: 1, calendars: [{ key: 'practice', name: 'Practice', color: '#ff4655' }], players: ['Alpha'], attendanceGraceMinutes: 10, attendanceCheckInOpenMinutes: 60, attendanceCheckInCloseMinutes: 180, attendanceStrikesPerRedDot: 3, attendanceRedDotCost: 50, attendanceCurrency: 'EGP', goalStates: ['Open'], confirmOnSave: false, confirmOnDelete: false },
  rosterPlayers: [{ id: playerId, displayName: 'Alpha', createdAt: '2026-01-01T00:00:00Z' }], coreMemberships: [], tryoutBatches: [], seasonArchives: [], attendanceCredits: [],
  schedule: [{ id: 'practice', date: `${parts.year}-${parts.month}-${parts.day}`, startTime: `${parts.hour}:${parts.minute}`, primary: 'Team practice', calendarKey: 'practice', attendance: {}, attendanceEnabled: true, requiredPlayerIds: [playerId], attendanceCheckIns: [] }], goals: [], matches: [], playerStats: [], soloq: [], rounds: [], vetos: [], strats: [], stratRuns: [], secrets: {}, serverTime: new Date().toISOString(),
};
const props = { data, theme: { text: '', primaryBg: 'primary' }, onUpsert: async () => ({}), onRemove: async () => ({}), onRefresh: async () => {} };

describe('attendance schedule UI', () => {
  it('shows the assigned player a live self-check-in without coach controls', () => {
    const html = renderToStaticMarkup(<CalendarGoals {...props} role="player" />);
    expect(html).toContain('Check in'); expect(html).toContain('Check-in open');
    expect(html).not.toContain('Give green dot'); expect(html).not.toContain('Correct…'); expect(html).not.toContain('ADD EVENT');
  });

  it('shows coach ledger, correction and green-credit controls', () => {
    const penalized = structuredClone(data); penalized.schedule.push(...[1, 2, 3].map(index => ({ ...data.schedule[0], id: `old-${index}`, date: `2026-10-0${index}`, attendanceCheckIns: [{ id: `late-${index}`, playerId, checkedInAt: `2026-10-0${index}T12:20:00Z`, status: 'late' }] })));
    const html = renderToStaticMarkup(<CalendarGoals {...props} data={penalized} role="coach" />);
    expect(html).toContain('Attendance ledger'); expect(html).toContain('Give green dot'); expect(html).toContain('Correct…'); expect(html).toContain('ADD EVENT');
  });
});
