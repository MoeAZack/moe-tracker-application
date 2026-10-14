import { describe, expect, it } from 'vitest';
import { addSurvivalEvidence, captureConsistencyIssues, enrichScreenshotEvents } from '../lib/screenshotEvidence';

describe('screenshot evidence enrichment', () => {
  it('attaches row details and derives a five-second trade', () => {
    const events = enrichScreenshotEvents([
      { sequence: 1, sourceRow: 0, killerPlayerId: 'enemy', victimPlayerId: 'ours-1', killerTeam: 'theirs', victimTeam: 'ours' },
      { sequence: 2, sourceRow: 2, killerPlayerId: 'ours-2', victimPlayerId: 'enemy', killerTeam: 'ours', victimTeam: 'theirs' },
    ], [
      { sourceRow: 0, occurredAtSeconds: 40, distanceMeters: 44 },
      { sourceRow: 2, occurredAtSeconds: 44, distanceMeters: 8 },
    ]);
    expect(events[0]).toMatchObject({ occurredAtSeconds: 40, distanceMeters: 44, tradedWithinSeconds: 4 });
    expect(events[1]).toMatchObject({ occurredAtSeconds: 44, distanceMeters: 8, tradedWithinSeconds: null });
  });

  it('marks survival only when the event list is complete', () => {
    const players = [{ playerId: 'ours-1', displayName: 'One', team: 'ours' as const }, { playerId: 'ours-2', displayName: 'Two', team: 'ours' as const }];
    const events = [{ sequence: 1, victimPlayerId: 'ours-1' }];
    expect(addSurvivalEvidence(players, events, true)).toEqual([
      expect.objectContaining({ survived: false }), expect.objectContaining({ survived: true }),
    ]);
    expect(addSurvivalEvidence(players, events, false).every(player => player.survived === null)).toBe(true);
  });

  it('flags score and implausible scoreboard-total mismatches', () => {
    expect(captureConsistencyIssues({
      ourScore: 2, theirScore: 1,
      rounds: [{ result: 'W' }, { result: 'L' }, { result: 'L' }],
      players: Array.from({ length: 10 }, (_, index) => ({ kills: index ? 1 : 20, deaths: 1 })),
    })).toHaveLength(2);
  });
});
