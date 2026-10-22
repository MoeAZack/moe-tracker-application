import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createRoundTask } from '../lib/coachingWorkflow';
import { openActionsInView, roundTaskOrigin } from '../src/components/CoachWorkflow';
import RoundTaskForm, { roundTasks, roundVodSeconds } from '../src/components/RoundTaskForm';

const match = { id: 'm1', map: 'Bind', opponent: 'OpponentA' };
const task = (overrides: Partial<Parameters<typeof createRoundTask>[0]> = {}) =>
  createRoundTask({ match, roundNo: 7, roundId: 'r7', vodSeconds: 754, title: 'Hold the trade on B main', kind: 'player-feedback', ownerIds: ['p1'], priority: 'normal', visibility: 'team', ...overrides }, 'coach', '2026-10-22T15:00:00.000Z');

describe('tasks from a round', () => {
  it('records the round as evidence and carries no metric check', () => {
    expect(task()).toMatchObject({ sourceSignalId: '', sourceFingerprint: 'round:m1:7', check: null, outcome: null, state: 'assigned', evidence: { matchIds: ['m1'], roundIds: ['r7'], sourceTypes: ['coach-review'] }, sourceRound: { matchId: 'm1', roundNo: 7, roundId: 'r7', map: 'Bind', opponent: 'OpponentA', vodSeconds: 754 } });
    expect(task({ ownerIds: [], roundId: null, vodSeconds: null })).toMatchObject({ state: 'planned', evidence: { matchIds: ['m1'] }, sourceRound: { roundId: null, vodSeconds: null } });
    expect(task({ ownerIds: [], roundId: null }).evidence).not.toHaveProperty('roundIds');
    expect(() => task({ title: '   ' })).toThrow('Write what the task is.');
    expect(() => task({ roundNo: 101 })).toThrow('Choose a round');
  });

  it('shows round tasks in the coach view even though no review item is behind them', () => {
    const fromSignal = { ...task(), id: 'signal-action', sourceSignalId: 's1', sourceRound: undefined };
    const hiddenSignal = { ...task(), id: 'other-action', sourceSignalId: 's2', sourceRound: undefined };
    const fromRound = { ...task(), id: 'round-action' };
    const done = { ...task(), id: 'done', state: 'resolved' as const };
    expect(openActionsInView([fromSignal, hiddenSignal, fromRound, done], new Set(['s1']), 'coach').map(action => action.id)).toEqual(['signal-action', 'round-action']);
  });

  it('says where a task came from, with the VOD time when the round was marked', () => {
    expect(roundTaskOrigin(task())).toBe('From round 7 on Bind vs OpponentA at 12:34 in the VOD');
    expect(roundTaskOrigin(task({ vodSeconds: null }))).toBe('From round 7 on Bind vs OpponentA');
    expect(roundTaskOrigin({ ...task(), sourceRound: undefined })).toBe('');
  });

  it('finds the round’s VOD second and its existing tasks', () => {
    const data: any = { vodReviews: [{ matchId: 'm2', notes: [{ roundNo: 7, seconds: 1 }] }, { matchId: 'm1', notes: [{ roundNo: 6, seconds: 600 }, { roundNo: 7, seconds: 754 }] }] };
    expect(roundVodSeconds(data, 'm1', 7)).toBe(754);
    expect(roundVodSeconds(data, 'm1', 8)).toBeNull();
    expect(roundTasks([task(), task({ roundNo: 8 }), { ...task(), sourceRound: undefined }], 'm1', 7)).toHaveLength(1);
  });

  it('lists this round’s tasks with their players and offers active roster players only', () => {
    const data: any = { rosterPlayers: [{ id: 'p1', displayName: 'Player1' }, { id: 'p2', displayName: 'Player2', retiredAt: '2026-01-01' }], coachingActions: [task()], vodReviews: [] };
    const html = renderToStaticMarkup(React.createElement(RoundTaskForm, { data, matchId: 'm1', roundNo: 7, onCreated: () => {} }));
    expect(html).toContain('Tasks from this round (1)');
    expect(html).toContain('Hold the trade on B main');
    expect(html).toContain('Player1 · Assigned');
    expect(html).not.toContain('Player2');
    expect(html).toContain('aria-label="Task from round 7"');
  });
});
