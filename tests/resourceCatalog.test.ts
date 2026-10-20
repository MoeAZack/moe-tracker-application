import { describe, expect, it } from 'vitest';
import { activeResourceNames, buildResourceCatalog, resourceAssetPath } from '../lib/resourceCatalog';
import { createSeed } from '../lib/seed';

const state = () => createSeed() as any;

describe('dynamic resource catalog', () => {
  it('propagates a newly configured map even before it has evidence', () => {
    const data = state();
    data.settings.maps.push('Summit');
    expect(activeResourceNames(data, 'map')).toContain('Summit');
    expect(buildResourceCatalog(data, 'map').find(row => row.name === 'Summit')).toMatchObject({ active: true, configured: true, observed: false });
  });

  it('keeps disabled resources historical but removes them from active analytics', () => {
    const data = state();
    data.settings.inactiveMaps = ['Bind'];
    data.matches = [{ id: 'm1', map: 'Bind' }];
    expect(activeResourceNames(data, 'map')).not.toContain('Bind');
    expect(buildResourceCatalog(data, 'map').find(row => row.name === 'Bind')).toMatchObject({ active: false, observed: true });
  });

  it('propagates custom agents case-insensitively and supports disabling them', () => {
    const data = state();
    data.settings.agents.push('New Agent');
    data.playerStats = [{ agent: 'new agent' }];
    expect(buildResourceCatalog(data, 'agent').filter(row => row.key === 'new agent')).toHaveLength(1);
    data.settings.inactiveAgents = ['NEW AGENT'];
    expect(activeResourceNames(data, 'agent')).not.toContain('New Agent');
  });

  it('includes Warden and gives every resource a deterministic local asset path', () => {
    const data = state();
    expect(activeResourceNames(data, 'weapon')).toContain('Warden');
    expect(resourceAssetPath('weapon', 'Warden')).toBe('/weapons/Warden.png');
    expect(resourceAssetPath('agent', 'KAY/O')).toBe('/agents/KAY_O.png');
  });
});
