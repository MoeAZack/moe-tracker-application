import { describe, expect, it } from 'vitest';
import { parseLocalHeadToHeadRecognitions, parseLocalPerformanceRecognitions } from '../lib/localPerformanceOcrEngine';

describe('local performance screenshot extraction', () => {
  it('reads performance score and supported accolades', () => {
    expect(parseLocalPerformanceRecognitions([
      { regionId: 'performance.score', text: '225', confidence: 96 },
      { regionId: 'performance.accolades', text: 'HEADSHOTS: 48%\nFIRST BLOODS: 6', confidence: 90 },
    ])).toMatchObject({ performanceScore: 225, hs: 48, firstBloods: 6 });
  });
  it('sums all five head-to-head rows for safe scoreboard-owner matching', () => {
    const result = parseLocalHeadToHeadRecognitions(Array.from({ length: 5 }, (_, row) => [
      { regionId: `h2h.${row}.kills`, text: String([6, 5, 5, 4, 2][row]), confidence: 90 },
      { regionId: `h2h.${row}.deaths`, text: String([8, 5, 4, 2, 7][row]), confidence: 90 },
      { regionId: `h2h.${row}.assists`, text: String([1, 1, 0, 0, 0][row]), confidence: 90 },
      { regionId: `h2h.${row}.opponent`, text: String.fromCharCode(65 + row), confidence: 90 },
    ]).flat());
    expect(result.totals).toEqual({ kills: 22, deaths: 26, assists: 2 });
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toEqual({ opponent: 'A', kills: 6, deaths: 8, assists: 1 });
  });
});
