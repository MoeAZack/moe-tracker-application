import { describe, expect, it } from 'vitest';
import { agentPortraitDistance, chooseAgentMatch, chooseScoreboardAgents, rawPortraitDistance } from '../lib/localAgentClassifier';

describe('local agent portrait classification', () => {
  it('accepts a bounded unique match and rejects uncertain or distant matches', () => {
    expect(chooseAgentMatch([{ name: 'Cypher', score: 3000 }, { name: 'Gekko', score: 5600 }])).toBe('Cypher');
    expect(chooseAgentMatch([{ name: 'Sova', score: 8000 }, { name: 'Jett', score: 8800 }])).toBe('Sova');
    expect(chooseAgentMatch([{ name: 'A', score: 8000 }, { name: 'B', score: 8200 }])).toBeNull();
    expect(chooseAgentMatch([{ name: 'A', score: 10000 }, { name: 'B', score: 15000 }])).toBeNull();
  });

  it('keeps the same portrait close across a uniform brightness shift', () => {
    const pixels = new Uint8ClampedArray([20, 40, 80, 255, 80, 120, 180, 255, 200, 180, 120, 255]);
    const brighter = new Uint8ClampedArray([...pixels].map((value, index) => index % 4 === 3 ? value : Math.min(255, value + 20)));
    const different = new Uint8ClampedArray([240, 10, 10, 255, 10, 240, 10, 255, 10, 10, 240, 255]);
    expect(agentPortraitDistance(pixels, pixels)).toBe(0);
    expect(agentPortraitDistance(pixels, brighter)).toBeLessThan(agentPortraitDistance(pixels, different));
  });

  it('scores scoreboard portraits by plain colour error so a tint-shifted look-alike stays apart', () => {
    const portrait = new Uint8ClampedArray([30, 90, 160, 255, 40, 100, 170, 255, 200, 190, 80, 255]);
    const lookAlike = new Uint8ClampedArray([60, 70, 110, 255, 70, 80, 120, 255, 230, 170, 30, 255]);
    expect(rawPortraitDistance(portrait, portrait)).toBe(0);
    expect(rawPortraitDistance(portrait, lookAlike)).toBeCloseTo((30 ** 2 + 20 ** 2 + 50 ** 2) / 3, 6);
    expect(rawPortraitDistance(portrait, new Uint8ClampedArray(8))).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps the fixed portrait grid and uses the measured row offset only for rows it cannot match', () => {
    const fixed = [
      [{ name: 'Sova', score: 4400 }, { name: 'Chamber', score: 4900 }],
      [{ name: 'A', score: 8000 }, { name: 'B', score: 8100 }],
      [{ name: 'A', score: 9000 }, { name: 'B', score: 9100 }],
    ];
    const shifted = [
      [{ name: 'Chamber', score: 4000 }, { name: 'Sova', score: 5000 }],
      [{ name: 'Jett', score: 3000 }, { name: 'Neon', score: 6000 }],
      [{ name: 'A', score: 9000 }, { name: 'B', score: 9100 }],
    ];
    expect(chooseScoreboardAgents(fixed, shifted)).toEqual(['Sova', 'Jett', null]);
    expect(chooseScoreboardAgents(fixed, null)).toEqual(['Sova', null, null]);
  });
});
