import { describe, expect, it } from 'vitest';
import { canonicalScoreboardName, cleanCaptureDisplayName, cleanCaptureMap, inferAlliedScoreboardNames, scoreFromCompleteRounds } from '../lib/scrimCaptureImport';
import { classifyTeamEquipment } from '../lib/scrimRoundAnalytics';

describe('scrim capture team inference', () => {
  it('uses grouped round tables to select our rows from an individually sorted scoreboard', () => {
    const scoreboard = ['Yehia', 'Ahmed', 'Kiddouk', 'John Kramer', 'RAF BLACK', 'zam', 'kareem', 'cixoteg', 'GLS Block', 'rzm'].map(extractedName => ({ extractedName }));
    const rounds = [{ screenshotEvidence: { players: [
      ...['John Kramer', 'Yehia', 'GLS Block', 'RAF BLACK', 'Kiddouk 4'].map(displayName => ({ displayName, team: 'ours' as const })),
      ...['rzm', 'cixoteg', 'Ahmed', 'zam', 'kareem'].map(displayName => ({ displayName, team: 'theirs' as const })),
    ] } } as any];
    expect([...inferAlliedScoreboardNames(scoreboard, rounds)].sort()).toEqual(['glsblock', 'johnkramer', 'kiddouk', 'rafblack', 'yehia'].sort());
    expect(canonicalScoreboardName('Kiddouk 4', scoreboard)).toBe('Kiddouk');
  });
  it('cleans UI labels and reconciles a complete final score from rounds', () => {
    expect(cleanCaptureMap('MAP - ASCENT')).toBe('Ascent');
    expect(cleanCaptureDisplayName('Kiddouk 2')).toBe('Kiddouk');
    expect(scoreFromCompleteRounds([...Array(13).fill({ result: 'W' }), ...Array(9).fill({ result: 'L' })])).toEqual({ ourScore: 13, theirScore: 9 });
    expect(scoreFromCompleteRounds([{ result: '' }])).toBeNull();
  });
  it('repairs unique one or two-glyph OCR variants without merging unrelated players', () => {
    const scoreboard = ['bellatrix', 'majusia', 'PYO Sephia', 'PYO Hoshi'].map(extractedName => ({ extractedName }));
    const evidence = { players: [
      { displayName: 'bellatr1x', team: 'ours' }, { displayName: 'rmajusia', team: 'ours' },
      { displayName: 'PY0D Sephia', team: 'theirs' }, { displayName: 'PY0 Hoshi', team: 'theirs' },
    ] };
    const rounds = [{ screenshotEvidence: evidence }, { screenshotEvidence: evidence }] as any;
    expect([...inferAlliedScoreboardNames(scoreboard, rounds)]).toEqual(expect.arrayContaining(['bellatrix', 'majusia']));
    expect(canonicalScoreboardName('PY0D Sephia', scoreboard)).toBe('PYO Sephia');
  });
  it('classifies economy from the five equipped weapons when tiny credit text is uncertain', () => {
    expect(classifyTeamEquipment(['Vandal', 'Phantom', 'Bandit', 'Ghost', 'Sheriff'].map(equippedWeapon => ({ team: 'ours', equippedWeapon })), 'ours')).toBe('half');
    expect(classifyTeamEquipment(['Vandal', 'Bandit', 'Ghost', 'Sheriff', 'Classic'].map(equippedWeapon => ({ team: 'ours', equippedWeapon })), 'ours')).toBe('low');
    expect(classifyTeamEquipment(['Vandal', 'Phantom', 'Vandal', 'Bandit', 'Ghost'].map(equippedWeapon => ({ team: 'ours', equippedWeapon })), 'ours')).toBe('full');
    expect(classifyTeamEquipment(['Classic', 'Ghost', 'Sheriff', 'Ghost', 'Classic'].map(equippedWeapon => ({ team: 'ours', equippedWeapon })), 'ours')).toBe('eco');
  });

  it('treats the Warden as a full-buy rifle', () => {
    expect(classifyTeamEquipment(['Warden', 'Warden', 'Vandal', 'Ghost', 'Sheriff'].map(equippedWeapon => ({ team: 'ours', equippedWeapon })), 'ours')).toBe('full');
  });
});

