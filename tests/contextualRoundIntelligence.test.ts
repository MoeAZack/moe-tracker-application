import { describe, expect, it } from 'vitest';
import { buildContextualRoundIntelligence } from '../lib/contextualRoundIntelligence';

describe('contextual round intelligence ledger', () => {
  it('uses one complete event feed for advantages, trades, utility and phase context', () => {
    const round: any = { id: 'r1', advantageEvidence: { source: 'vod', status: 'complete', states: [{ label: '5v3' }], roundOutcome: 'lost' }, vodEvidence: { observations: [
      { kind: 'elimination', timestampMs: 1000, killer: 'Alpha', victim: 'Enemy', killerTeam: 'ours', victimTeam: 'theirs' },
      { kind: 'elimination', timestampMs: 2000, killer: 'Enemy2', victim: 'Alpha', killerTeam: 'theirs', victimTeam: 'ours' },
      { kind: 'elimination', timestampMs: 5000, killer: 'Bravo', victim: 'Enemy2', killerTeam: 'ours', victimTeam: 'theirs' },
      { kind: 'orb-capture', timestampMs: 6000, player: 'Bravo' }, { kind: 'ultimate-use', timestampMs: 7000, player: 'Bravo' }, { kind: 'execute', timestampMs: 8000 },
    ] }, screenshotEvidence: { eventsComplete: true, events: [{ kind: 'ultimate-use', timestampMs: 7000, player: 'Bravo' }] } };
    const result = buildContextualRoundIntelligence(round);
    expect(result.advantage).toMatchObject({ status: 'complete', states: ['5v3'], outcome: 'lost' });
    expect(result.trades).toMatchObject({ status: 'complete', opportunities: 1, successful: 1, windowSeconds: 5 });
    expect(result.utility).toMatchObject({ status: 'complete', ultimateUses: 1, orbCaptures: 1 });
    expect(result.phase).toMatchObject({ status: 'complete', contexts: ['execute'] });
  });

  it('keeps unsupported dimensions unavailable instead of turning them into zero', () => {
    const result = buildContextualRoundIntelligence({ id: 'r2' } as any);
    expect(result.trades).toMatchObject({ status: 'unavailable', opportunities: null, successful: null });
    expect(result.utility).toMatchObject({ status: 'unavailable', ultimateUses: null, orbCaptures: null, timeline: [] });
    expect(result.phase.contexts).toEqual([]);
  });

  it('uses a confirmed screenshot timeline when no VOD timeline exists', () => {
    const result = buildContextualRoundIntelligence({ id: 'r3', screenshotEvidence: { eventsComplete: true, events: [{ kind: 'orb-capture', timestampMs: 4000, player: 'Alpha' }, { kind: 'ultimate-use', timestampMs: 5000, player: 'Alpha' }] } } as any);
    expect(result.utility).toMatchObject({ status: 'complete', orbCaptures: 1, ultimateUses: 1 });
    expect(result.utility.timeline.every(item => item.source === 'screenshot')).toBe(true);
  });
});
