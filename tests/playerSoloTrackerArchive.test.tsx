import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlayerSoloTracker from '../src/components/PlayerSoloTracker';

const baseData: any = {
  settings: { theme: 'midnight', players: [], maps: [] }, coreMemberships: [], tryoutBatches: [], matches: [], rounds: [],
  rosterPlayers: [
    { id: 'active', displayName: 'Active', createdAt: '2026-10-14' },
    { id: 'retired', displayName: 'Retired', createdAt: '2026-10-14', retiredAt: '2026-10-15' },
  ],
  playerStats: [
    { id: 's1', matchId: 'm1', playerId: 'active', player: 'Active', kills: 10, deaths: 5 },
    { id: 's2', matchId: 'm1', playerId: 'retired', player: 'Retired', kills: 20, deaths: 5 },
  ],
};

describe('player overview archive action', () => {
  it('shows coach archive action only for active stable identities and hides retired evidence', () => {
    const html = renderToStaticMarkup(<PlayerSoloTracker data={baseData} theme={{ cardBg: '', border: '' }} role="coach" onSyncSoloQ={async () => null} onRefresh={async () => {}} />);
    expect(html).toContain('Archive player');
    expect(html).toContain('Active');
    expect(html).not.toContain('Retired');
  });

  it('does not expose roster mutation to players', () => {
    const html = renderToStaticMarkup(<PlayerSoloTracker data={baseData} theme={{ cardBg: '', border: '' }} role="player" onSyncSoloQ={async () => null} onRefresh={async () => {}} />);
    expect(html).not.toContain('Archive player');
  });
});
