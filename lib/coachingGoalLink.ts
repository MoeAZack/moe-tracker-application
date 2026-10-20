import type { CoachingAction, CoachingSignal, Goal, Match, RosterPlayer, Round } from '../src/types';

const cairoDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);

export function buildCoachingGoal(input: { signal: CoachingSignal; action: CoachingAction; matches: readonly Match[]; rounds: readonly Round[]; rosterPlayers: readonly RosterPlayer[]; now?: string }): Goal {
  const now = input.now || new Date().toISOString();
  const matchId = input.signal.evidence.matchIds[0]; const roundId = input.signal.evidence.roundIds?.[0];
  const match = input.matches.find(item => item.id === matchId); const round = input.rounds.find(item => item.id === roundId && item.matchId === matchId);
  const clip = round?.reviewCockpit?.clips?.[0]; const owner = input.action.ownerIds.length === 1 ? input.rosterPlayers.find(item => item.id === input.action.ownerIds[0]) : null;
  const target = input.action.check ? `Verify ${input.action.check.direction} to ${input.action.check.target}${input.action.check.unit || ''} in the next comparable block.` : 'Verify in the next comparable practice block.';
  return {
    id: `goal-${input.action.id}`, date: match?.date || cairoDate(new Date(now)), goal: input.action.title,
    notes: `${input.signal.explanation}\n${target}`, status: 'Open', owner: owner?.displayName || '', ownerPlayerId: owner?.id,
    matchId, roundId, evidenceClipId: clip?.id, sourceSignalId: input.signal.id, coachingActionId: input.action.id, dueBlockId: input.action.dueBlockId || undefined,
  };
}

export function coachingGoalVerification(goal: Goal, actions: readonly CoachingAction[]) {
  const action = goal.coachingActionId ? actions.find(item => item.id === goal.coachingActionId) : undefined;
  return action ? { state: action.state, outcome: action.outcome, check: action.check } : null;
}
