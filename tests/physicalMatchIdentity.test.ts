import { describe, expect, it } from 'vitest';
import { auditPhysicalMatchDuplicates, findPhysicalMatchCandidates, physicalMatchIdentity } from '../lib/physicalMatchIdentity';

const match = { id: 'm1', date: '2026-10-20', map: 'Ascent', opponent: 'PYO', ourScore: 13, theirScore: 8 } as any;
const stats = (matchId: string) => Array.from({ length: 5 }, (_, index) => ({ id: `${matchId}-${index}`, matchId, playerId: `p${index + 1}`, player: `P${index + 1}` })) as any;

describe('physical match identity', () => {
  it('matches cross-source records independent of roster order and spelling case', () => {
    const left = physicalMatchIdentity(match, stats('m1'))!;
    const right = physicalMatchIdentity({ ...match, map: 'ASCENT', opponent: 'pyo' }, [...stats('m2')].reverse())!;
    expect(right.fingerprint).toBe(left.fingerprint);
  });

  it('fails closed when score, map, opponent, date, or five identities are unavailable', () => {
    expect(physicalMatchIdentity({ ...match, ourScore: null }, stats('m1'))).toBeNull();
    expect(physicalMatchIdentity({ ...match, map: 'Unknown map' }, stats('m1'))).toBeNull();
    expect(physicalMatchIdentity(match, stats('m1').slice(0, 4))).toBeNull();
  });

  it('finds and audits duplicate physical matches', () => {
    const data: any = { matches: [match, { ...match, id: 'm2', source: 'vod-submission' }], playerStats: [...stats('m1'), ...stats('m2')] };
    expect(findPhysicalMatchCandidates(data, match, stats('incoming'))).toHaveLength(2);
    expect(auditPhysicalMatchDuplicates(data)).toEqual([expect.objectContaining({ matchIds: ['m1', 'm2'] })]);
  });
});

