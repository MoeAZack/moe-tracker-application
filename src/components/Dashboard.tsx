import React, { useMemo } from 'react';
import { TrackerData, Match } from '../types';
import { Activity, ArrowRight, CalendarDays, Film, Swords, Target, TrendingUp, Users } from 'lucide-react';
import { activeRosterCount, canOpenPrivateMatchReview, matchDateWindow, normalizedMatchDate } from '../../lib/uiIntegration';
import DesktopCommandCenter from './DesktopCommandCenter';
import { percentageTextClass } from '../utils/percentageColor';
import CoachWorkflow from './CoachWorkflow';
import { DEFAULT_MINIMUM_METRIC_SAMPLES, knownTotal, publishRate } from '../../lib/metricTrust';

interface Props {
  data: TrackerData; theme: any; role: string | null; username: string | null;
  onOpenMatch: (matchId: string) => void; onOpenReplay?: () => void; onOpenCapture?: () => void;
  onOpenSchedule?: () => void; onOpenCoachWorkspace?: () => void; summaryMode?: boolean;
}

const score = (match: Match) => match.ourScore !== null && match.ourScore !== undefined && match.theirScore !== null && match.theirScore !== undefined
  ? { ours: match.ourScore, theirs: match.theirScore }
  : [match.attW, match.attL, match.defW, match.defL].every(value => typeof value === 'number')
    ? { ours: Number(match.attW) + Number(match.defW), theirs: Number(match.attL) + Number(match.defL) }
    : null;
const matchOrder = (match: Match) => Date.parse(match.sourceMetadata?.capturedAt || '') || Date.parse(`${match.date || ''}T12:00:00Z`) || 0;

export function selectDashboardPersonalRows(data: Pick<TrackerData, 'authenticatedViewer' | 'rosterPlayers' | 'playerStats'>) {
  const playerId = typeof data.authenticatedViewer?.playerId === 'string' ? data.authenticatedViewer.playerId.trim() : '';
  const viewer = playerId ? (data.rosterPlayers || []).find(player => player.id === playerId) : undefined;
  return { viewer: viewer || null, rows: (data.playerStats || []).filter(row => !!viewer && row.playerId === playerId) };
}

/** Personal totals publish only from complete rows; a missing value never becomes zero. */
export function personalTotals(rows: ReadonlyArray<Pick<TrackerData['playerStats'][number], 'kills' | 'deaths' | 'assists' | 'fk' | 'fd'>>, minimumSamples: number) {
  const kills = knownTotal(rows, row => row.kills); const deaths = knownTotal(rows, row => row.deaths); const assists = knownTotal(rows, row => row.assists);
  const firstKills = knownTotal(rows, row => row.fk); const firstDeaths = knownTotal(rows, row => row.fd);
  const openings = firstKills !== null && firstDeaths !== null ? firstKills + firstDeaths : null;
  const opening = publishRate({ numerator: firstKills, denominator: openings, observed: openings === null ? 0 : rows.length, expected: rows.length, minimumSamples });
  return { kills, deaths, assists, firstKills, firstDeaths, openingRate: opening.value === null ? null : Math.round(opening.value) };
}

export default function Dashboard({ data, theme, role, username, onOpenMatch, onOpenReplay, onOpenCapture, onOpenSchedule, onOpenCoachWorkspace, summaryMode = false }: Props) {
  const light = data.settings.theme === 'daylight';
  const muted = light ? 'text-slate-600' : 'text-gray-400';
  const subtle = light ? 'text-slate-500' : 'text-gray-500';
  const surface = `${theme.cardBg} ${theme.border}`;
  const matches = useMemo(() => [...(data.matches || [])].filter(match => normalizedMatchDate(match.date)).sort((a, b) => matchOrder(b) - matchOrder(a)), [data.matches]);
  const window = useMemo(() => matchDateWindow(matches), [matches]);
  const decided = matches.map(score).filter((value): value is { ours: number; theirs: number } => !!value && value.ours !== value.theirs);
  const wins = decided.filter(value => value.ours > value.theirs).length;
  const minimumSamples = data.settings.stats?.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES;
  const currentPlayers = activeRosterCount(data);
  const todayCairo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const nextSession = [...(data.schedule || [])].filter(item => normalizedMatchDate(item.date)).sort((a, b) => normalizedMatchDate(a.date)!.localeCompare(normalizedMatchDate(b.date)!)).find(item => normalizedMatchDate(item.date)! >= todayCairo);
  const cairoDate = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: /T/.test(value) ? 'short' : undefined }).format(/T/.test(value) ? new Date(value) : new Date(`${value}T12:00:00Z`));
  const latestMatch = matches[0];
  const latestScore = latestMatch ? score(latestMatch) : null;
  const { viewer, rows: personalRows } = selectDashboardPersonalRows(data);
  const personalMatchIds = new Set(personalRows.map(row => row.matchId));
  const personalMatches = matches.filter(match => personalMatchIds.has(match.id));
  const { kills, deaths, assists, firstKills, firstDeaths, openingRate } = personalTotals(personalRows, minimumSamples);
  const teamWinRate = publishRate({ numerator: wins, denominator: decided.length, observed: decided.length, expected: decided.length, minimumSamples });
  const teamWinPercent = teamWinRate.value === null ? null : Math.round(teamWinRate.value);
  const knownAdr = personalRows.map(row => row.adr).filter((value): value is number => typeof value === 'number');
  const knownHs = personalRows.map(row => row.hs).filter((value): value is number => typeof value === 'number');
  const knownPerformance = personalRows.map(row => row.performanceScore).filter((value): value is number => typeof value === 'number');
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const canReview = !summaryMode && canOpenPrivateMatchReview(role);

  return <div className="aurora-dashboard space-y-5" aria-labelledby="dashboard-title">
    {!summaryMode && <DesktopCommandCenter onOpenReplay={onOpenReplay} onOpenCapture={onOpenCapture} />}

    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${subtle}`}>{role === 'player' ? 'Personal workspace' : 'Team workspace'}</p><h1 id="dashboard-title" className="mt-1 text-2xl font-semibold tracking-tight">{role === 'coach' ? 'Today at a glance' : `${username || 'Player'} · today`}</h1><p className={`mt-1 text-sm ${muted}`}>{role === 'player' ? 'Your performance, next session, and latest result.' : 'The essential team picture. Detailed coaching work now lives in Coach Workspace.'}</p></div>
      {role === 'coach' && onOpenCoachWorkspace && <button type="button" className="ui-button ui-button-primary min-h-11 px-4 text-sm" onClick={onOpenCoachWorkspace}>Open coach workspace <ArrowRight className="h-4 w-4" /></button>}
    </header>

    {role === 'player' && !summaryMode && <CoachWorkflow data={data} role={role} onOpenMatch={onOpenMatch} />}

    <section className={`grid overflow-hidden rounded-2xl border ${surface} lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]`} aria-label="Current priorities">
      <div className="p-5 sm:p-6">
        <p className="aurora-eyebrow">Latest match</p>
        {latestMatch ? <div className="mt-4"><div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><h2 className="truncate text-xl font-semibold">{data.settings.teamName || 'Our team'} <span className={subtle}>vs</span> {latestMatch.opponent || 'Opponent'}</h2><p className={`mt-1 text-xs ${muted}`}>{latestMatch.map || 'Map unknown'} · {latestMatch.type || 'Match'} · {cairoDate(latestMatch.date)} Cairo</p></div><div className="font-mono text-3xl font-semibold" aria-label={latestScore ? `Our score ${latestScore.ours}, opponent score ${latestScore.theirs}` : 'Score unavailable'}>{latestScore ? `${latestScore.ours} : ${latestScore.theirs}` : '— : —'}</div></div>{canReview && <button type="button" className="ui-button mt-5 min-h-10 px-3 text-xs" onClick={() => onOpenMatch(latestMatch.id)}>Review this match <ArrowRight className="h-3.5 w-3.5" /></button>}</div> : <div className={`mt-4 flex items-center gap-3 text-sm ${muted}`}><Swords className="h-6 w-6" /><span>Your latest match will appear here after it is recorded.</span></div>}
      </div>
      <button type="button" onClick={onOpenSchedule} disabled={!onOpenSchedule} className="border-t border-white/10 p-5 text-left transition hover:bg-white/[0.03] disabled:cursor-default lg:border-l lg:border-t-0">
        <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300"><CalendarDays className="h-4 w-4" /> Next session</span>
        <span className="mt-4 block text-lg font-semibold">{nextSession ? nextSession.primary : 'Nothing scheduled'}</span>
        <span className={`mt-1 block text-xs ${muted}`}>{nextSession ? `${cairoDate(nextSession.date)} Cairo${nextSession.startTime ? ` · ${nextSession.startTime}` : ''}` : 'Open Schedule & Goals to plan the next session.'}</span>
      </button>
    </section>

    {role === 'player' && <section className={`rounded-2xl border p-5 ${surface}`} aria-labelledby="personal-performance-title"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${subtle}`}>My performance</p><h2 id="personal-performance-title" className="mt-1 text-lg font-semibold">{personalMatches.length} recorded match{personalMatches.length === 1 ? '' : 'es'}</h2></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs text-cyan-200">{viewer?.displayName || username || 'Unpaired player'}</span></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric surface={surface} muted={subtle} icon={Swords} label="K / D / A" value={personalRows.length ? `${kills ?? '—'} / ${deaths ?? '—'} / ${assists ?? '—'}` : '—'} detail={kills !== null && deaths !== null && deaths > 0 ? `${(kills / deaths).toFixed(2)} K/D` : 'No complete K/D sample'} /><Metric surface={surface} muted={subtle} icon={Target} label="Headshots" value={average(knownHs) === null ? '—' : `${average(knownHs)!.toFixed(1)}%`} detail={`${knownHs.length} supported rows`} /><Metric surface={surface} muted={subtle} icon={Activity} label="Performance" value={average(knownPerformance) === null ? '—' : average(knownPerformance)!.toFixed(0)} detail={`${knownPerformance.length} supported rows`} /><Metric surface={surface} muted={subtle} icon={Activity} label="Damage" value={average(knownAdr) === null ? '—' : average(knownAdr)!.toFixed(1)} detail="Average ADR" /><Metric surface={surface} muted={subtle} icon={TrendingUp} label="Openings" value={personalRows.length ? `${firstKills ?? '—'}–${firstDeaths ?? '—'}` : '—'} detail={openingRate === null ? 'No complete opening evidence' : `${openingRate}% won`} detailClass={percentageTextClass(openingRate)} /></div>{!viewer && <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">This login is not paired to a roster identity.</p>}</section>}

    <section className="grid gap-3 sm:grid-cols-3" aria-label="Team essentials"><Metric surface={surface} muted={subtle} icon={Swords} label="Recorded matches" value={String(matches.length)} detail={window ? `${window.start} — ${window.end}` : 'No match history'} /><Metric surface={surface} muted={subtle} icon={Activity} label="Team record" value={decided.length ? `${wins}–${decided.length - wins}` : '—'} detail={teamWinPercent !== null ? `${teamWinPercent}% win rate` : decided.length ? `Win rate needs ${teamWinRate.minimumSamples} decided matches` : 'Scores unavailable'} detailClass={percentageTextClass(teamWinPercent)} /><Metric surface={surface} muted={subtle} icon={Users} label="Active roster" value={String(currentPlayers.count)} detail="Current players" /></section>

    <section className={`overflow-hidden rounded-xl border ${surface}`} aria-labelledby="recent-matches-title"><div className={`flex items-center justify-between border-b px-5 py-4 ${theme.border}`}><div><h2 id="recent-matches-title" className="font-semibold">Recent results</h2><p className={`mt-0.5 text-xs ${subtle}`}>The last three recorded matches</p></div><Film className={`h-4 w-4 ${subtle}`} /></div>{matches.slice(0, 3).map(match => <MatchRow key={match.id} match={match} coach={canReview} onOpen={() => onOpenMatch(match.id)} muted={subtle} border={theme.border} />)}{!matches.length && <div className={`px-5 py-10 text-center text-sm ${subtle}`}>No matches recorded yet.</div>}</section>
  </div>;
}

function MatchRow({ match, coach, onOpen, muted, border }: { key?: React.Key; match: Match; coach: boolean; onOpen: () => void; muted: string; border: string }) {
  const result = score(match); const content = <><span className="min-w-0"><span className="block truncate text-sm font-semibold">{match.opponent || 'Opponent not recorded'}</span><span className={`mt-1 block truncate text-xs ${muted}`}>{match.date} · {match.map || 'Map unknown'} · {match.type || 'Match'}</span></span><span className="flex items-center gap-3 self-center"><span className="font-mono text-lg font-semibold">{result ? `${result.ours}–${result.theirs}` : '—'}</span>{coach && <ArrowRight className={`h-4 w-4 ${muted}`} />}</span></>;
  return coach ? <button type="button" onClick={onOpen} className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 border-t px-5 py-4 text-left ${border}`}>{content}</button> : <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 border-t px-5 py-4 ${border}`}>{content}</div>;
}

function Metric({ icon: Icon, label, value, detail, surface, muted, detailClass }: { icon: React.ComponentType<any>; label: string; value: string; detail: string; surface: string; muted: string; detailClass?: string }) {
  return <div className={`rounded-xl border p-4 ${surface}`}><div className={`flex items-center gap-2 text-xs ${muted}`}><Icon className="h-3.5 w-3.5" />{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div><p className={`mt-1 text-xs ${detailClass || muted}`}>{detail}</p></div>;
}
