import { describe, expect, it } from 'vitest';
import { createValorantRoundSummaryProfile } from '../lib/localOcrEngine';
import { parseLocalRoundRecognitions } from '../lib/localRoundOcrEngine';

describe('local round screenshot extraction contract', () => {
  it('uses calibrated text and numeric regions for a native 16:9 capture', () => {
    const profile = createValorantRoundSummaryProfile(1920, 1080);
    expect(profile.regions).toHaveLength(10); expect(profile.regions.filter(region => region.layout === 'block')).toHaveLength(9);
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
      { regionId: 'players.economy', text: Array(20).fill('800').join('\n'), confidence: 86 },
      { regionId: 'players.equipment', text: Array.from({ length: 20 }, (_, i) => i % 2 ? 'None' : 'Classic').join('\n'), confidence: 87 },
    ]);
    expect(draft).toMatchObject({ result: 'L', issues: [], evidence: { reviewStatus: 'review-required', confidence: 'high' } });
    expect(draft.evidence.players[0]).toMatchObject({ displayName: 'Player 1', team: 'ours', equippedWeapon: 'Classic', armor: 'None' });
    expect(draft.evidence.players).toHaveLength(10);
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
      { regionId: 'players.economy', text: Array.from({ length: 20 }, (_, i) => i % 2 ? '$1,200' : '$4,300').join('\n'), confidence: 90 },
      { regionId: 'players.equipment', text: Array.from({ length: 20 }, (_, i) => i % 2 ? 'Heavy Armor' : 'Vandal').join('\n'), confidence: 90 },
    ]);
    expect(draft.evidence).toMatchObject({ ourAverageLoadout: 4100, enemyAverageLoadout: 2900, ourAverageBank: 1250, enemyAverageBank: 8000 });
    expect(draft.evidence.players[0]).toMatchObject({ loadoutValue: 4300, bank: 1200 });
  });
});
