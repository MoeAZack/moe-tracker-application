import { describe, expect, it } from 'vitest';
import { agentPortraitDistance, chooseAgentMatch } from '../lib/localAgentClassifier';

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
});
