import { describe, expect, it } from 'vitest';
import { buildCoachingGoal, coachingGoalVerification } from '../lib/coachingGoalLink';
import { linkedReviewSessionOutcome } from '../lib/linkedReviewSessions';

describe('coaching goal evidence chain', () => {
  it('links an accepted finding to its owner, match, round and local clip', () => {
    const signal: any = { id: 'signal-1', explanation: 'Spacing failed after first contact.', evidence: { matchIds: ['m1'], roundIds: ['r4'] } };
    const action: any = { id: 'action-1', title: 'Fix trade spacing', ownerIds: ['p1'], dueBlockId: 'next', check: { direction: 'decrease', target: 20, unit: '%' } };
    const goal = buildCoachingGoal({ signal, action, matches: [{ id: 'm1', date: '2026-10-19' } as any], rounds: [{ id: 'r4', matchId: 'm1', roundNo: 4, reviewCockpit: { clips: [{ id: 'clip-4', label: 'Late trade' }] } } as any], rosterPlayers: [{ id: 'p1', displayName: 'caelia' } as any], now: '2026-10-20T10:00:00Z' });
    expect(goal).toMatchObject({ owner: 'caelia', ownerPlayerId: 'p1', matchId: 'm1', roundId: 'r4', evidenceClipId: 'clip-4', sourceSignalId: 'signal-1', coachingActionId: 'action-1', dueBlockId: 'next' });
  });

  it('projects next-block verification and combines a linked Team Talk/Debrief pair', () => {
    const goal: any = { id: 'g1', status: 'Done', coachingActionId: 'a1' }; const action: any = { id: 'a1', state: 'review-next-block', outcome: { status: 'satisfied' } };
    expect(coachingGoalVerification(goal, [action])?.outcome?.status).toBe('satisfied');
    const outcome = linkedReviewSessionOutcome({ schedule: [{ id: 'talk', calendarKey: 'team-talk', linkedReviewEventId: 'debrief', linkedGoalIds: ['g1'] }, { id: 'debrief', calendarKey: 'debrief' }] as any, goals: [goal], coachingActions: [action] }, 'talk');
    expect(outcome).toMatchObject({ goals: 1, completed: 1, verified: 1, regressed: 0, companion: { id: 'debrief' } });
  });

  it('does not combine unrelated talks and debriefs', () => {
    expect(linkedReviewSessionOutcome({ schedule: [{ id: 'talk', calendarKey: 'team-talk' }, { id: 'debrief', calendarKey: 'debrief' }] as any, goals: [], coachingActions: [] }, 'talk')).toBeNull();
  });
});
