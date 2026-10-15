import { describe, expect, it } from 'vitest';
import { excludeArchivedScreenshotPlayers } from '../src/components/EconomyAnalytics';

describe('economy archived players', () => {
  it('removes archived names from screenshot-derived player metrics without deleting match evidence', () => {
    const players = [{ identity: 'name:twitch elyystan', displayName: 'Twitch Elyystan' }, { identity: 'name:caelia', displayName: 'caelia' }];
    const roster = [{ id: 'retired', displayName: 'twitch elyystan', createdAt: '2026-10-15', retiredAt: '2026-10-15' }];
    expect(excludeArchivedScreenshotPlayers(players, roster as any).map(player => player.displayName)).toEqual(['caelia']);
  });
});
