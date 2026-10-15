import React, { useState, useMemo, useEffect } from 'react';
import { TrackerData, Schedule, Goal } from '../types';
import { Calendar, ChevronLeft, ChevronRight, Plus, Edit2, Trash2, CalendarDays, ClipboardList, Clock, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { attendancePolicy, attendanceStatus, attendanceSummary, attendanceWindow } from '../../lib/attendance';
import { repeatedHourlyScheduleRows } from '../../lib/schedule';

interface ComponentProps {
  data: TrackerData;
  theme: any;
  role: string;
  onUpsert: (sheet: string, row: any) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
  onRefresh: () => Promise<void>;
}

const cairoDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);

export default function CalendarGoals({ data, theme, role, onUpsert, onRemove, onRefresh }: ComponentProps) {
  const [activeSubTab, setActiveSubTab] = useState<'calendar' | 'goals'>('calendar');
  const isLight = data.settings.theme === 'daylight';

  // --- CALENDAR STATE ---
  const [currentDate, setCurrentDate] = useState(() => new Date(`${cairoDate()}T12:00:00`));
  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => cairoDate());
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Partial<Schedule> | null>(null);
  const [repeatHours, setRepeatHours] = useState(1);
  const [calendarView, setCalendarView] = useState<'month' | 'day'>('month');
  const [now, setNow] = useState(() => new Date());
  const [attendanceBusy, setAttendanceBusy] = useState('');
  const [attendanceMessage, setAttendanceMessage] = useState('');

  // --- GOALS STATE ---
  const [goalFilter, setGoalFilter] = useState<string>('All');
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Partial<Goal> | null>(null);

  const rosterPlayers = (data.rosterPlayers || []).filter(player => !player.retiredAt);
  const calendars = data.settings.calendars || [];
  const scheduleList = data.schedule || [];
  const goalsList = data.goals || [];
  const policy = useMemo(() => attendancePolicy(data.settings), [data.settings]);
  const attendanceSummaries = useMemo(() => rosterPlayers.map(player => ({ player, summary: attendanceSummary(data, player.id, now) })), [data, rosterPlayers, now]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // --- CALENDAR CALCULATIONS ---
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const daysInMonth = useMemo(() => new Date(year, month + 1, 0).getDate(), [year, month]);
  const firstDayIndex = useMemo(() => {
    const day = new Date(year, month, 1).getDay();
    // Adjust for week start: 1 for Monday, 0 for Sunday
    const startOffset = data.settings.weekStart || 1;
    return (day - startOffset + 7) % 7;
  }, [year, month, data.settings.weekStart]);

  const prevMonthDays = useMemo(() => new Date(year, month, 0).getDate(), [year, month]);

  const monthName = currentDate.toLocaleString('default', { month: 'long' });

  const calendarDays = useMemo(() => {
    const cells = [];
    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = month === 0 ? 11 : month - 1;
      const y = month === 0 ? year - 1 : year;
      cells.push({ day: d, currentMonth: false, dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, currentMonth: true, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    // Next month filler days
    const totalCellsSoFar = cells.length;
    const remaining = 42 - totalCellsSoFar;
    for (let i = 1; i <= remaining; i++) {
      const m = month === 11 ? 0 : month + 1;
      const y = month === 11 ? year + 1 : year;
      cells.push({ day: i, currentMonth: false, dateStr: `${y}-${String(m + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}` });
    }
    return cells;
  }, [daysInMonth, firstDayIndex, prevMonthDays, year, month]);

  const scheduleMap = useMemo(() => {
    const map: Record<string, Schedule[]> = {};
    scheduleList.forEach((s) => {
      if (!map[s.date]) map[s.date] = [];
      map[s.date].push(s);
    });
    return map;
  }, [scheduleList]);

  const shiftMonth = (dir: number) => {
    setCurrentDate(new Date(year, month + dir, 1));
  };

  const selectedDaySchedules = useMemo(() => {
    return scheduleMap[selectedDateStr] || [];
  }, [scheduleMap, selectedDateStr]);

  // --- CALENDAR MUTATIONS ---
  const handleOpenAddSchedule = (dateStr: string, startTime = '15:00') => {
    setAttendanceMessage('');
    setEditingSchedule({
      id: '',
      date: dateStr,
      calendarKey: calendars[0]?.key || 'practice',
      primary: '',
      secondary: '',
      notes: '',
      startTime,
      allDay: false,
      durationMinutes: 60,
      attendanceEnabled: false,
      requiredPlayerIds: [],
      attendance: {}
    });
    setRepeatHours(1);
    setScheduleModalOpen(true);
  };

  const handleOpenEditSchedule = (sched: Schedule) => {
    setAttendanceMessage('');
    setEditingSchedule({ ...sched });
    setRepeatHours(1);
    setScheduleModalOpen(true);
  };

  const shiftSelectedDay = (days: number) => {
    const next = new Date(`${selectedDateStr}T12:00:00`); next.setDate(next.getDate() + days);
    const nextDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    setSelectedDateStr(nextDate); setCurrentDate(new Date(next.getFullYear(), next.getMonth(), 1));
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule || !editingSchedule.primary) return;
    if (!editingSchedule.allDay && !editingSchedule.startTime) { setAttendanceMessage('Choose a Cairo start time for an hourly event.'); return; }
    if (editingSchedule.attendanceEnabled && !(editingSchedule.requiredPlayerIds?.length)) { setAttendanceMessage('Select at least one player for attendance.'); return; }
    if (data.settings.confirmOnSave && !window.confirm('Save this schedule item?')) return;
    if (!editingSchedule.id && !editingSchedule.allDay && repeatHours > 1) {
      const rows = repeatedHourlyScheduleRows(editingSchedule, repeatHours, globalThis.crypto?.randomUUID?.() || `repeat-${Date.now()}`);
      for (const row of rows) await onUpsert('Schedule', row);
    } else await onUpsert('Schedule', editingSchedule);
    setScheduleModalOpen(false);
    setEditingSchedule(null);
  };

  const duplicateNextHour = async (schedule: Schedule) => {
    if (!schedule.startTime) return;
    const hour = Number(schedule.startTime.slice(0, 2)); if (hour >= 23) { setAttendanceMessage('This is already the final hourly slot of the day.'); return; }
    const copy = { ...schedule, id: '', startTime: `${String(hour + 1).padStart(2, '0')}:${schedule.startTime.slice(3, 5)}`, attendanceCheckIns: [], source: 'manual' as const, sourceEventId: undefined, repeatSeriesId: schedule.repeatSeriesId || (globalThis.crypto?.randomUUID?.() || `repeat-${Date.now()}`), repeatIndex: (schedule.repeatIndex || 1) + 1, repeatCount: Math.max(schedule.repeatCount || 1, (schedule.repeatIndex || 1) + 1) };
    await onUpsert('Schedule', copy); setAttendanceMessage(`${schedule.primary} duplicated to ${copy.startTime}.`);
  };

  const handleDeleteSchedule = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this schedule? This action is irreversible.')) return;
    await onRemove('Schedule', id);
  };

  const postAttendance = async (path: string, body: Record<string, unknown>, busyKey: string) => {
    setAttendanceBusy(busyKey); setAttendanceMessage('');
    try {
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Attendance could not be updated.');
      setAttendanceMessage(path.includes('green-credit') ? 'Green dot recorded.' : path.includes('/correct') ? 'Attendance correction saved with its reason.' : result.checkIn?.status === 'late' ? 'Checked in late — one strike recorded.' : 'Checked in on time.');
      await onRefresh(); setNow(new Date());
    } catch (error: any) { setAttendanceMessage(error?.message || 'Attendance could not be updated.'); }
    finally { setAttendanceBusy(''); }
  };

  const giveGreenDot = async (playerId: string, displayName: string) => {
    const reason = window.prompt(`Why is ${displayName} receiving a green dot?`, 'Consistent on-time attendance');
    if (!reason?.trim()) return;
    await postAttendance('/api/attendance/green-credit', { playerId, reason: reason.trim() }, `green:${playerId}`);
  };

  const correctAttendance = async (scheduleId: string, playerId: string, status: string) => {
    const reason = window.prompt(`Reason for changing this record to ${status}?`, status === 'excused' ? 'Excused by coach' : 'Coach correction');
    if (!reason?.trim()) return;
    await postAttendance('/api/attendance/correct', { scheduleId, playerId, status, reason: reason.trim() }, `correct:${scheduleId}:${playerId}`);
  };

  const playerName = (id: string) => rosterPlayers.find(player => player.id === id)?.displayName || 'Unknown player';
  const statusLabel = (status: string) => ({ 'not-required': 'Not required', upcoming: 'Upcoming', open: 'Check-in open', 'late-window': 'Late · strike · check in', 'on-time': 'On time', late: 'Late · strike', excused: 'Excused', absent: 'Absent · strike' }[status] || status);
  const statusClass = (status: string) => ({ upcoming: 'text-slate-400 border-white/10 bg-white/5', open: 'text-cyan-200 border-cyan-400/30 bg-cyan-400/10', 'late-window': 'text-amber-200 border-amber-400/30 bg-amber-400/10', 'on-time': 'text-emerald-200 border-emerald-400/30 bg-emerald-400/10', late: 'text-amber-200 border-amber-400/30 bg-amber-400/10', excused: 'text-violet-200 border-violet-400/30 bg-violet-400/10', absent: 'text-rose-200 border-rose-400/30 bg-rose-400/10' }[status] || 'text-slate-400 border-white/10 bg-white/5');

  // --- GOAL MUTATIONS ---
  const filteredGoals = useMemo(() => {
    if (goalFilter === 'All') return goalsList;
    return goalsList.filter(g => g.status === goalFilter);
  }, [goalsList, goalFilter]);

  const handleOpenAddGoal = () => {
    setEditingGoal({
      id: '',
      date: cairoDate(),
      goal: '',
      notes: '',
      status: 'Open',
      owner: ''
    });
    setGoalModalOpen(true);
  };

  const handleOpenEditGoal = (g: Goal) => {
    setEditingGoal({ ...g });
    setGoalModalOpen(true);
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGoal || !editingGoal.goal) return;
    await onUpsert('Goals', editingGoal);
    setGoalModalOpen(false);
    setEditingGoal(null);
  };

  const handleDeleteGoal = async (id: string) => {
    if (data.settings.confirmOnDelete && !window.confirm('Delete this goal?')) return;
    await onRemove('Goals', id);
  };

  const handleQuickStatusGoal = async (g: Goal, nextStatus: string) => {
    await onUpsert('Goals', { ...g, status: nextStatus });
  };

  return (
    <div className="space-y-6">
      {/* Sub Tabs Toggle */}
      <div className="flex gap-2 border-b border-white/10 pb-4">
        <button
          onClick={() => setActiveSubTab('calendar')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
            activeSubTab === 'calendar'
              ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          Schedule Calendar
        </button>
        <button
          onClick={() => setActiveSubTab('goals')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-black tracking-widest uppercase rounded-lg transition-all ${
            activeSubTab === 'goals'
              ? 'bg-white/5 text-white shadow-md border-b-2 border-white'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          Practice Goals
        </button>
      </div>

      {activeSubTab === 'calendar' ? (
        <div className="space-y-6">
          {attendanceSummaries.length > 0 && (
            <section className={`rounded-xl border p-4 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/5'}`}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xs font-black uppercase tracking-widest">Attendance ledger</h3><p className="mt-1 text-[10px] text-gray-400">{policy.strikesPerRedDot} strikes = 1 red dot · {policy.graceMinutes}-minute grace · Cairo time</p></div>{data.settings.attendanceRedDotCost ? <span className="rounded-full border border-rose-400/25 bg-rose-400/10 px-3 py-1 text-[10px] font-bold text-rose-200">{policy.redDotCost} {policy.currency} / active red dot</span> : null}</div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {attendanceSummaries.map(({ player, summary }) => <article key={player.id} className="rounded-lg border border-white/10 bg-black/10 p-3">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold">{player.displayName}</p><p className="mt-1 text-[10px] text-gray-400">{summary.onTime} on time · {summary.late} late · {summary.absent} absent · streak {summary.onTimeStreak}</p></div><div className="flex items-center gap-1" aria-label={`${summary.redDots} red dots and ${summary.greenDots} green dots`}><span className="text-sm text-rose-400">{'●'.repeat(summary.redDots) || '○'}</span>{summary.greenDots > 0 && <span className="text-sm text-emerald-400">{'●'.repeat(summary.greenDots)}</span>}</div></div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] font-bold text-amber-200">{summary.strikes} strikes · {summary.strikesTowardNextRedDot}/{policy.strikesPerRedDot} toward next</span><span className="text-[10px] font-black text-rose-200">{summary.cost > 0 ? `${summary.cost} ${summary.currency}` : 'No active cost'}</span></div>
                  {role === 'coach' && <button type="button" title={summary.redDots < 1 ? 'Green dots remove an existing red dot.' : 'Remove one red dot and keep the history.'} disabled={summary.redDots < 1 || attendanceBusy === `green:${player.id}`} onClick={() => void giveGreenDot(player.id, player.displayName)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 text-[10px] font-bold text-emerald-200 disabled:opacity-40"><ShieldCheck className="h-3.5 w-3.5" /> Give green dot</button>}
                </article>)}
              </div>
              {attendanceMessage && <p role="status" className="mt-3 text-xs text-cyan-200">{attendanceMessage}</p>}
            </section>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1" role="group" aria-label="Calendar view">
              <button type="button" aria-pressed={calendarView === 'month'} onClick={() => setCalendarView('month')} className={`min-h-10 rounded-lg px-4 text-[10px] font-black uppercase tracking-wider ${calendarView === 'month' ? 'bg-white/10 text-white shadow' : 'text-gray-400 hover:text-white'}`}><CalendarDays className="mr-1.5 inline h-3.5 w-3.5" /> Month</button>
              <button type="button" aria-pressed={calendarView === 'day'} onClick={() => setCalendarView('day')} className={`min-h-10 rounded-lg px-4 text-[10px] font-black uppercase tracking-wider ${calendarView === 'day' ? 'bg-white/10 text-white shadow' : 'text-gray-400 hover:text-white'}`}><Clock className="mr-1.5 inline h-3.5 w-3.5" /> Day</button>
            </div>
            <p className="text-[10px] text-gray-500">Day timeline: 12:00 PM–12:00 AM · Cairo</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid Frame */}
          {calendarView === 'month' ? (
          <div className={`lg:col-span-2 p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} flex flex-col`}>
            {/* Calendar Controller Header */}
            <div className="flex justify-between items-center mb-5">
              <div className="flex items-center gap-2">
                <Calendar className={`w-5 h-5 ${theme.text}`} />
                <h3 className="font-black text-sm tracking-wide uppercase">{monthName} {year}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => shiftMonth(-1)}
                  className={`p-1.5 rounded bg-white/5 hover:bg-white/10 border ${isLight ? 'border-slate-200' : 'border-white/10'} transition-colors`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => shiftMonth(1)}
                  className={`p-1.5 rounded bg-white/5 hover:bg-white/10 border ${isLight ? 'border-slate-200' : 'border-white/10'} transition-colors`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Days of Week Row */}
            <div className="grid grid-cols-7 gap-1 text-center font-bold font-mono text-[10px] text-gray-500 uppercase mb-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="py-1">{d}</div>)}
            </div>

            {/* Calendar Cells Grid */}
            <div className="grid grid-cols-7 gap-1 flex-grow">
              {calendarDays.map((cell, idx) => {
                const dayScheds = scheduleMap[cell.dateStr] || [];
                const isSelected = selectedDateStr === cell.dateStr;
                const isToday = cairoDate(now) === cell.dateStr;

                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDateStr(cell.dateStr)}
                    className={`min-h-[70px] p-1.5 rounded-lg border flex flex-col text-left transition-all ${
                      cell.currentMonth
                        ? isLight ? 'bg-slate-50 text-slate-800' : 'bg-white/5 text-slate-100'
                        : 'opacity-30'
                    } ${
                      isSelected
                        ? isLight ? 'border-slate-800 bg-slate-100 ring-2 ring-slate-200' : 'border-white bg-white/10 ring-2 ring-white/10'
                        : isLight ? 'border-slate-100' : 'border-white/5'
                    } ${isToday ? `ring-2 ring-offset-2 ${isLight ? 'ring-slate-400' : 'ring-rose-500'}` : ''}`}
                  >
                    <span className="text-xs font-black font-mono">{cell.day}</span>
                    
                    {/* Events indicators */}
                    <div className="mt-auto space-y-1 w-full overflow-hidden">
                      {dayScheds.slice(0, 2).map((s) => {
                        const cal = calendars.find(c => c.key === s.calendarKey) || { color: '#ff4655' };
                        return (
                          <div
                            key={s.id}
                            style={{ backgroundColor: cal.color + '22', borderLeft: `3px solid ${cal.color}` }}
                            className="text-[9px] px-1 py-0.5 rounded-sm truncate text-white uppercase font-black tracking-tighter"
                          >
                            {s.allDay ? 'ALL DAY · ' : s.startTime ? `${s.startTime} · ` : ''}{s.primary}
                          </div>
                        );
                      })}
                      {dayScheds.length > 2 && (
                        <div className="text-[8px] text-gray-500 font-bold text-center">+{dayScheds.length - 2} more</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          ) : (
            <div className={`lg:col-span-2 overflow-hidden rounded-xl border ${isLight ? 'border-slate-200 bg-white text-slate-800 shadow-sm' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <button type="button" aria-label="Previous day" onClick={() => shiftSelectedDay(-1)} className="ui-button min-h-10 px-3"><ChevronLeft className="h-4 w-4" /></button>
                <div className="text-center"><h3 className="text-sm font-black uppercase tracking-wide">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${selectedDateStr}T12:00:00`))}</h3><p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-cyan-200">Hourly plan · Cairo time</p></div>
                <button type="button" aria-label="Next day" onClick={() => shiftSelectedDay(1)} className="ui-button min-h-10 px-3"><ChevronRight className="h-4 w-4" /></button>
              </div>
              <div className="max-h-[720px] overflow-y-auto">
                {selectedDaySchedules.filter(item => item.allDay).length > 0 && <div className="border-b border-white/10 bg-cyan-400/5 p-3"><p className="mb-2 text-[9px] font-black uppercase tracking-widest text-cyan-200">All-day main goals</p><div className="grid gap-2 sm:grid-cols-2">{selectedDaySchedules.filter(item => item.allDay).map(schedule => <button key={schedule.id} type="button" onClick={() => role === 'coach' ? handleOpenEditSchedule(schedule) : undefined} className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-left"><span className="text-sm font-bold">{schedule.primary}</span>{schedule.secondary && <span className="mt-1 block text-[10px] text-gray-400">{schedule.secondary}</span>}</button>)}</div></div>}
                {Array.from({ length: 12 }, (_, index) => index + 12).map(hour => {
                  const events = selectedDaySchedules.filter(item => !item.allDay && Number(item.startTime?.slice(0, 2)) === hour).sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)));
                  const time = `${String(hour).padStart(2, '0')}:00`;
                  const label = hour === 12 ? '12:00 pm' : `${hour - 12}:00 pm`;
                  return <div key={hour} className="grid min-h-[76px] grid-cols-[5.5rem_1fr] border-b border-white/5 last:border-b-0"><div className="border-r border-white/5 p-3 text-right text-[10px] font-black text-gray-500">{label}</div><div className="space-y-2 p-2">{events.map(schedule => { const cal = calendars.find(item => item.key === schedule.calendarKey) || { color: '#ff4655', name: 'Schedule' }; return <button type="button" key={schedule.id} onClick={() => role === 'coach' ? handleOpenEditSchedule(schedule) : undefined} className="block w-full rounded-lg border p-3 text-left transition hover:bg-white/5" style={{ borderColor: `${cal.color}55`, backgroundColor: `${cal.color}12` }}><span className="text-[9px] font-black uppercase tracking-widest text-gray-400">{schedule.startTime} · {cal.name}{schedule.source === 'pracc' ? ' · Pracc' : ''}</span><span className="mt-1 block text-sm font-bold">{schedule.primary}</span>{schedule.secondary && <span className="mt-1 block text-[10px] text-gray-400">{schedule.secondary}</span>}</button>; })}{events.length === 0 && role === 'coach' && <button type="button" onClick={() => handleOpenAddSchedule(selectedDateStr, time)} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-dashed border-white/10 text-[10px] font-bold text-gray-500 hover:border-cyan-400/30 hover:text-cyan-200"><Plus className="h-3.5 w-3.5" /> Add at {label}</button>}</div></div>;
                })}
                <div className="grid grid-cols-[5.5rem_1fr] bg-black/10"><div className="border-r border-white/5 p-3 text-right text-[10px] font-black text-gray-500">12:00 am</div><div className="p-3 text-[10px] text-gray-600">End of day timeline</div></div>
              </div>
              {selectedDaySchedules.some(item => !item.allDay && (!item.startTime || Number(item.startTime.slice(0, 2)) < 12)) && <div className="border-t border-amber-400/15 bg-amber-400/5 p-3 text-[10px] text-amber-200">{selectedDaySchedules.filter(item => !item.allDay && (!item.startTime || Number(item.startTime.slice(0, 2)) < 12)).length} event(s) before 12:00 PM remain visible in Day Details.</div>}
            </div>
          )}

          {/* Day details side card */}
          <div className={`p-5 rounded-xl border ${isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10'} h-fit`}>
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-black text-xs uppercase text-gray-500 font-mono">Day Details: {selectedDateStr}</h4>
              {role === 'coach' && <button
                onClick={() => handleOpenAddSchedule(selectedDateStr)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold rounded ${theme.primaryBg} text-white cursor-pointer hover:opacity-90`}
              >
                <Plus className="w-3.5 h-3.5" /> ADD EVENT
              </button>}
            </div>

            {selectedDaySchedules.length > 0 ? (
              <div className="space-y-4">
                {selectedDaySchedules.map((sched) => {
                  const cal = calendars.find(c => c.key === sched.calendarKey) || { color: '#ff4655', name: 'Schedule' };
                  return (
                    <div key={sched.id} className={`p-4 rounded-xl border ${isLight ? 'bg-slate-50 border-slate-100' : 'bg-white/5 border-white/5'} space-y-3 relative group`}>
                      {role === 'coach' && <div className="absolute right-3 top-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleOpenEditSchedule(sched)}
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(sched.id)}
                          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-rose-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>}

                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cal.color }}></div>
                        <span className="text-[10px] uppercase font-black tracking-widest text-gray-400 font-mono">{cal.name}</span>
                      </div>

                      <div>
                        <h5 className="text-base font-black tracking-tight">{sched.primary}</h5>
                        <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-cyan-200"><Clock className="h-3 w-3" /> {sched.allDay ? 'All day · Main goal' : `${sched.startTime || 'Time not set'} Cairo`} {sched.source === 'pracc' ? '· Pracc' : ''}</p>
                        {sched.secondary && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{sched.secondary}</p>
                        )}
                      </div>

                      {sched.notes && (
                        <p className="text-xs text-gray-400 bg-black/10 p-2.5 rounded font-mono leading-relaxed">{sched.notes}</p>
                      )}

                      {role === 'coach' && !sched.allDay && sched.startTime && <button type="button" onClick={() => void duplicateNextHour(sched)} className="ui-button min-h-9 px-3 text-[9px]"><Plus className="h-3.5 w-3.5" /> Duplicate next hour</button>}

                      {sched.attendanceEnabled && sched.startTime && <div>
                        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-500">Attendance</p>
                        <div className="space-y-1.5">{(sched.requiredPlayerIds || []).map(playerId => { const status = attendanceStatus(sched, playerId, now, policy); const isMe = data.authenticatedViewer?.playerId === playerId; const canCheckIn = role === 'player' && isMe && (status === 'open' || status === 'late-window'); return <div key={playerId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/10 px-2.5 py-2"><span className="text-xs font-bold">{playerName(playerId)}</span><div className="flex items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${statusClass(status)}`}>{statusLabel(status)}</span>{canCheckIn && <button type="button" disabled={attendanceBusy === `checkin:${sched.id}`} onClick={() => void postAttendance('/api/attendance/check-in', { scheduleId: sched.id }, `checkin:${sched.id}`)} className="ui-button ui-button-primary min-h-9 px-3 text-[10px] disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" /> Check in</button>}{role === 'coach' && <select aria-label={`Correct attendance for ${playerName(playerId)}`} disabled={attendanceBusy === `correct:${sched.id}:${playerId}`} value="" onChange={event => { if (event.target.value) void correctAttendance(sched.id, playerId, event.target.value); }} className="min-h-9 rounded-lg border border-white/10 bg-black/30 px-2 text-[9px] text-gray-300"><option value="">Correct…</option><option value="on-time">On time</option><option value="late">Late</option><option value="excused">Excused</option><option value="clear">Clear record</option></select>}</div></div>; })}</div>
                        {(() => { const window = attendanceWindow(sched, policy); return <p className="mt-2 text-[9px] text-gray-500">On time through {new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }).format(window.graceEndsAt)} · check-in closes {new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' }).format(window.closesAt)}</p>; })()}
                      </div>}
                      {!sched.attendanceEnabled && Object.keys(sched.attendance || {}).length > 0 && <p className="text-[10px] text-gray-500">Legacy attendance labels preserved. Enable timed attendance when editing this event.</p>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-2">
                <Clock className="w-8 h-8 text-gray-600" />
                No events scheduled for this day.
              </div>
            )}
          </div>
        </div>
        </div>
      ) : (
        /* GOALS VIEW */
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            {/* Filter buttons */}
            <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5">
              {['All', 'Open', 'In progress', 'Done'].map((st) => (
                <button
                  key={st}
                  onClick={() => setGoalFilter(st)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                    goalFilter === st
                      ? isLight ? 'bg-slate-900 text-white' : 'bg-white/10 text-white'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <button
              onClick={handleOpenAddGoal}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded ${theme.primaryBg} text-white cursor-pointer`}
            >
              <Plus className="w-4 h-4" /> NEW GOAL
            </button>
          </div>

          {/* Goals list */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGoals.map((g) => {
              const borderCol = {
                'Open': 'border-blue-500/20 shadow-blue-500/5',
                'In progress': 'border-amber-500/20 shadow-amber-500/5',
                'Done': 'border-emerald-500/20 shadow-emerald-500/5'
              }[g.status as string] || 'border-white/10';

              const badgeCol = {
                'Open': 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
                'In progress': 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
                'Done': 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }[g.status as string] || 'bg-slate-500/10';

              return (
                <div key={g.id} className={`p-5 rounded-xl border bg-white/5 shadow-lg ${borderCol} flex flex-col justify-between group relative`}>
                  <div className="absolute right-4 top-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleOpenEditGoal(g)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteGoal(g.id)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-rose-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-start">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase font-mono ${badgeCol}`}>
                        {g.status}
                      </span>
                      <span className="text-[10px] text-gray-500 font-mono">{g.date}</span>
                    </div>

                    <div>
                      <h5 className="text-base font-black tracking-tight leading-snug">{g.goal}</h5>
                      {g.notes && <p className="text-xs text-gray-400 mt-1 font-mono leading-relaxed">{g.notes}</p>}
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-white/5 flex justify-between items-center">
                    <span className="text-[10px] font-mono text-gray-500 uppercase">
                      Owner: {g.owner || 'TEAM'}
                    </span>

                    {/* Quick status cycle */}
                    <div className="flex items-center gap-1">
                      {g.status === 'Open' && (
                        <button
                          onClick={() => handleQuickStatusGoal(g, 'In progress')}
                          className="px-2 py-1 text-[9px] font-bold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded font-mono uppercase"
                        >
                          Start
                        </button>
                      )}
                      {g.status === 'In progress' && (
                        <button
                          onClick={() => handleQuickStatusGoal(g, 'Done')}
                          className="px-2 py-1 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded font-mono uppercase"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredGoals.length === 0 && (
              <div className="col-span-full py-16 text-center text-gray-500 font-mono text-xs flex flex-col items-center justify-center gap-2 bg-white/5 rounded-xl border border-white/5">
                <AlertCircle className="w-8 h-8 text-gray-600" />
                No goals in this category.
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- SCHEDULE MODAL --- */}
      {scheduleModalOpen && editingSchedule && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto animate-fadeIn">
          <form onSubmit={handleSaveSchedule} className={`w-full max-w-xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingSchedule.id ? 'EDIT EVENT' : 'ADD NEW EVENT'}
              </h4>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/10 p-1" role="group" aria-label="Event type">
              <button type="button" aria-pressed={Boolean(editingSchedule.allDay)} onClick={() => setEditingSchedule({ ...editingSchedule, allDay: true, attendanceEnabled: false })} className={`min-h-12 rounded-lg px-3 text-xs font-bold ${editingSchedule.allDay ? 'bg-cyan-400/15 text-cyan-100' : 'text-gray-400 hover:text-white'}`}><CalendarDays className="mr-1.5 inline h-4 w-4" /> Full day · Main goal</button>
              <button type="button" aria-pressed={!editingSchedule.allDay} onClick={() => setEditingSchedule({ ...editingSchedule, allDay: false, startTime: editingSchedule.startTime || '15:00' })} className={`min-h-12 rounded-lg px-3 text-xs font-bold ${!editingSchedule.allDay ? 'bg-cyan-400/15 text-cyan-100' : 'text-gray-400 hover:text-white'}`}><Clock className="mr-1.5 inline h-4 w-4" /> Hourly event</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Date</label>
                <input
                  type="date"
                  required
                  value={editingSchedule.date}
                  onChange={e => setEditingSchedule({ ...editingSchedule, date: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Type</label>
                <select
                  value={editingSchedule.calendarKey}
                  onChange={e => setEditingSchedule({ ...editingSchedule, calendarKey: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {calendars.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
                </select>
              </div>
            </div>

            {!editingSchedule.allDay && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Start time · Cairo</label>
                <input type="time" required value={editingSchedule.startTime || ''} onChange={event => setEditingSchedule({ ...editingSchedule, startTime: event.target.value })} className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono" />
              </div>
              <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs font-bold text-cyan-100">
                <input type="checkbox" checked={Boolean(editingSchedule.attendanceEnabled)} onChange={event => setEditingSchedule({ ...editingSchedule, attendanceEnabled: event.target.checked })} />
                Require player check-in
              </label>
            </div>}

            {!editingSchedule.allDay && !editingSchedule.id && <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1 text-[10px] font-black uppercase text-gray-400">Block length
                <select value={editingSchedule.durationMinutes || 60} onChange={event => setEditingSchedule({ ...editingSchedule, durationMinutes: Number(event.target.value) })} className="ui-field w-full p-2.5 text-xs"><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>1 hour</option><option value={90}>90 minutes</option><option value={120}>2 hours</option></select>
              </label>
              <label className="space-y-1 text-[10px] font-black uppercase text-gray-400">Repeat consecutive hourly slots
                <input aria-label="Repeat hourly event count" type="number" min="1" max="12" value={repeatHours} onChange={event => setRepeatHours(Math.min(12, Math.max(1, Number(event.target.value) || 1)))} className="ui-field w-full p-2.5 text-xs" />
              </label>
              {repeatHours > 1 && <p className="md:col-span-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-[10px] text-cyan-100">This creates {repeatHours} copies one hour apart. Example: “Ascent map” at 15:00 × 4 creates 15:00, 16:00, 17:00 and 18:00 blocks.</p>}
            </div>}

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">{editingSchedule.allDay ? 'Main goal for the day' : 'Hourly activity / map'}</label>
              <input
                type="text"
                required
                placeholder={editingSchedule.allDay ? 'e.g. Clean communication and trading' : 'e.g. Ascent map, VOD review'}
                value={editingSchedule.primary}
                onChange={e => setEditingSchedule({ ...editingSchedule, primary: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Secondary Goal / Notes (Sub-title)</label>
              <input
                type="text"
                placeholder="e.g. A split details, pistol rounds only"
                value={editingSchedule.secondary}
                onChange={e => setEditingSchedule({ ...editingSchedule, secondary: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Additional Details</label>
              <textarea
                rows={3}
                placeholder="Scrim links, specific notes, discord tags"
                value={editingSchedule.notes}
                onChange={e => setEditingSchedule({ ...editingSchedule, notes: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
              />
            </div>

            {editingSchedule.attendanceEnabled && <div className="space-y-2">
              <div className="flex items-center justify-between border-b border-white/5 pb-1"><label className="text-[10px] uppercase font-black text-gray-400 font-mono">Players required to attend</label><span className="text-[9px] text-gray-500">{editingSchedule.requiredPlayerIds?.length || 0} selected</span></div>
              <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
                {rosterPlayers.map(player => { const selected = editingSchedule.requiredPlayerIds?.includes(player.id) || false; return <label key={player.id} className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${selected ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-100' : 'border-white/5 bg-black/10 text-gray-400'}`}><input type="checkbox" checked={selected} onChange={event => { const ids = new Set(editingSchedule.requiredPlayerIds || []); if (event.target.checked) ids.add(player.id); else ids.delete(player.id); setEditingSchedule({ ...editingSchedule, requiredPlayerIds: [...ids] }); }} />{player.displayName}</label>; })}
              </div>
              {rosterPlayers.length === 0 && <p className="text-xs text-amber-300">Add players to the roster before enabling attendance.</p>}
              <p className="text-[9px] leading-relaxed text-gray-500">Check-in opens {policy.checkInOpenMinutes} minutes before the event. It is on time through {policy.graceMinutes} minutes after the start, then late until the {policy.checkInCloseMinutes}-minute close.</p>
            </div>}

            {attendanceMessage && <p role="status" className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-cyan-100">{attendanceMessage}</p>}

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white`}
              >
                SAVE SCHEDULE
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- GOAL MODAL --- */}
      {goalModalOpen && editingGoal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <form onSubmit={handleSaveGoal} className={`w-full max-w-md p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <h4 className="text-lg font-black tracking-tight uppercase">
                {editingGoal.id ? 'EDIT GOAL' : 'ADD NEW GOAL'}
              </h4>
              <button
                type="button"
                onClick={() => setGoalModalOpen(false)}
                className="text-gray-400 hover:text-white font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Date Assigned</label>
              <input
                type="date"
                required
                value={editingGoal.date}
                onChange={e => setEditingGoal({ ...editingGoal, date: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Goal / Practice Topic</label>
              <input
                type="text"
                required
                placeholder="e.g. Bind: Hold garden control cleaner"
                value={editingGoal.goal}
                onChange={e => setEditingGoal({ ...editingGoal, goal: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Details / Tips</label>
              <textarea
                rows={3}
                placeholder="Focus items, setups, key players responsibilities"
                value={editingGoal.notes}
                onChange={e => setEditingGoal({ ...editingGoal, notes: e.target.value })}
                className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Status</label>
                <select
                  value={editingGoal.status}
                  onChange={e => setEditingGoal({ ...editingGoal, status: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  {data.settings.goalStates.map(st => <option key={st} value={st}>{st}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-400 font-mono">Owner (Dropdown)</label>
                <select
                  value={editingGoal.owner}
                  onChange={e => setEditingGoal({ ...editingGoal, owner: e.target.value })}
                  className="w-full p-2.5 bg-black/20 rounded border border-white/10 text-xs text-white"
                >
                  <option value="">TEAM Goal</option>
                  {rosterPlayers.map(player => <option key={player.id} value={player.displayName}>{player.displayName}</option>)}
                </select>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setGoalModalOpen(false)}
                className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white"
              >
                CANCEL
              </button>
              <button
                type="submit"
                className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white`}
              >
                SAVE GOAL
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
