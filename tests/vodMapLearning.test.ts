import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import mapReadsModule from '../desktop/vod-map-reads.cjs';
import { editDistance, learnableTokens, loadMapReadSamples, mapHints, recordConfirmedMaps, recordMapCorrection, saveMapReadSamples, type MapReadSample } from '../src/utils/vodMapLearning';
import { saveVodGameEdit } from '../src/utils/vodGameEdit';
import VodGameCard from '../src/components/VodGameCard';

const { mapReadTokens, normalizeMapHints, resolveBoundaryMap } = mapReadsModule;
const maps = ['Ascent', 'Bind', 'Haven', 'Lotus'];

let store: Record<string, string> = {};
beforeEach(() => { store = {}; vi.stubGlobal('localStorage', { getItem: (key: string) => store[key] ?? null, setItem: (key: string, value: string) => { store[key] = value; } }); });
afterEach(() => vi.unstubAllGlobals());

describe('reading the map on an agent-select frame', () => {
  it('uses a map name the text contains, and keeps the read tokens', () => {
    expect(resolveBoundaryMap('LOCK IN  HAVEN  Defenders', maps, [])).toEqual({ map: 'Haven', mapSource: 'read', mapRead: ['lock', 'haven', 'defenders'], firedTokens: [] });
  });

  it('resolves an unreadable name through a learned read, and only when the hints agree', () => {
    expect(resolveBoundaryMap('LOCK IN HAVFN', maps, [])).toMatchObject({ map: null, mapSource: null, mapRead: ['lock', 'havfn'] });
    expect(resolveBoundaryMap('LOCK IN HAVFN', maps, [{ token: 'havfn', map: 'Haven' }])).toEqual({ map: 'Haven', mapSource: 'learned', mapRead: ['lock', 'havfn'], firedTokens: ['havfn'] });
    expect(resolveBoundaryMap('HAVFN B1ND', maps, [{ token: 'havfn', map: 'Haven' }, { token: 'b1nd', map: 'Bind' }]).map).toBeNull();
    // A hint for a map that is not in the workspace's list is ignored.
    expect(resolveBoundaryMap('LOCK IN HAVFN', ['Ascent'], [{ token: 'havfn', map: 'Haven' }]).map).toBeNull();
  });

  it('does not fire a learned hint whose token is not one of the frame\'s read tokens', () => {
    const hints = [{ token: 'havfn', map: 'Haven' }];
    expect(resolveBoundaryMap('LOCK IN XQZT', maps, hints)).toEqual({ map: null, mapSource: null, mapRead: ['lock', 'xqzt'], firedTokens: [] });
    // Only a whole token counts: "havfnx" contains the learned token but is not it.
    expect(resolveBoundaryMap('LOCK IN HAVFNX', maps, hints)).toEqual({ map: null, mapSource: null, mapRead: ['lock', 'havfnx'], firedTokens: [] });
  });

  it('keeps only well-formed hints and short tokens', () => {
    expect(normalizeMapHints([{ token: 'HAVFN', map: ' Haven ' }, { token: 'x', map: 'Bind' }, { token: 'ok ok', map: 'Bind' }, { token: 'fine', map: '' }, null])).toEqual([{ token: 'havfn', map: 'Haven' }]);
    expect(normalizeMapHints('nope')).toEqual([]);
    expect(mapReadTokens('a ab abc ' + 'x'.repeat(21))).toEqual(['abc']);
  });
});

describe('learning corrected map reads', () => {
  it('learns only tokens that look like the corrected map', () => {
    expect(editDistance('havfn', 'haven')).toBe(1);
    expect(learnableTokens(['lock', 'havfn', 'select', 'haven'], 'Haven')).toEqual(['havfn', 'haven']);
    expect(learnableTokens(['lotvs', 'lock'], 'Lotus')).toEqual(['lotvs']);
    expect(learnableTokens(['bnd', 'bind'], 'Bind')).toEqual(['bnd', 'bind']);
    expect(learnableTokens(['ascnet'], 'Bind')).toEqual([]);
  });

  it('one correction turns a read into a hint; a sighting on another map turns it off; corrections must outnumber sightings', () => {
    let samples: MapReadSample[] = [];
    const first = recordMapCorrection(samples, { source: 'm1', mapRead: ['lock', 'havfn'], map: 'Haven' });
    expect(first.learned).toEqual(['havfn']);
    samples = first.samples;
    expect(mapHints(samples)).toEqual([{ token: 'havfn', map: 'Haven' }]);
    // The same token later shows up on a game the coach kept as Bind.
    samples = recordConfirmedMaps(samples, [{ source: 'm2', mapRead: ['havfn', 'lock'], map: 'Bind' }, { source: 'm3', mapRead: ['lock'], map: 'Ascent' }]);
    expect(samples.filter(sample => sample.kind === 'kept')).toEqual([expect.objectContaining({ token: 'havfn', map: 'Bind', source: 'm2' })]);
    expect(mapHints(samples)).toEqual([]);
    samples = recordMapCorrection(samples, { source: 'm4', mapRead: ['havfn'], map: 'Haven' }).samples;
    expect(mapHints(samples)).toEqual([{ token: 'havfn', map: 'Haven' }]);
  });

  it('a wrong learned map corrected by the coach counts against the token that chose it', () => {
    let samples = recordMapCorrection([], { source: 'm1', mapRead: ['havfn'], map: 'Haven' }).samples;
    samples = recordMapCorrection(samples, { source: 'm2', mapRead: ['havfn', 'b1nd'], firedTokens: ['havfn'], map: 'Bind' }).samples;
    expect(mapHints(samples)).toEqual([{ token: 'b1nd', map: 'Bind' }]);
  });

  it('a later correction of the same game replaces the sightings that game recorded', () => {
    let samples = recordMapCorrection([], { source: 'm1', mapRead: ['havfn'], map: 'Haven' }).samples;
    samples = recordConfirmedMaps(samples, [{ source: 'm2', mapRead: ['havfn'], map: 'Bind' }]);
    expect(mapHints(samples)).toEqual([]);
    samples = recordMapCorrection(samples, { source: 'm2', mapRead: ['havfn'], map: 'Haven' }).samples;
    expect(mapHints(samples)).toEqual([{ token: 'havfn', map: 'Haven' }]);
  });

  it('re-correcting a game drops the sightings it recorded before, so the earlier rule comes back on', () => {
    let samples = recordMapCorrection([], { source: 'm1', mapRead: ['havfn'], map: 'Haven' }).samples;
    // m2 was kept as Bind while reading havfn: one sighting against havfn -> Haven.
    samples = recordConfirmedMaps(samples, [{ source: 'm2', mapRead: ['havfn'], map: 'Bind' }]);
    expect(mapHints(samples)).toEqual([]);
    // The coach now says m2 was Lotus. havfn does not look like Lotus, so nothing new is
    // learned; only dropping m2's old Bind sighting turns the Haven rule back on.
    const corrected = recordMapCorrection(samples, { source: 'm2', mapRead: ['havfn'], map: 'Lotus' });
    expect(corrected.learned).toEqual([]);
    expect(corrected.samples.filter(sample => sample.source === 'm2')).toEqual([]);
    expect(mapHints(corrected.samples)).toEqual([{ token: 'havfn', map: 'Haven' }]);
  });

  it('stores samples locally and survives broken storage', () => {
    saveMapReadSamples([{ token: 'havfn', map: 'Haven', kind: 'correction', source: 'm1', at: 'now' }]);
    expect(loadMapReadSamples()).toHaveLength(1);
    store['moetracker.vodMapReads.v1'] = '{broken';
    expect(loadMapReadSamples()).toEqual([]);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(loadMapReadSamples()).toEqual([]);
    expect(() => saveMapReadSamples([])).not.toThrow();
  });
});

describe('correcting an imported game', () => {
  const saved = { id: 'match-1', date: '2026-10-22', map: null, opponent: 'Scrim', ourScore: null, theirScore: null, type: 'Scrim' };
  const fake = (saveStatus = 200) => vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/data') return new Response(JSON.stringify({ matches: [saved] }), { status: 200 });
    if (url === '/api/save-match') return new Response(JSON.stringify(saveStatus === 200 ? { match: JSON.parse(String(init?.body)).match } : { error: 'Server refused.' }), { status: saveStatus });
    throw new Error(url);
  });
  const game = { map: 'Unknown map', score: 'Score pending', status: 'Timeline imported · scoreboard pending · players not named yet', matchId: 'match-1', mapRead: ['lock', 'havfn'], mapSource: null, firedTokens: [] };

  it('saves map, opponent and score to the match, keeps its stats, and learns the map read', async () => {
    const apiFetch = fake();
    const result = await saveVodGameEdit(game, { map: 'Haven', opponent: '', ourScore: 13, theirScore: 9 }, apiFetch);
    const [, init] = apiFetch.mock.calls.find(([url]) => url === '/api/save-match')!;
    expect(JSON.parse(String(init!.body))).toEqual({ match: { ...saved, map: 'Haven', opponent: 'Scrim', ourScore: 13, theirScore: 9 }, statsUpdate: { operation: 'preserve' } });
    expect(result.patch).toEqual({ map: 'Haven', score: '13–9', status: `${game.status} · corrected by you`, edited: true });
    expect(result.learned).toEqual(['havfn']);
    expect(mapHints(loadMapReadSamples())).toEqual([{ token: 'havfn', map: 'Haven' }]);
  });

  it('refuses half a score, an unsaved game or a missing map, and learns nothing when the save fails', async () => {
    await expect(saveVodGameEdit(game, { map: 'Haven', opponent: '', ourScore: 13, theirScore: null }, fake())).rejects.toThrow('both scores');
    await expect(saveVodGameEdit({ ...game, matchId: undefined }, { map: 'Haven', opponent: '', ourScore: null, theirScore: null }, fake())).rejects.toThrow('not saved yet');
    await expect(saveVodGameEdit(game, { map: ' ', opponent: '', ourScore: null, theirScore: null }, fake())).rejects.toThrow('Pick the map');
    await expect(saveVodGameEdit(game, { map: 'Haven', opponent: '', ourScore: null, theirScore: null }, fake(409))).rejects.toThrow('Server refused.');
    expect(loadMapReadSamples()).toEqual([]);
  });

  it('shows an Edit control on a saved game card', () => {
    const html = renderToStaticMarkup(React.createElement(VodGameCard, { game, index: 1, mapNames: maps, apiFetch: fake() }));
    expect(html).toContain('Game 2 · Unknown map');
    expect(html).toContain('Edit');
    expect(renderToStaticMarkup(React.createElement(VodGameCard, { game: { ...game, matchId: undefined }, index: 0, mapNames: maps, apiFetch: fake() }))).not.toContain('Edit');
  });
});
