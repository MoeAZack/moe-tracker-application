import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PlayerSoloTracker from '../src/components/PlayerSoloTracker';
import fs from 'node:fs';

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
  it('shows coach status and archive controls for active evidence and hides retired evidence', () => {
    const html = renderToStaticMarkup(<PlayerSoloTracker data={baseData} theme={{ cardBg: '', border: '' }} role="coach" onSyncSoloQ={async () => null} onRefresh={async () => {}} />);
    expect(html).toContain('Archive');
    expect(html).toContain('Core');
    expect(html).toContain('Stand-in');
    expect(html).toContain('Tryout');
    expect(html).toContain('Team record');
    expect(html).toContain('Active');
    expect(html).not.toContain('Retired');
  });

  it('includes unmatched observed names with immediate classification and archive controls', () => {
    const data = { ...baseData, rosterPlayers: [], playerStats: [{ id: 'legacy', matchId: 'm1', player: 'New Tryout', kills: 12, deaths: 9, assists: 4 }] };
    const html = renderToStaticMarkup(<PlayerSoloTracker data={data} theme={{ cardBg: '', border: '' }} role="coach" onSyncSoloQ={async () => null} onRefresh={async () => {}} />);
    expect(html).toContain('New Tryout');
    expect(html).toContain('Tryout');
    expect(html).toContain('Archive');
    expect(html).not.toContain('Resolve identity');
  });

  it('does not expose roster mutation to players', () => {
    const html = renderToStaticMarkup(<PlayerSoloTracker data={baseData} theme={{ cardBg: '', border: '' }} role="player" onSyncSoloQ={async () => null} onRefresh={async () => {}} />);
    expect(html).not.toContain('Archive');
  });

  it('presents expanded evidence as labeled metric tiles instead of dense inline strings', () => {
    const source = fs.readFileSync('src/components/PlayerSoloTracker.tsx', 'utf8');
    for (const label of ['Core combat output', 'First-duel pressure', 'First deaths', 'Round-winning actions', 'High-leverage round outcomes']) expect(source).toContain(label);
    expect(source).not.toContain("card.body.map");
  });

  it('exposes connected profiles, evidence history and reversible identity controls', () => {
    const source = fs.readFileSync('src/components/PlayerSoloTracker.tsx', 'utf8');
    for (const label of ['Connected player profile', 'Evidence-linked match history', 'Identity correction', 'Relink evidence', 'Reverse']) expect(source).toContain(label);
    expect(source).toContain('/api/roster/identity-corrections/revert');
  });

  it('exposes a collapsed metric coverage ledger that separates zero from unknown', () => {
    const source = fs.readFileSync('src/components/PlayerSoloTracker.tsx', 'utf8');
    for (const label of ['Metric availability', 'known zero remains data', 'accepted rows', 'Denominator:']) expect(source).toContain(label);
    expect(source).toContain('buildPlayerMetricCoverage(reconciledRows)');
  });
});
