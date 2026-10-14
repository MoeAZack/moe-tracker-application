import { describe, expect, it } from 'vitest';
import { chooseWeaponMatch } from '../lib/localWeaponClassifier';

describe('local weapon classifier acceptance gate', () => {
  it('accepts only a strong and separated silhouette match', () => {
    expect(chooseWeaponMatch([{ name: 'Vandal', score: .12 }, { name: 'Phantom', score: .18 }])).toBe('Vandal');
    expect(chooseWeaponMatch([{ name: 'Vandal', score: .12 }, { name: 'Phantom', score: .13 }])).toBeNull();
    expect(chooseWeaponMatch([{ name: 'Vandal', score: .51 }, { name: 'Phantom', score: .6 }])).toBeNull();
  });
});
