import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AnalyticsScopeControl from '../src/components/AnalyticsScopeControl';
import WebsiteMapSummary from '../src/components/WebsiteMapSummary';
import { DEFAULT_ANALYTICS_MAP_SCOPE, filterActiveMapPool, projectAnalyticsMapScope } from '../src/utils/activeMapPool';

const sourceFixture = () => ({
  settings: { maps: [' Ascent ', 'ASCENT', 'Lotus'], inactiveMaps: ['lotus', ' Pearl ', 'PEARL'] },
  matches: [
    { id: 'a', map: ' ascent ' }, { id: 'l', map: 'LOTUS' }, { id: 'p', map: 'Pearl' },
    { id: 'u', map: 'Practice Lab' }, { id: 'blank', map: ' ' },
  ],
  playerStats: ['a', 'l', 'p', 'u', 'blank'].map(matchId => ({ id: `ps-${matchId}`, matchId })),
  rounds: ['a', 'l', 'p', 'u'].map(matchId => ({ id: `r-${matchId}`, matchId })),
  vetos: ['a', 'l', 'p'].map(matchId => ({ id: `v-${matchId}`, matchId })),
  strats: [{ id: 'as', map: 'ASCENT' }, { id: 'ls', map: 'Lotus' }, { id: 'ps', map: 'Pearl' }],
  stratRuns: [{ id: 'sa', map: 'Ascent', matchId: 'a' }, { id: 'sl', map: 'Lotus', matchId: 'l' }, { id: 'library', map: 'ASCENT', matchId: '' }],
  vodReviews: [{ id: 'wa', matchId: 'a' }, { id: 'wl', matchId: 'l' }, { id: 'unlinked' }],
  lineups: [{ id: 'ala', map: 'Ascent' }, { id: 'all', map: 'Lotus' }, { id: 'pl', map: 'Pearl' }],
}) as any;

describe('optional analytics map scope projection', () => {
  it('defaults to all recorded/practice maps and publishes a canonical map universe', () => {
    const source = sourceFixture();
    const projected = projectAnalyticsMapScope(source);
    expect(DEFAULT_ANALYTICS_MAP_SCOPE).toBe('all');
    expect(projected.context).toMatchObject({ scope: 'all', sourceMatchCount: 5, includedMatchCount: 5, excludedMatchCount: 0 });
    expect(projected.data.matches.map((row: any) => row.id)).toEqual(['a', 'l', 'p', 'u', 'blank']);
    expect(projected.data.settings.maps).toEqual(['Ascent', 'Lotus', 'Pearl', 'Practice Lab', 'Unknown map']);
    expect(projected.data.matches.map((row: any) => row.map)).toEqual(['Ascent', 'Lotus', 'Pearl', 'Practice Lab', 'Unknown map']);
    expect(projected.data).not.toBe(source);
    expect(source.settings.maps).toEqual([' Ascent ', 'ASCENT', 'Lotus']);
  });

  it('uses a strict active-only sample consistently across map-bound analytics rows', () => {
    const projected = projectAnalyticsMapScope(sourceFixture(), 'active');
    expect(projected.data.settings.maps).toEqual(['Ascent', 'Lotus']);
    expect(projected.data.matches.map((row: any) => row.id)).toEqual(['a', 'l']);
    expect(projected.data.playerStats.map((row: any) => row.id)).toEqual(['ps-a', 'ps-l']);
    expect(projected.data.rounds.map((row: any) => row.id)).toEqual(['r-a', 'r-l']);
    expect(projected.data.vetos.map((row: any) => row.id)).toEqual(['v-a', 'v-l']);
    expect(projected.data.strats.map((row: any) => row.id)).toEqual(['as', 'ls']);
    expect(projected.data.stratRuns.map((row: any) => row.id)).toEqual(['sa', 'sl', 'library']);
    expect(projected.data.vodReviews.map((row: any) => row.id)).toEqual(['wa', 'wl', 'unlinked']);
    expect(projected.data.lineups.map((row: any) => row.id)).toEqual(['ala', 'all']);
    expect(projected.context).toMatchObject({
      scope: 'active', sourceMatchCount: 5, includedMatchCount: 2, excludedMatchCount: 3,
      configuredActiveMapCount: 2, unknownMatchCount: 2, contradictoryMaps: ['lotus'], emptyActivePool: false,
    });
    expect(filterActiveMapPool(sourceFixture()).matches).toHaveLength(2);
  });

  it('shows an honest empty result for an empty active pool and never mutates history', () => {
    const source = sourceFixture();
    source.settings.maps = [];
    const before = structuredClone(source);
    const projected = projectAnalyticsMapScope(source, 'active');
    expect(projected.data.matches).toEqual([]);
    expect(projected.data.playerStats).toEqual([]);
    expect(projected.data.settings.maps).toEqual([]);
    expect(projected.context).toMatchObject({ includedMatchCount: 0, excludedMatchCount: 5, emptyActivePool: true });
    expect(source).toEqual(before);
  });
});

describe('analytics scope UI and routing', () => {
  it('renders an accessible default-all choice with count and evidence context', () => {
    const context = projectAnalyticsMapScope(sourceFixture(), 'all').context;
    const html = renderToStaticMarkup(React.createElement(AnalyticsScopeControl, { scope: 'all', context, onChange: vi.fn() }));
    expect(html).toContain('<fieldset');
    expect(html).toContain('Analytics map scope');
    expect(html).toMatch(/checked="" value="all"/);
    expect(html).toContain('All recorded / practice maps');
    expect(html).toContain('Showing all 5 matches');
    expect(html).toContain('role="status"');
    expect(html).toContain('Match logs and evidence always keep every recorded map.');
  });

  it('renders rotated practice maps in All mode and removes them only after active mode is chosen', () => {
    const theme = { cardBg: '', border: '' };
    const allHtml = renderToStaticMarkup(React.createElement(WebsiteMapSummary, { data: projectAnalyticsMapScope(sourceFixture(), 'all').data, theme }));
    const activeHtml = renderToStaticMarkup(React.createElement(WebsiteMapSummary, { data: projectAnalyticsMapScope(sourceFixture(), 'active').data, theme }));
    expect(allHtml).toContain('Practice Lab');
    expect(allHtml).toContain('Pearl');
    expect(activeHtml).toContain('Ascent');
    expect(activeHtml).toContain('Lotus');
    expect(activeHtml).not.toContain('Practice Lab');
    expect(activeHtml).not.toContain('Pearl');
  });

  it('routes analytics through the projection and evidence through workspace data', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('projectAnalyticsMapScope(analyticsBaseData, analyticsMapScope)');
    for (const component of ['Dashboard', 'EconomyAnalytics', 'AITacticalHub', 'MapBestStats', 'WebsiteMapSummary', 'TeamCompositions', 'PlayerSoloTracker']) {
      expect(app).toMatch(new RegExp(`<${component}[^>]*data=\\{analyticsData\\}`));
    }
    for (const component of ['MatchLogRounds', 'ReplayWorkspace', 'VodReview', 'LineupLibrary', 'WebsiteMatchLog']) {
      expect(app).toMatch(new RegExp(`<${component}[^>]*data=\\{workspaceData(?: \\|\\| data)?\\}`));
    }
    expect(app).toMatch(/<MapBestStats[^>]*evidenceData=\{workspaceData \|\| data\}/);
    expect(app).not.toContain('activeWorkspaceData');
  });
});
