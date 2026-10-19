import { describe, expect, it } from 'vitest';
import { buildWeaponRoundOutcomes, buildWeaponRoundOutcomesByEconomy, excludeArchivedScreenshotPlayers } from '../src/components/EconomyAnalytics';

describe('economy archived players', () => {
  it('removes archived names from screenshot-derived player metrics without deleting match evidence', () => {
    const players = [{ identity: 'name:twitch elyystan', displayName: 'Twitch Elyystan' }, { identity: 'name:caelia', displayName: 'caelia' }];
    const roster = [{ id: 'retired', displayName: 'twitch elyystan', createdAt: '2026-10-15', retiredAt: '2026-10-15' }, { id: 'active', displayName: 'caelia', createdAt: '2026-10-15' }];
    expect(excludeArchivedScreenshotPlayers(players, roster as any).map(player => player.displayName)).toEqual(['caelia']);
  });

  it('keeps historical match participants when the active roster is empty', () => {
    const players = ['Sandra', 'dexle', 'bellatrix', 'caelia', 'majusia'].map(displayName => ({ identity: `name:${displayName.toLowerCase()}`, displayName }));
    const roster = players.map(player => ({ id: player.identity, displayName: player.displayName, createdAt: '2026-10-15', retiredAt: '2026-10-18' }));
    expect(excludeArchivedScreenshotPlayers(players, roster as any).map(player => player.displayName)).toEqual(['Sandra', 'dexle', 'bellatrix', 'caelia', 'majusia']);
  });
});

describe('economy weapon round outcomes', () => {
  it('aggregates equipped weapon observations against confirmed team round results', () => {
    const rows = buildWeaponRoundOutcomes([
      { displayName: 'Alpha', weapons: [{ weapon: 'Vandal', rounds: 8, wins: 5, kills: 10, deaths: 4 }, { weapon: 'Sheriff', rounds: 2, wins: 2, kills: 3, deaths: 0 }] },
      { displayName: 'Bravo', weapons: [{ weapon: 'Vandal', rounds: 5, wins: 4, kills: 6, deaths: 3 }] },
    ]);
    expect(rows).toEqual([
      { weapon: 'Vandal', rounds: 13, wins: 9, losses: 4, kills: 16, deaths: 7, players: 2, winRate: 69 },
      { weapon: 'Sheriff', rounds: 2, wins: 2, losses: 0, kills: 3, deaths: 0, players: 1, winRate: 100 },
    ]);
  });

  it('excludes unrecognized OCR labels and clamps impossible win totals to the observed sample', () => {
    expect(buildWeaponRoundOutcomes([{ displayName: 'Alpha', weapons: [{ weapon: 'Wardsan', rounds: 3, wins: 3, kills: 1, deaths: 1 }, { weapon: 'ghost', rounds: 2, wins: 5, kills: 2, deaths: 1 }] }])).toEqual([
      { weapon: 'Ghost', rounds: 2, wins: 2, losses: 0, kills: 2, deaths: 1, players: 1, winRate: 100 },
    ]);
  });

  it('retains every catalog weapon, including Bandit', () => {
    expect(buildWeaponRoundOutcomes([{ displayName: 'Alpha', weapons: [{ weapon: 'Bandit', rounds: 4, wins: 3, kills: 4, deaths: 2 }] }])[0]).toMatchObject({ weapon: 'Bandit', rounds: 4, wins: 3 });
  });

  it('separates weapon choices by pistol, post-pistol, bonus, mid and full-buy context', () => {
    const evidence = (weapon: string, loadout: number) => ({ reviewStatus: 'confirmed', ourAverageLoadout: loadout, players: [{ playerId: 'p1', displayName: 'Alpha', team: 'ours', equippedWeapon: weapon, survived: true }], eventsComplete: true, events: [] });
    const groups = buildWeaponRoundOutcomesByEconomy([
      { id: 'r1', matchId: 'm1', roundNo: 1, result: 'W', screenshotEvidence: evidence('Sheriff', 800) },
      { id: 'r2', matchId: 'm1', roundNo: 2, result: 'W', screenshotEvidence: evidence('Bandit', 1800) },
      { id: 'r3', matchId: 'm1', roundNo: 3, result: 'L', screenshotEvidence: evidence('Spectre', 2800) },
      { id: 'r4', matchId: 'm1', roundNo: 4, result: 'W', buy: 'Half', screenshotEvidence: evidence('Bulldog', 3700) },
      { id: 'r5', matchId: 'm1', roundNo: 5, result: 'L', buy: 'Full', screenshotEvidence: evidence('Operator', 4500) },
    ] as any);
    expect(groups.map(group => [group.id, group.outcomes[0].weapon, group.outcomes[0].wins, group.outcomes[0].losses])).toEqual([
      ['pistol', 'Sheriff', 1, 0], ['post-pistol', 'Bandit', 1, 0], ['bonus', 'Spectre', 0, 1], ['mid', 'Bulldog', 1, 0], ['full', 'Operator', 0, 1],
    ]);
  });
});
