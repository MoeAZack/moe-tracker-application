import { describe, expect, it } from 'vitest';
import { chooseAgentMatch, rawPortraitDistance } from '../lib/localAgentClassifier';

describe('local agent portrait classification', () => {
  it('accepts a bounded unique match and rejects uncertain or distant matches', () => {
    expect(chooseAgentMatch([{ name: 'Cypher', score: 3000 }, { name: 'Gekko', score: 5600 }])).toBe('Cypher');
    expect(chooseAgentMatch([{ name: 'Sova', score: 8000 }, { name: 'Jett', score: 8800 }])).toBe('Sova');
    expect(chooseAgentMatch([{ name: 'A', score: 8000 }, { name: 'B', score: 8200 }])).toBeNull();
    expect(chooseAgentMatch([{ name: 'A', score: 10000 }, { name: 'B', score: 15000 }])).toBeNull();
  });

  it('scores scoreboard portraits by plain colour error so a tint-shifted look-alike stays apart', () => {
    const portrait = new Uint8ClampedArray([30, 90, 160, 255, 40, 100, 170, 255, 200, 190, 80, 255]);
    const lookAlike = new Uint8ClampedArray([60, 70, 110, 255, 70, 80, 120, 255, 230, 170, 30, 255]);
    expect(rawPortraitDistance(portrait, portrait)).toBe(0);
    expect(rawPortraitDistance(portrait, lookAlike)).toBeCloseTo((30 ** 2 + 20 ** 2 + 50 ** 2) / 3, 6);
    expect(rawPortraitDistance(portrait, new Uint8ClampedArray(8))).toBe(Number.POSITIVE_INFINITY);
  });
});
