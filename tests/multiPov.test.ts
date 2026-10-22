import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { alignForRound, defaultOffset, roundAnchors, driftCorrections, matchPovs, roundSeekTargets, youtubeVideoId, type Pov } from '../lib/multiPov';
import { YOUTUBE_EMBED_ORIGIN, videoElementPlayer, youtubeEmbedUrl, youtubePlayer } from '../src/utils/povPlayers';
import MultiPovReview from '../src/components/MultiPovReview';

const pov = (id: string, offset: number, anchors: Record<number, number> = {}): Pov => ({ id, title: id, kind: 'youtube', videoId: 'abcdefghijk', reviewId: id, vodUrl: `https://youtu.be/${id}`, offset, anchors });
const review = (id: string, overrides: Record<string, unknown> = {}) => ({ id, title: `POV ${id}`, vodUrl: 'https://www.youtube.com/watch?v=abcdefghijk', matchId: 'm1', createdAt: `2026-10-22T10:0${id.length}:00Z`, notes: [], ...overrides });

describe('multi-POV sync clock', () => {
  it('reads YouTube ids from every link shape and nothing else', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk&t=5s')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/live/abcdefghijk?si=x')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.twitch.tv/videos/123')).toBeNull();
    expect(youtubeVideoId('https://evil.example/watch?v=abcdefghijk')).toBeNull();
    expect(youtubeVideoId('not a link')).toBeNull();
  });

  it('uses the first note of a round as its anchor', () => {
    expect(roundAnchors([{ roundNo: 4, seconds: 300 }, { roundNo: 4, seconds: 330 }, { roundNo: 5 }, { seconds: 10 }])).toEqual({ 4: 300 });
  });

  it('starts from the saved offset, then round 1, then zero', () => {
    expect(defaultOffset({ id: 'a', syncOffsetSeconds: 42, notes: [{ roundNo: 1, seconds: 90 }] })).toBe(42);
    expect(defaultOffset({ id: 'a', notes: [{ roundNo: 2, seconds: 200 }, { roundNo: 1, seconds: 90 }] })).toBe(90);
    expect(defaultOffset({ id: 'a', notes: [] })).toBe(0);
  });

  it('lists only this match’s videos, oldest first', () => {
    const povs = matchPovs([review('bb'), review('a'), review('c', { matchId: 'm2' }), review('d', { vodUrl: '' })], 'm1');
    expect(povs.map(item => item.reviewId)).toEqual(['a', 'bb']);
    expect(matchPovs([review('a')], null)).toEqual([]);
  });

  it('sends each view to its own round anchor, or the shared clock when it has none', () => {
    const povs = [pov('main', 100, { 3: 400 }), pov('marked', 30, { 3: 345 }), pov('unmarked', 60)];
    // Round 3 is match time 300 on the main view; the unmarked view goes to 300 + 60.
    expect(roundSeekTargets(povs, 3)).toEqual({ main: 400, marked: 345, unmarked: 360 });
    expect(roundSeekTargets(povs, 9)).toBeNull();
  });

  it('re-bases offsets on a round jump so drift correction keeps views on their own anchors', () => {
    const povs = [pov('main', 100, { 3: 400 }), pov('marked', 30, { 3: 345 }), pov('unmarked', 60)];
    const aligned = alignForRound(povs, 3, 'main')!;
    expect(aligned.offsets).toEqual({ main: 100, marked: 45, unmarked: 60 });
    const rebased = povs.map(item => ({ ...item, offset: aligned.offsets[item.id] }));
    expect(driftCorrections(rebased, aligned.targets, 'main')).toEqual([]);
    // Without re-basing, the marked view would be pulled 15 s away from its anchor.
    expect(driftCorrections(povs, aligned.targets, 'main')).toEqual([{ id: 'marked', seekTo: 330 }]);
  });

  it('moves only followers that drifted past the tolerance, and leaves loading views alone', () => {
    const povs = [pov('main', 10), pov('close', 20), pov('far', 5), pov('loading', 0)];
    expect(driftCorrections(povs, { main: 110, close: 120.5, far: 90, loading: null }, 'main')).toEqual([{ id: 'far', seekTo: 105 }]);
    expect(driftCorrections(povs, { main: null, close: 1, far: 1, loading: 1 }, 'main')).toEqual([]);
  });
});

describe('POV players', () => {
  function fakeYouTube() {
    const posted: any[] = []; let handler: ((event: MessageEvent) => void) | null = null; let clock = 1_000;
    const contentWindow = { postMessage: (message: string, origin: string) => posted.push({ message: JSON.parse(message), origin }) };
    const source = { addEventListener: (_: 'message', listener: any) => { handler = listener; }, removeEventListener: () => { handler = null; } };
    const player = youtubePlayer({ contentWindow }, source, () => clock);
    const deliver = (data: unknown, overrides: Partial<{ origin: string; source: unknown }> = {}) => handler?.({ origin: YOUTUBE_EMBED_ORIGIN, source: contentWindow, data: JSON.stringify(data), ...overrides } as MessageEvent);
    return { player, posted, deliver, tick: (ms: number) => { clock += ms; }, attached: () => !!handler };
  }

  it('drives the YouTube embed by message, only to the YouTube origin', () => {
    const yt = fakeYouTube();
    yt.player.listen(); yt.player.play(); yt.player.seek(-5); yt.player.setMuted(true);
    expect(yt.posted.map(item => item.message.func || item.message.event)).toEqual(['listening', 'playVideo', 'seekTo', 'mute']);
    expect(yt.posted[2].message.args).toEqual([0, true]);
    expect(new Set(yt.posted.map(item => item.origin))).toEqual(new Set([YOUTUBE_EMBED_ORIGIN]));
  });

  it('tracks time from the embed’s own reports and ignores other windows', () => {
    const yt = fakeYouTube();
    expect(yt.player.time()).toBeNull();
    yt.deliver({ event: 'infoDelivery', info: { currentTime: 50, playerState: 1 } });
    yt.tick(500);
    expect(yt.player.time()).toBeCloseTo(50.5);
    yt.deliver({ event: 'infoDelivery', info: { currentTime: 999 } }, { origin: 'https://evil.example' });
    yt.deliver({ event: 'infoDelivery', info: { currentTime: 999 } }, { source: {} });
    expect(yt.player.time()).toBeCloseTo(50.5);
    yt.deliver({ event: 'onStateChange', info: 2 });
    yt.tick(5_000);
    expect(yt.player.time()).toBeCloseTo(50);
    yt.player.dispose();
    expect(yt.attached()).toBe(false);
  });

  it('builds a privacy-mode embed URL with the JS API on', () => {
    const url = new URL(youtubeEmbedUrl('abcdefghijk', 95.7, 'http://127.0.0.1:3000'));
    expect(url.origin).toBe(YOUTUBE_EMBED_ORIGIN);
    expect(url.pathname).toBe('/embed/abcdefghijk');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ enablejsapi: '1', origin: 'http://127.0.0.1:3000', start: '95' });
  });

  it('wraps a local video element', () => {
    const video = { play: vi.fn(async () => {}), pause: vi.fn(), currentTime: 0, muted: false, readyState: 0 };
    const player = videoElementPlayer(video);
    expect(player.time()).toBeNull();
    video.readyState = 1; player.seek(-3); expect(video.currentTime).toBe(0);
    player.seek(12); player.setMuted(true); player.play();
    expect(player.time()).toBe(12); expect(video.muted).toBe(true); expect(video.play).toHaveBeenCalled();
  });
});

describe('Watch POVs together panel', () => {
  const props = { reviews: [review('a', { notes: [{ id: 'n', roundNo: 2, seconds: 120 }] }), review('bb', { vodUrl: 'https://www.twitch.tv/videos/1' })], matchId: 'm1', rounds: [1, 2], onSaveOffset: async () => true };

  it('stays closed until asked, so no video loads on page open', () => {
    const html = renderToStaticMarkup(React.createElement(MultiPovReview, props as any));
    expect(html).toContain('Open side-by-side review');
    expect(html).toContain('2 videos linked to this match.');
    expect(html).not.toContain('<iframe');
  });

  it('embeds YouTube views in a sandboxed privacy-mode frame and explains links that cannot sync', () => {
    const html = renderToStaticMarkup(React.createElement(MultiPovReview, { ...props, defaultOpen: true } as any));
    expect(html).toContain('src="https://www.youtube-nocookie.com/embed/abcdefghijk?enablejsapi=1');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation"');
    expect(html).toContain('Views on screen (1/5)');
    expect(html).toContain('link only');
    expect(html).toContain('Round 2</option>');
    expect(html).toContain('Round 1 (not marked)</option>');
    expect(html).toContain('Add videos from this PC');
  });
});
