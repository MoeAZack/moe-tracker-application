// The practice summary a coach sends the team after a session: how it went,
// what to keep doing, what to work on, and what was assigned. It is built
// from the session's linked matches, the review findings the coach accepted,
// tasks made from its rounds, and VOD notes, so it is ready as soon as the
// matches are linked (which happens on its own for PRACC sessions).
//
// Every judgment here needs enough rounds behind it; a thin session says so
// instead of calling a 1-of-2 a strength.

import type { CoachingAction, Match, Schedule, TrackerData } from '../src/types';
import { buildPracticeBlockSummary, type PracticeBlockSummary } from './coachingWorkflow';
import { DEFAULT_MINIMUM_METRIC_SAMPLES } from './metricTrust';
import { toCairoDateKey } from './coachAnalytics';

type RecapData = Pick<TrackerData, 'schedule' | 'practiceBlocks' | 'matches' | 'playerStats' | 'rounds' | 'rosterPlayers' | 'settings' | 'coachingSignals' | 'coachingActions' | 'vodReviews'>;

export const RECAP_SCHEMA = 'moetracker.practice-recap/v1' as const;
/** Pistols are two a map, so they get their own, smaller minimum. */
export const MIN_PISTOLS = 4;
/** A summary is offered in the inbox for this many days after the session. */
export const RECAP_INBOX_DAYS = 7;

export interface PracticeRecap {
  schema: typeof RECAP_SCHEMA;
  scheduleId: string;
  blockId: string;
  title: string;
  date: string;
  headline: string;
  matches: Array<{ matchId: string; map: string; opponent: string; score: string | null; result: 'W' | 'L' | 'D' | null }>;
  wentWell: string[];
  workOn: string[];
  players: Array<{ player: string; agents: string[]; line: string }>;
  findings: string[];
  /** Findings on this session the coach has not accepted or dismissed yet. */
  findingsToTriage: number;
  tasks: Array<{ id: string; title: string; owners: string[]; state: CoachingAction['state']; roundNo: number | null; map: string | null; open: boolean }>;
  notes: Array<{ reviewTitle: string; timeLabel: string; roundNo: number | null; text: string; drawing: boolean }>;
  evidence: { health: PracticeBlockSummary['coverage']['evidenceHealth']; acceptedMatches: number; matches: number; knownRounds: number; rounds: number };
  sharedAt: string | null;
}

const OPEN_STATES: ReadonlySet<CoachingAction['state']> = new Set(['planned', 'assigned', 'acknowledged', 'in-progress', 'review-next-block']);
const percent = (wins: number, samples: number) => Math.round(wins / samples * 100);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function matchScore(match: Match) {
  if (typeof match.ourScore === 'number' && typeof match.theirScore === 'number') return { ours: match.ourScore, theirs: match.theirScore };
  if ([match.attW, match.attL, match.defW, match.defL].every(value => typeof value === 'number')) return { ours: Number(match.attW) + Number(match.defW), theirs: Number(match.attL) + Number(match.defL) };
  return null;
}

/** Strengths and things to work on, each with the numbers that back it. */
export function recapJudgments(summary: PracticeBlockSummary, minimumSamples = DEFAULT_MINIMUM_METRIC_SAMPLES) {
  const wentWell: string[] = []; const workOn: string[] = [];
  const { pistols, firstThree, firstKills, firstDeaths, recoveriesAfterFirstDeath, firstDeathSamples } = summary.openings;
  const pistolWins = pistols.ATT.wins + pistols.DEF.wins; const pistolSamples = pistols.ATT.samples + pistols.DEF.samples;
  if (pistolSamples >= MIN_PISTOLS) {
    const line = `Pistols: won ${pistolWins} of ${pistolSamples}.`;
    if (percent(pistolWins, pistolSamples) >= 60) wentWell.push(line); else if (percent(pistolWins, pistolSamples) <= 40) workOn.push(line);
  }
  for (const side of ['ATT', 'DEF'] as const) {
    const opening = firstThree[side];
    if (opening.samples < Math.min(minimumSamples, 6)) continue;
    const line = `First three rounds on ${side === 'ATT' ? 'attack' : 'defense'}: won ${opening.wins} of ${opening.samples}.`;
    if (percent(opening.wins, opening.samples) >= 60) wentWell.push(line); else if (percent(opening.wins, opening.samples) <= 40) workOn.push(line);
  }
  if (firstKills !== null && firstDeaths !== null && firstKills + firstDeaths >= minimumSamples) {
    if (firstKills - firstDeaths >= 3) wentWell.push(`Opening duels: ${firstKills} first kills to ${firstDeaths} first deaths.`);
    else if (firstDeaths - firstKills >= 3) workOn.push(`Opening duels: ${firstDeaths} first deaths to ${firstKills} first kills.`);
  }
  if (recoveriesAfterFirstDeath !== null && firstDeathSamples >= 5) {
    const line = `After losing the first player: won ${recoveriesAfterFirstDeath} of ${firstDeathSamples}.`;
    if (percent(recoveriesAfterFirstDeath, firstDeathSamples) >= 40) wentWell.push(line); else if (percent(recoveriesAfterFirstDeath, firstDeathSamples) <= 20) workOn.push(line);
  }
  const { converted, lost } = summary.advantages;
  if (converted + lost >= 5) {
    const line = `Player advantages: closed out ${converted} of ${converted + lost}.`;
    if (percent(converted, converted + lost) >= 75) wentWell.push(line); else if (percent(converted, converted + lost) <= 55) workOn.push(line);
  }
  const economy = summary.economy;
  if (economy.fullBuyRounds >= 5 && percent(economy.fullBuyLosses, economy.fullBuyRounds) >= 50) workOn.push(`Full buys: lost ${economy.fullBuyLosses} of ${economy.fullBuyRounds}.`);
  if (economy.antiEcoRounds >= 2 && economy.antiEcoLosses >= 2) workOn.push(`Against their eco: lost ${economy.antiEcoLosses} of ${economy.antiEcoRounds}.`);
  else if (economy.antiEcoRounds >= 3 && economy.antiEcoLosses === 0) wentWell.push(`Against their eco: won all ${economy.antiEcoRounds}.`);
  if (economy.lowBuyWins >= 2) wentWell.push(`Won ${economy.lowBuyWins} of ${economy.lowBuyRounds} eco, half or force buys.`);
  return { wentWell, workOn };
}

/** The summary for a practice session, or null when the session has no linked, accepted match yet. */
export function buildPracticeRecap(data: RecapData, scheduleId: string, now = new Date().toISOString()): PracticeRecap | null {
  const session = (data.schedule || []).find(item => item.id === scheduleId);
  const block = session?.practiceBlockId ? (data.practiceBlocks || []).find(item => item.id === session.practiceBlockId) : null;
  if (!session || !block) return null;
  const summary = buildPracticeBlockSummary(data, block, now);
  if (!summary.coverage.acceptedMatches) return null;
  const blockMatchIds = new Set(block.matchIds);
  const names = new Map((data.rosterPlayers || []).map(player => [player.id, player.displayName]));
  const matches = (data.matches || []).filter(match => blockMatchIds.has(match.id) && match.duplicateReview?.status !== 'quarantined')
    .sort((a, b) => String(a.sourceMetadata?.capturedAt || a.date).localeCompare(String(b.sourceMetadata?.capturedAt || b.date)))
    .map(match => {
      const score = matchScore(match);
      return { matchId: match.id, map: match.map || 'Unknown map', opponent: match.opponent || 'Unknown opponent', score: score ? `${score.ours}–${score.theirs}` : null, result: !score ? null : score.ours > score.theirs ? 'W' as const : score.ours < score.theirs ? 'L' as const : 'D' as const };
    });
  const { wins, losses } = summary.header.result;
  const opponents = summary.header.opponents.join(', ') || 'unknown opponents';
  const headline = wins + losses
    ? `${wins > losses ? 'Won' : wins < losses ? 'Lost' : 'Split'} ${wins}–${losses} against ${opponents} on ${summary.header.maps.join(', ') || 'unknown maps'}.`
    : `${plural(summary.coverage.acceptedMatches, 'match')} against ${opponents}, no final score recorded.`;
  const { wentWell, workOn } = recapJudgments(summary, data.settings?.stats?.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES);
  const players = summary.roster.map(row => {
    const parts = [row.kills !== null && row.deaths !== null ? `${row.kills}/${row.deaths}/${row.assists ?? '—'}` : null, row.acs !== null ? `${row.acs} ACS` : null, row.fk !== null && row.fd !== null ? `${row.fk} FK · ${row.fd} FD` : null].filter(Boolean);
    return { player: (row.playerId && names.get(row.playerId)) || row.player, agents: row.agents, line: parts.join(' · ') || 'No stats recorded' };
  });
  const blockSignals = (data.coachingSignals || []).filter(signal => signal.blockId === block.id);
  const findings = blockSignals.filter(signal => signal.status === 'accepted' || signal.status === 'converted-to-action').map(signal => signal.title);
  const signalIds = new Set(blockSignals.map(signal => signal.id));
  const tasks = (data.coachingActions || [])
    .filter(action => action.state !== 'cancelled' && ((action.sourceRound && blockMatchIds.has(action.sourceRound.matchId)) || signalIds.has(action.sourceSignalId)))
    .sort((a, b) => Number(OPEN_STATES.has(b.state)) - Number(OPEN_STATES.has(a.state)) || a.createdAt.localeCompare(b.createdAt))
    .map(action => ({ id: action.id, title: action.title, owners: action.ownerIds.map(id => names.get(id) || 'Former player'), state: action.state, roundNo: action.sourceRound?.roundNo ?? null, map: action.sourceRound?.map || null, open: OPEN_STATES.has(action.state) }));
  const notes = (data.vodReviews || []).filter(review => review.matchId && blockMatchIds.has(review.matchId))
    .flatMap(review => (review.notes || []).map(note => ({ reviewTitle: review.title, timeLabel: note.timeLabel, roundNo: typeof note.roundNo === 'number' ? note.roundNo : null, text: note.text, drawing: !!note.drawing, seconds: note.seconds })))
    .sort((a, b) => a.reviewTitle.localeCompare(b.reviewTitle) || a.seconds - b.seconds)
    .map(({ seconds: _seconds, ...note }) => note);
  return {
    schema: RECAP_SCHEMA, scheduleId: session.id, blockId: block.id, title: session.primary || block.name, date: session.date, headline,
    matches, wentWell, workOn, players, findings, findingsToTriage: blockSignals.filter(signal => signal.status === 'new' || signal.status === 'reviewing' || signal.status === 'needs-evidence').length, tasks, notes,
    evidence: { health: summary.coverage.evidenceHealth, acceptedMatches: summary.coverage.acceptedMatches, matches: summary.coverage.matches, knownRounds: summary.coverage.knownRounds, rounds: summary.coverage.rounds },
    sharedAt: session.summarySharedAt || null,
  };
}

/** Plain text for pasting into the team chat. Notes stay out: they are the coach's working notes. */
export function recapText(recap: PracticeRecap) {
  const lines = [`Practice summary · ${recap.title} · ${recap.date}`, recap.headline, ''];
  for (const match of recap.matches) lines.push(`• ${match.map} vs ${match.opponent}: ${match.score ? `${match.result} ${match.score}` : 'no score'}`);
  const section = (title: string, items: string[]) => { if (items.length) lines.push('', title, ...items.map(item => `• ${item}`)); };
  section('Went well', recap.wentWell);
  section('Work on', recap.workOn);
  section('From the review', recap.findings);
  section('Tasks before next practice', recap.tasks.filter(task => task.open).map(task => `${task.title}${task.owners.length ? ` (${task.owners.join(', ')})` : ''}${task.roundNo !== null ? ` · round ${task.roundNo}${task.map ? ` on ${task.map}` : ''}` : ''}`));
  if (recap.evidence.health !== 'complete') lines.push('', `Based on ${recap.evidence.acceptedMatches} of ${recap.evidence.matches} matches and ${recap.evidence.knownRounds} of ${recap.evidence.rounds} rounds with a known result.`);
  return lines.join('\n');
}

/** Linked sessions from the last week whose summary the coach has not sent yet. */
export function recapsToSend(data: RecapData, now = new Date()) {
  // Session dates are Cairo calendar days.
  const oldest = toCairoDateKey(new Date(now.getTime() - RECAP_INBOX_DAYS * 86_400_000).toISOString()) || '';
  const today = toCairoDateKey(now.toISOString()) || '';
  return (data.schedule || [])
    .filter((session: Schedule) => !!session.practiceBlockId && !session.summarySharedAt && session.date >= oldest && session.date <= today)
    .map(session => buildPracticeRecap(data, session.id, now.toISOString()))
    .filter((recap): recap is PracticeRecap => !!recap)
    .sort((a, b) => b.date.localeCompare(a.date));
}
