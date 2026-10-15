import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AccessControl, { buildAccessGrantPayload } from '../src/components/AccessControl';

describe('Google access roster binding', () => {
  it('renders an active stable roster selector and excludes retired identities', () => {
    const html = renderToStaticMarkup(<AccessControl theme={{ border: '', cardBg: '' }} rosterPlayers={[
      { id: '00000000-0000-4000-8000-000000000001', displayName: 'Active player' },
      { id: '00000000-0000-4000-8000-000000000002', displayName: 'Retired player', retiredAt: '2026-10-15T00:00:00Z' }
    ]} />);
    expect(html).toContain('aria-label="Roster identity"');
    expect(html).toContain('value="00000000-0000-4000-8000-000000000001"');
    expect(html).toContain('Active player');
    expect(html).not.toContain('Retired player');
  });

  it('submits the stable player ID only for player grants and preserves coach grants', () => {
    expect(buildAccessGrantPayload(' player@example.com ', 'player', '00000000-0000-4000-8000-000000000001')).toEqual({
      email: 'player@example.com', role: 'player', playerId: '00000000-0000-4000-8000-000000000001'
    });
    expect(buildAccessGrantPayload(' coach@example.com ', 'coach', '')).toEqual({ email: 'coach@example.com', role: 'coach' });
  });
});
