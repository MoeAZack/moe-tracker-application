import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RosterManager from '../src/components/RosterManager';
import { createSeed } from '../lib/seed';

const storage = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null, setItem: () => {}, removeItem: () => {} });
const render = () => renderToStaticMarkup(<RosterManager data={{ ...createSeed(), rosterPlayers: [{ id: 'p1', displayName: 'SyntheticAce' }] } as any} theme={{ border: 'border', cardBg: 'card' } as any} onRefresh={async () => {}} />);

afterEach(() => vi.unstubAllGlobals());

describe('roster panel', () => {
  it('opens expanded, even where the old build stored its collapsed default', () => {
    vi.stubGlobal('window', { localStorage: storage({ 'moe.roster-manager.collapsed.v2': 'true' }) });
    expect(render()).toContain('aria-expanded="true"');
  });

  it('stays minimized after the coach minimizes it', () => {
    vi.stubGlobal('window', { localStorage: storage({ 'moe.roster-manager.collapsed.v3': 'true' }) });
    expect(render()).toContain('aria-expanded="false"');
  });
});
