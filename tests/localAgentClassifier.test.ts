import { describe, expect, it } from 'vitest';
import { chooseAgentMatch } from '../lib/localAgentClassifier';

describe('local agent portrait classification', () => {
  it('accepts a bounded unique match and rejects uncertain or distant matches', () => {
    expect(chooseAgentMatch([{ name: 'Cypher', score: 3000 }, { name: 'Gekko', score: 5600 }])).toBe('Cypher');
    expect(chooseAgentMatch([{ name: 'Sova', score: 8000 }, { name: 'Jett', score: 8800 }])).toBe('Sova');
    expect(chooseAgentMatch([{ name: 'A', score: 8000 }, { name: 'B', score: 8200 }])).toBeNull();
    expect(chooseAgentMatch([{ name: 'A', score: 10000 }, { name: 'B', score: 15000 }])).toBeNull();
  });
});
