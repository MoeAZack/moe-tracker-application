import { describe, expect, it } from 'vitest';
import { attributedFirstDeaths } from '../lib/captureSessionPipeline';

const ids = ['name:a', 'name:b', 'name:c', 'name:d', 'name:e', 'name:v', 'name:w', 'name:x', 'name:y', 'name:z'];
const round = (victimPlayerId: string | null, openingEventComplete = true) => ({ screenshotEvidence: { openingEventComplete, events: [{ victimPlayerId }] } });

describe('first-death attribution from round openings', () => {
  it('counts first deaths on both teams when every opening is attributed', () => {
    const counts = attributedFirstDeaths([round('name:a'), round('name:v'), round('name:a'), round('name:z')], ids);
    expect(counts).toEqual([2, 0, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(counts!.reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it('leaves every row unknown when the first deaths fall short of the round count', () => {
    // Corpus shape: FK summed to the rounds while FD summed to about half,
    // because only our first deaths were counted and the rest became zeros.
    expect(attributedFirstDeaths([round('name:a'), round('name:unreadable'), round('name:v')], ids)).toBeNull();
    expect(attributedFirstDeaths([round('name:a'), round(null)], ids)).toBeNull();
    expect(attributedFirstDeaths([round('name:a'), round('name:v', false)], ids)).toBeNull();
    expect(attributedFirstDeaths([], ids)).toBeNull();
  });

  it('refuses an opening victim that matches two scoreboard rows', () => {
    expect(attributedFirstDeaths([round('name:a')], ['name:a', 'name:a', ...ids.slice(2)])).toBeNull();
  });
});
