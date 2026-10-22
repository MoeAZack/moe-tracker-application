import type { Match, Schedule, TrackerData } from '../src/types';
import { buildPracticeBlockSummary } from './coachingWorkflow';
import { savePracticeBlock } from './practiceBlocks';
import { toCairoDateKey } from './coachAnalytics';

const normalized = (value: unknown) => String(value || '').trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
const containsPhrase = (text: string, phrase: string) => !!phrase && ` ${text} `.includes(` ${phrase} `);

export interface PracticeMatchSuggestion {
  match: Match;
  confidence: 'confident' | 'possible';
  reasons: Array<'opponent' | 'map' | 'same-day'>;
}

export function practiceMatchSuggestions(session: Pick<Schedule, 'date' | 'primary' | 'secondary'>, matches: readonly Match[]): PracticeMatchSuggestion[] {
  const sessionText = normalized(`${session.primary} ${session.secondary || ''}`);
  const sameDay = matches.filter(match => toCairoDateKey(match.date) === session.date);
  return sameDay.map(match => {
    const opponent = normalized(match.opponent); const map = normalized(match.map);
    const opponentMatch = containsPhrase(sessionText, opponent); const mapMatch = containsPhrase(sessionText, map);
    const reasons: PracticeMatchSuggestion['reasons'] = ['same-day'];
    if (opponentMatch) reasons.unshift('opponent');
    if (mapMatch) reasons.splice(opponentMatch ? 1 : 0, 0, 'map');
    return { match, confidence: opponentMatch || (mapMatch && sameDay.length === 1) ? 'confident' as const : 'possible' as const, reasons };
  }).sort((left, right) => Number(right.confidence === 'confident') - Number(left.confidence === 'confident')
    || Number(right.reasons.includes('opponent')) - Number(left.reasons.includes('opponent'))
    || Number(right.reasons.includes('map')) - Number(left.reasons.includes('map'))
    || left.match.id.localeCompare(right.match.id));
}

export function suggestedMatchesForSession(session: Pick<Schedule, 'date' | 'primary' | 'secondary'>, matches: readonly Match[]) {
  return practiceMatchSuggestions(session, matches).map(item => item.match);
}

export function confidentMatchesForSession(session: Pick<Schedule, 'date' | 'primary' | 'secondary'>, matches: readonly Match[]) {
  return practiceMatchSuggestions(session, matches).filter(item => item.confidence === 'confident').map(item => item.match);
}

/** `progressView` lets the server read progress through its screenshot-metric publication gate. */
export function linkPracticeSession(db: any, input: { scheduleId: string; matchIds: string[]; goalIds?: string[]; name?: string }, actor: string, now = new Date().toISOString(), progressView: (data: any) => any = data => data) {
  const session = (db.schedule || []).find((item: any) => item.id === input.scheduleId);
  if (!session) throw Object.assign(new Error('Practice session was not found.'), { status: 404 });
  const matchIds = [...new Set(input.matchIds || [])];
  if (!matchIds.length) throw Object.assign(new Error('Choose at least one recorded match for this practice session.'), { status: 400 });
  const goalIds = [...new Set(input.goalIds || [])];
  const knownGoals = new Set((db.goals || []).map((goal: any) => goal.id));
  if (goalIds.some(id => !knownGoals.has(id))) throw Object.assign(new Error('Practice session contains an unknown goal.'), { status: 400 });
  const block = savePracticeBlock(db, { ...(session.practiceBlockId ? { id: session.practiceBlockId } : {}), name: input.name?.trim() || session.primary || `Practice · ${session.date}`, matchIds }, actor, now);
  Object.assign(session, { practiceBlockId: block.id, linkedGoalIds: goalIds, progressLinkedAt: now, progressLinkedBy: actor });
  return { session, block, progress: practiceSessionProgress(progressView(db), session.id, now) };
}

/**
 * Link an automatically saved match to the PRACC session it was played in.
 * The first map links only when it is the session's single confident match;
 * later maps join a block this function started. A coach-made link is never
 * changed, and a quarantined duplicate never links.
 */
export function autoLinkPracticeSession(db: any, matchId: string, actor: string, now = new Date().toISOString()) {
  const match = (db.matches || []).find((item: any) => item.id === matchId);
  const scheduleId = match?.automation?.praccScheduleId;
  if (!scheduleId || match.duplicateReview?.status === 'quarantined') return null;
  const session = (db.schedule || []).find((item: any) => item.id === scheduleId && item.source === 'pracc');
  if (!session) return null;
  const confident = confidentMatchesForSession(session, (db.matches || []).filter((item: any) => item.duplicateReview?.status !== 'quarantined'));
  if (!confident.some(item => item.id === matchId)) return null;
  let matchIds: string[];
  if (!session.practiceBlockId) {
    if (confident.length !== 1) return null;
    matchIds = [matchId];
  } else {
    if (!session.progressLinkedAutomatically) return null;
    const block = (db.practiceBlocks || []).find((item: any) => item.id === session.practiceBlockId);
    if (!block || block.matchIds.includes(matchId)) return null;
    matchIds = [...block.matchIds, matchId];
  }
  if ((db.practiceBlocks || []).some((block: any) => block.id !== session.practiceBlockId && block.matchIds?.includes(matchId))) return null;
  // Linking is a convenience on top of a save that already succeeded; it never fails that save.
  try {
    const result = linkPracticeSession(db, { scheduleId, matchIds, goalIds: session.linkedGoalIds || [] }, actor, now);
    session.progressLinkedAutomatically = true;
    return result;
  } catch { return null; }
}

export function practiceSessionProgress(data: Pick<TrackerData, 'schedule' | 'practiceBlocks' | 'matches' | 'playerStats' | 'rounds' | 'rosterPlayers' | 'settings' | 'goals' | 'coachingSignals'>, scheduleId: string, now = new Date().toISOString()) {
  const session = (data.schedule || []).find(item => item.id === scheduleId);
  if (!session) return null;
  const block = (data.practiceBlocks || []).find(item => item.id === session.practiceBlockId);
  if (!block) return { scheduleId, linked: false as const, suggestedMatchIds: suggestedMatchesForSession(session, data.matches || []).map(match => match.id) };
  const summary = buildPracticeBlockSummary(data, block, now);
  const goals = (data.goals || []).filter(goal => (session.linkedGoalIds || []).includes(goal.id));
  const checkIns = session.attendanceCheckIns || [];
  const findings = (data.coachingSignals || []).filter(signal => signal.blockId === block.id);
  return { scheduleId, linked: true as const, blockId: block.id, matchIds: block.matchIds, goals: { total: goals.length, done: goals.filter(goal => goal.status === 'Done').length }, attendance: { assigned: session.requiredPlayerIds?.length || 0, checkedIn: checkIns.length, late: checkIns.filter(item => item.status === 'late').length }, findings: { total: findings.length, accepted: findings.filter(item => item.status === 'accepted' || item.status === 'converted-to-action').length }, summary };
}
