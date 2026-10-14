import { describe, expect, it } from 'vitest';
import { createValorantRoundSummaryProfile } from '../lib/localOcrEngine';
import { parseLocalRoundRecognitions } from '../lib/localRoundOcrEngine';

describe('local round screenshot extraction contract', () => {
  it('uses calibrated text and numeric regions for a native 16:9 capture', () => {
    const profile = createValorantRoundSummaryProfile(1920, 1080);
    expect(profile.version).toBe(6); expect(profile.regions).toHaveLength(81); expect(profile.regions.filter(region => region.layout === 'block')).toHaveLength(7);
  });
  it('creates review-required evidence and reports missing columns', () => {
    const draft = parseLocalRoundRecognitions([
      { regionId: 'round.result', text: 'ROUND 1 | ELIMINATION LOSS', confidence: 92 },
      { regionId: 'averages.ourLoadout', text: '800', confidence: 90 },
      { regionId: 'averages.enemyLoadout', text: '800', confidence: 90 },
      { regionId: 'averages.ourBank', text: '800', confidence: 90 },
      { regionId: 'averages.enemyBank', text: '800', confidence: 90 },
      { regionId: 'players.names', text: Array.from({ length: 10 }, (_, i) => `Player ${i + 1}`).join('\n'), confidence: 88 },
      { regionId: 'players.kills', text: '0\n0\n0\n0\n0\n1\n0\n2\n0\n2', confidence: 91 },
      { regionId: 'players.assists', text: '0\n0\n0\n0\n0\n2\n1\n0\n1\n0', confidence: 91 },
      ...Array.from({ length: 10 }, (_, row) => ([
        { regionId: `player.${row}.loadout`, text: '800', confidence: 86 }, { regionId: `player.${row}.bank`, text: '800', confidence: 86 },
        { regionId: `player.${row}.weapon`, text: 'Classic', confidence: 87 }, { regionId: `player.${row}.armor`, text: 'None', confidence: 87 },
      ])).flat(),
      { regionId: 'event.0.timestamp', text: '0:04', confidence: 83 },
      { regionId: 'event.0.distance', text: '44m', confidence: 81 },
    ]);
    expect(draft).toMatchObject({ result: 'L', winBy: 'Elimination', displayedRoundNo: 1, issues: [], evidence: { reviewStatus: 'review-required', confidence: 'high', displayedRoundNo: 1 } });
    expect(draft.eventDetails[0]).toEqual({ sourceRow: 0, occurredAtSeconds: 4, distanceMeters: 44, objective: null });
    expect(draft.evidence.players[0]).toMatchObject({ displayName: 'Player 1', team: 'ours', equippedWeapon: 'Classic', armor: 'None' });
    expect(draft.evidence.players).toHaveLength(10);
  });
  it('normalizes defuse, detonation and time win reasons without guessing unknown text', () => {
    expect(parseLocalRoundRecognitions([{ regionId: 'round.result', text: 'ROUND 8 | DEFUSE WIN', confidence: 90 }])).toMatchObject({ result: 'W', winBy: 'Defuse' });
    expect(parseLocalRoundRecognitions([{ regionId: 'round.result', text: 'SPIKE DETONATION LOSS', confidence: 90 }])).toMatchObject({ result: 'L', winBy: 'Spike' });
    expect(parseLocalRoundRecognitions([{ regionId: 'round.result', text: 'TIME WIN', confidence: 90 }])).toMatchObject({ result: 'W', winBy: 'Time' });
  });
  it('keeps comma-formatted loadout and bank values as single currency cells', () => {
    const draft = parseLocalRoundRecognitions([
      { regionId: 'round.result', text: 'VICTORY', confidence: 90 },
      { regionId: 'averages.ourLoadout', text: '$4,100', confidence: 90 },
      { regionId: 'averages.enemyLoadout', text: '$2,900', confidence: 90 },
      { regionId: 'averages.ourBank', text: '$1,250', confidence: 90 },
      { regionId: 'averages.enemyBank', text: '$8,000', confidence: 90 },
      { regionId: 'players.names', text: Array.from({ length: 10 }, (_, i) => `P${i}`).join('\n'), confidence: 90 },
      { regionId: 'players.kills', text: Array(10).fill('1').join('\n'), confidence: 90 },
      { regionId: 'players.assists', text: Array(10).fill('0').join('\n'), confidence: 90 },
      ...Array.from({ length: 10 }, (_, row) => ([
        { regionId: `player.${row}.loadout`, text: '$4,300', confidence: 90 }, { regionId: `player.${row}.bank`, text: '$1,200', confidence: 90 },
        { regionId: `player.${row}.weapon`, text: 'Vandal', confidence: 90 }, { regionId: `player.${row}.armor`, text: 'Heavy Armor', confidence: 90 },
      ])).flat(),
    ]);
    expect(draft.evidence).toMatchObject({ ourAverageLoadout: 4100, enemyAverageLoadout: 2900, ourAverageBank: 1250, enemyAverageBank: 8000 });
    expect(draft.evidence.players[0]).toMatchObject({ loadoutValue: 4300, bank: 1200 });
  });
});
