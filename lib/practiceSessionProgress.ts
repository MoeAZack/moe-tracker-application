import type { Match, Schedule, TrackerData } from '../src/types';
import { buildPracticeBlockSummary } from './coachingWorkflow';
import { savePracticeBlock } from './practiceBlocks';
import { toCairoDateKey } from './coachAnalytics';

const normalized = (value: unknown) => String(value || '').trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();

export function suggestedMatchesForSession(session: Pick<Schedule, 'date' | 'primary' | 'secondary'>, matches: readonly Match[]) {
  const sessionText = normalized(`${session.primary} ${session.secondary || ''}`);
  return matches.filter(match => toCairoDateKey(match.date) === session.date).sort((left, right) => {
    const score = (match: Match) => sessionText.includes(normalized(match.opponent)) ? 2 : sessionText.includes(normalized(match.map)) ? 1 : 0;
    return score(right) - score(left) || left.id.localeCompare(right.id);
  });
}

export function linkPracticeSession(db: any, input: { scheduleId: string; matchIds: string[]; goalIds?: string[]; name?: string }, actor: string, now = new Date().toISOString()) {
  const session = (db.schedule || []).find((item: any) => item.id === input.scheduleId);
  if (!session) throw Object.assign(new Error('Practice session was not found.'), { status: 404 });
  const matchIds = [...new Set(input.matchIds || [])];
  if (!matchIds.length) throw Object.assign(new Error('Choose at least one recorded match for this practice session.'), { status: 400 });
  const goalIds = [...new Set(input.goalIds || [])];
  const knownGoals = new Set((db.goals || []).map((goal: any) => goal.id));
  if (goalIds.some(id => !knownGoals.has(id))) throw Object.assign(new Error('Practice session contains an unknown goal.'), { status: 400 });
  const block = savePracticeBlock(db, { ...(session.practiceBlockId ? { id: session.practiceBlockId } : {}), name: input.name?.trim() || session.primary || `Practice · ${session.date}`, matchIds }, actor, now);
  Object.assign(session, { practiceBlockId: block.id, linkedGoalIds: goalIds, progressLinkedAt: now, progressLinkedBy: actor });
  return { session, block, progress: practiceSessionProgress(db, session.id, now) };
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
