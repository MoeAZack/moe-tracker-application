import { describe, expect, it } from 'vitest';
import { buildMapRoundIntelligence } from '../lib/mapRoundAnalytics';

describe('map round intelligence', () => {
  it('derives opening conversions and economy upsets without treating unknowns as losses', () => {
    const matches = [{ id: 'm1', map: 'Ascent', opponent: 'Team B', date: '2026-10-14' }];
    const source = [
      [1, 'W', 'Eco', 'Eco'], [2, 'W', 'Low', 'Eco'], [3, 'L', 'Half', 'Full'],
      [4, 'W', 'Low', 'Full'], [5, 'L', 'Full', 'Low'], [6, 'W', 'Full', 'Full'],
      [13, 'L', 'Eco', 'Eco'], [14, 'W', '', ''], [15, 'L', 'Full', 'Eco'],
    ];
    const rounds = source.map(([roundNo, result, buy, enemyBuy]) => ({ id: `r${roundNo}`, matchId: 'm1', roundNo, side: Number(roundNo) < 13 ? 'Attack' : 'Defense', result, buy, enemyBuy, ...(roundNo === 5 ? { isThrow: 'TRUE' } : {}) }));
    const row = buildMapRoundIntelligence(matches as any, rounds as any)[0];
    expect(row).toMatchObject({
      map: 'Ascent', matches: 1, coveredRounds: 9,
      openingRounds: [{ won: 1, total: 2 }, { won: 2, total: 2 }, { won: 0, total: 2 }],
      openingThree: { won: 3, total: 6 }, pistol: { won: 1, total: 2 },
      postPistol: { won: 1, total: 1 }, earnedBonus: { won: 0, total: 1 },
      lowBuy: { won: 2, total: 2 }, lowBuyBySide: { attack: { won: 2, total: 2 }, defense: { won: 0, total: 0 } },
      fullBuyLosses: { lost: 2, total: 3 }, antiEcoLosses: { lost: 2, total: 2 }, confirmedAntiEcoThrows: 1,
      latestOpening: { firstHalf: 'W–W–L', secondHalf: 'L–W–L' },
    });
  });

  it('falls back to confirmed screenshot loadouts and ignores unconfirmed evidence', () => {
    const matches = [{ id: 'm1', map: 'Lotus', opponent: '', date: '2026-10-14' }];
    const evidence = (reviewStatus: string, ours: number, theirs: number) => ({ schemaVersion: 1, reviewStatus, confidence: 'confirmed', players: [], ourAverageLoadout: ours, enemyAverageLoadout: theirs });
    const rounds = [
      { id: 'r4', matchId: 'm1', roundNo: 4, side: 'Attack', result: 'W', screenshotEvidence: evidence('confirmed', 1800, 4100) },
      { id: 'r5', matchId: 'm1', roundNo: 5, side: 'Attack', result: 'L', screenshotEvidence: evidence('confirmed', 4200, 1800) },
      { id: 'r6', matchId: 'm1', roundNo: 6, side: 'Attack', result: 'L', screenshotEvidence: evidence('review-required', 4200, 1800) },
    ];
    expect(buildMapRoundIntelligence(matches as any, rounds as any)[0]).toMatchObject({
      lowBuy: { won: 1, total: 1 }, fullBuyLosses: { lost: 1, total: 1 }, antiEcoLosses: { lost: 1, total: 1 },
    });
  });
});
