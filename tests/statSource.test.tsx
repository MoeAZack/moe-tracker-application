import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { entrySource, matchSource, sourceMixText } from '../lib/statSource';
import SourceChip from '../src/components/SourceChip';
import MatchLogRounds from '../src/components/MatchLogRounds';

describe('stat source chips', () => {
  it('reads every recorded ingest path into one vocabulary', () => {
    expect(entrySource({ sourceMetadata: { method: 'provider-import', provider: 'vrfkit' } })).toBe('replay');
    expect(entrySource({ source: 'scrim-import', sourceMetadata: { method: 'screenshot' } })).toBe('screenshot');
    expect(entrySource({ source: 'screenshot-manual-fallback' })).toBe('screenshot');
    expect(entrySource({ sourceMetadata: { method: 'vod-submission' } })).toBe('vod');
    expect(entrySource({ source: 'live-logger' })).toBe('live');
    expect(entrySource({ source: 'manual' })).toBe('manual');
    expect(entrySource({ sourceMetadata: { method: 'provider-import', provider: 'grid' } })).toBe('import');
    expect(entrySource({})).toBe('unknown');
  });

  it('counts a typed match as replay once an accepted replay backs its player rows', () => {
    expect(matchSource({ id: 'm1', source: 'manual' }, [{ matchId: 'm1', sourceMetadata: { provider: 'vrfkit' } }])).toBe('replay');
    expect(matchSource({ id: 'm1', source: 'manual' }, [{ matchId: 'm2', sourceMetadata: { provider: 'vrfkit' } }])).toBe('manual');
  });

  it('describes the mix behind a summed table, and claims nothing for an unknown entry', () => {
    expect(sourceMixText([{ id: 'a', source: 'manual' }, { id: 'b', source: 'scrim-import' }, { id: 'c', source: 'manual' }, { id: 'd' }])).toBe('From 1 screenshot, 2 manual and 1 unrecorded-source matches.');
    expect(sourceMixText([{ id: 'a', sourceMetadata: { method: 'vod-submission' } }])).toBe('From 1 VOD match.');
    expect(renderToStaticMarkup(<SourceChip kind="unknown" />)).toBe('');
    expect(renderToStaticMarkup(<SourceChip kind="live" />)).toContain('Recorded round by round');
  });

  it('labels each Match Review entry with its source', () => {
    const data: any = { settings: { theme: 'midnight', maps: ['Haven'], stats: {}, weights: {} }, rosterPlayers: [], rounds: [], vetos: [], strats: [], stratRuns: [],
      matches: [{ id: 'm1', date: '2026-10-01', type: 'Scrim', opponent: 'Synthetic', map: 'Haven', attW: 7, attL: 5, defW: 6, defL: 4, source: 'live-logger' }], playerStats: [] };
    const noop = async () => null;
    const html = renderToStaticMarkup(<MatchLogRounds data={data} theme={{ primaryBg: 'bg', text: 'text' }} onSaveMatch={noop} onRemove={noop} onSaveRounds={noop} onSaveVeto={noop} />);
    expect(html).toContain('<span class="sr-only">Source: </span>Live');
  });
});
