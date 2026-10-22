import { describe, expect, it } from 'vitest';
import { liveSplitLabels } from '../src/components/LiveLogger';

describe('live logger split labels', () => {
  it('leaves split rounds that were not logged unknown instead of a loss', () => {
    expect(liveSplitLabels({}, 1, 'W')).toEqual({ pistolAtt: 'W', ecoAtt: '', bonusAtt: '', pistolDef: '', ecoDef: '', bonusDef: '' });
  });
  it('keeps earlier results and sets the split for the logged round', () => {
    const afterThree = liveSplitLabels({ pistolAtt: 'W', ecoAtt: 'L' }, 3, 'W');
    expect(afterThree).toMatchObject({ pistolAtt: 'W', ecoAtt: 'L', bonusAtt: 'W', pistolDef: '' });
    expect(liveSplitLabels(afterThree, 13, 'L')).toMatchObject({ pistolDef: 'L', ecoDef: '', bonusDef: '' });
    expect(liveSplitLabels(afterThree, 7, 'L')).toEqual(afterThree);
  });
});
