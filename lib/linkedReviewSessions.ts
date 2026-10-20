import type { TrackerData } from '../src/types';
import { coachingGoalVerification } from './coachingGoalLink';

export function linkedReviewSessionOutcome(data: Pick<TrackerData, 'schedule' | 'goals' | 'coachingActions'>, scheduleId: string) {
  const session = (data.schedule || []).find(item => item.id === scheduleId); if (!session) return null;
  const companion = session.linkedReviewEventId
    ? (data.schedule || []).find(item => item.id === session.linkedReviewEventId)
    : (data.schedule || []).find(item => item.linkedReviewEventId === session.id);
  if (!companion) return null;
  const goalIds = new Set([...(session.linkedGoalIds || []), ...(companion.linkedGoalIds || [])]);
  const goals = (data.goals || []).filter(goal => goalIds.has(goal.id));
  const verified = goals.filter(goal => coachingGoalVerification(goal, data.coachingActions || [])?.outcome?.status === 'satisfied').length;
  const regressed = goals.filter(goal => coachingGoalVerification(goal, data.coachingActions || [])?.outcome?.status === 'regressed').length;
  return { session, companion, goals: goals.length, completed: goals.filter(goal => goal.status === 'Done').length, verified, regressed };
}
