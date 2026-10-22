'use strict';

// A finished VALORANT match writes a new .vrf replay. That file is the
// match-end signal: no process memory, no injection, only the replay folder
// the collector already watches. The offer is made once per replay and only
// while the match is fresh, so starting the app never nags about old games.
const OFFER_WINDOW_MS = 30 * 60 * 1000;

const replayKey = replay => `${replay.path}|${replay.modifiedAt}`;

function matchEndOffer({ replays, captures, lastOfferedKey, paused, preference, now = Date.now() }) {
  if (paused || preference === 'off') return null;
  const latest = (replays || [])[0];
  if (!latest) return null;
  const endedAt = Date.parse(latest.modifiedAt);
  if (!Number.isFinite(endedAt) || now - endedAt > OFFER_WINDOW_MS || now < endedAt - 60_000) return null;
  if (replayKey(latest) === lastOfferedKey) return null;
  // A capture taken after this match ended already covers it.
  if ((captures || []).some(capture => Date.parse(capture.modifiedAt) >= endedAt)) return null;
  return { key: replayKey(latest), replay: latest };
}

module.exports = { OFFER_WINDOW_MS, matchEndOffer, replayKey };
