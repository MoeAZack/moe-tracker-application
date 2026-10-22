import fs from 'fs';
import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { matchEndOffer, OFFER_WINDOW_MS } = require('../desktop/match-end-offer.cjs');
const now = Date.parse('2026-10-22T20:00:00Z');
const replay = (minutesAgo: number, name = 'match.vrf') => ({ name, path: `C:/Replays/${name}`, size: 1, modifiedAt: new Date(now - minutesAgo * 60_000).toISOString() });

describe('capture offer at match end', () => {
  it('offers once for a fresh replay with no capture after it', () => {
    const offer = matchEndOffer({ replays: [replay(2)], captures: [], lastOfferedKey: null, paused: false, preference: 'notify', now });
    expect(offer?.replay.name).toBe('match.vrf');
    expect(matchEndOffer({ replays: [replay(2)], captures: [], lastOfferedKey: offer.key, paused: false, preference: 'notify', now })).toBeNull();
  });

  it('stays quiet for old replays, when paused or turned off, and when a capture already covers the match', () => {
    expect(matchEndOffer({ replays: [replay(OFFER_WINDOW_MS / 60_000 + 1)], captures: [], lastOfferedKey: null, paused: false, preference: 'notify', now })).toBeNull();
    expect(matchEndOffer({ replays: [replay(2)], captures: [], lastOfferedKey: null, paused: true, preference: 'notify', now })).toBeNull();
    expect(matchEndOffer({ replays: [replay(2)], captures: [], lastOfferedKey: null, paused: false, preference: 'off', now })).toBeNull();
    expect(matchEndOffer({ replays: [replay(5)], captures: [{ modifiedAt: new Date(now - 60_000).toISOString() }], lastOfferedKey: null, paused: false, preference: 'notify', now })).toBeNull();
    expect(matchEndOffer({ replays: [], captures: [], lastOfferedKey: null, paused: false, preference: 'notify', now })).toBeNull();
  });

  it('only starts a capture from the notification click and keeps the preference', () => {
    const main = fs.readFileSync('desktop/main.cjs', 'utf8');
    expect(main).toMatch(/notification\.on\('click', \(\) => \{ void startScrimCapture\(\{\}\)/);
    expect(main).toContain("matchEndOffer: matchEndOfferPreference");
    expect(main).toContain("handleTrusted('desktop:start-scrim-capture', async (_event, input = {}) => startScrimCapture(input));");
  });
});
