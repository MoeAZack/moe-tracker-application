import { describe, expect, it } from 'vitest';
import { excludeArchivedScreenshotPlayers } from '../src/components/EconomyAnalytics';

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
