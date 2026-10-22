import type { Match, PlayerStats, TrackerData } from '../src/types';
import { exactMatchSourceTokens } from './matchIntegrity';
import { physicalMatchIdentity } from './physicalMatchIdentity';

// One answer to "which saved match is this game?" for every source (match
// save, VOD submission, replay). Evidence is tried strongest first:
//   source   - the same capture, screenshot, replay or provider id;
//   physical - date, map, opponent, score and five linked players;
//   header   - date, map and score (opponent when both sides know it).
// A header alone can repeat, so callers narrow header candidates further
// (shared roster, an unlinked replay slot). Same-game round evidence after a
// save is handled by refreshDuplicateQuarantine, not here.

export type MatchIdentityBasis = 'source' | 'physical' | 'header';

export interface IncomingGame {
  date: string;
  map?: string | null;
  opponent?: string | null;
  ourScore?: number | null;
  theirScore?: number | null;
  sourceMetadata?: unknown;
  screenshotEvidence?: unknown;
  comparisonEvidence?: unknown;
  evidenceReference?: unknown;
}

export function normalizedMatchName(value: unknown) {
  return String(value || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

/** OCR-tolerant name comparison: equal, or within one edit per five characters. */
export function similarMatchName(left: unknown, right: unknown) {
  const a = normalizedMatchName(left); const b = normalizedMatchName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * .2));
}

const knownName = (value: unknown) => { const name = normalizedMatchName(value); return name && !['unknown', 'unknownmap', 'unknownopponent'].includes(name) ? name : null; };
const knownScore = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * Same date, map and score, and a similar opponent when both sides name one.
 * A field one side does not know never proves a match; with `unknownMatches`
 * it is merely not held against it (a VOD often lacks map or score).
 */
export function sameMatchHeader(game: IncomingGame, match: Partial<Match>, options: { unknownMatches?: boolean } = {}) {
  const lenient = options.unknownMatches === true;
  if (!game.date || match.date !== game.date) return false;
  const gameMap = knownName(game.map); const matchMap = knownName(match.map);
  if (gameMap && matchMap ? gameMap !== matchMap : !lenient) return false;
  const gameOpponent = knownName(game.opponent); const matchOpponent = knownName(match.opponent);
  if (gameOpponent && matchOpponent && !similarMatchName(gameOpponent, matchOpponent)) return false;
  const scoresKnown = knownScore(game.ourScore) && knownScore(game.theirScore) && knownScore(match.ourScore) && knownScore(match.theirScore);
  if (scoresKnown ? match.ourScore !== game.ourScore || match.theirScore !== game.theirScore : !lenient) return false;
  return true;
}

/**
 * Saved matches that are this game, on the strongest evidence available.
 * `exclude` drops matches the caller may not reuse (for example one that
 * already holds a replay). Returns no basis when nothing matches.
 */
export function findMatchCandidates(
  data: Pick<TrackerData, 'matches' | 'playerStats'>,
  game: IncomingGame,
  options: { stats?: Array<Partial<PlayerStats>>; unknownMatches?: boolean; exclude?: (match: Match) => boolean } = {},
): { basis: MatchIdentityBasis | null; matches: Match[] } {
  const pool = (data.matches || []).filter(match => !options.exclude?.(match));
  const tokens = new Set(exactMatchSourceTokens(game));
  if (tokens.size) {
    const bySource = pool.filter(match => exactMatchSourceTokens(match).some(token => tokens.has(token)));
    if (bySource.length) return { basis: 'source', matches: bySource };
  }
  if (options.stats?.length) {
    const target = physicalMatchIdentity({ date: game.date, map: game.map || '', opponent: game.opponent || '', ourScore: game.ourScore ?? null, theirScore: game.theirScore ?? null } as Match, options.stats);
    const byPhysical = target ? pool.filter(match => physicalMatchIdentity(match, (data.playerStats || []).filter(row => row.matchId === match.id))?.fingerprint === target.fingerprint) : [];
    if (byPhysical.length) return { basis: 'physical', matches: byPhysical };
  }
  const byHeader = pool.filter(match => sameMatchHeader(game, match, { unknownMatches: options.unknownMatches }));
  return { basis: byHeader.length ? 'header' : null, matches: byHeader };
}
