import type { PlayerStats, Round, TrackerData } from '../src/types';
import { identityOcrKey } from './identityResolver';

const stablePlayerId = (value: unknown): string | null => {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && !id.toLocaleLowerCase('en').startsWith('name:') ? id : null;
};

const observedName = (row: Pick<PlayerStats, 'player' | 'displayNameSnapshot'>) => row.displayNameSnapshot?.trim() || row.player?.trim() || '';
const nameFromReference = (playerId: unknown, displayName: unknown) => {
  const supplied = typeof playerId === 'string' ? playerId.trim() : '';
  return supplied.toLocaleLowerCase('en').startsWith('name:') ? supplied.slice(5) : String(displayName || '').trim();
};
const nameKey = (value: unknown) => {
  return identityOcrKey(value);
};

export interface CurrentAnalyticsIdentityPolicy {
  isVisible(playerId: unknown, displayName: unknown): boolean;
}

/**
 * One roster identity policy for every current analytics surface.
 *
 * Archived records remain in storage and review history. They are visible in
 * current analytics only when another non-archived observed identity with the
 * same OCR-equivalent name proves that the historical rows belong to a player
 * who is still present (for example, a repaired replay identity).
 */
export function currentAnalyticsIdentityPolicy(data: Pick<TrackerData, 'rosterPlayers' | 'playerStats'>): CurrentAnalyticsIdentityPolicy {
  const retiredIds = new Set((data.rosterPlayers || []).filter(player => player.retiredAt).map(player => player.id));
  const retiredNames = new Set((data.rosterPlayers || []).filter(player => player.retiredAt).map(player => nameKey(player.displayName)).filter(Boolean));
  const liveNames = new Set((data.rosterPlayers || []).filter(player => !player.retiredAt).map(player => nameKey(player.displayName)).filter(Boolean));

  for (const row of data.playerStats || []) {
    const key = nameKey(observedName(row));
    if (!key) continue;
    const id = stablePlayerId(row.playerId);
    if (id ? !retiredIds.has(id) : !retiredNames.has(key)) liveNames.add(key);
  }

  return {
    isVisible(playerId, displayName) {
      const id = stablePlayerId(playerId);
      const key = nameKey(nameFromReference(playerId, displayName));
      if (id && retiredIds.has(id)) return !!key && liveNames.has(key);
      if (!id && key && retiredNames.has(key)) return liveNames.has(key);
      return true;
    },
  };
}

export function currentAnalyticsPlayerStats(data: Pick<TrackerData, 'rosterPlayers' | 'playerStats'>): PlayerStats[] {
  const policy = currentAnalyticsIdentityPolicy(data);
  return (data.playerStats || []).filter(row => policy.isVisible(row.playerId, observedName(row)));
}

function averageKnownPlayers(players: Round['screenshotEvidence']['players'], field: 'loadoutValue' | 'bank'): number | null {
  const values = players.filter(player => player.team === 'ours').map(player => player[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

export function currentAnalyticsRounds(rounds: readonly Round[], policy: CurrentAnalyticsIdentityPolicy): Round[] {
  return (rounds || []).map(round => {
    const evidence = round.screenshotEvidence;
    if (!evidence) return round;
    const visibilityById = new Map<string, boolean>();
    for (const player of evidence.players || []) {
      if (!player.playerId) continue;
      visibilityById.set(player.playerId, player.team !== 'ours' || policy.isVisible(player.playerId, player.displayName));
    }
    const players = (evidence.players || []).filter(player => player.team !== 'ours' || policy.isVisible(player.playerId, player.displayName));
    const visibleReference = (playerId: string | null | undefined, team: 'ours' | 'theirs' | null | undefined) => {
      if (team !== 'ours' || !playerId) return true;
      return visibilityById.get(playerId) ?? policy.isVisible(playerId, '');
    };
    const events = (evidence.events || []).filter(event => visibleReference(event.killerPlayerId, event.killerTeam) && visibleReference(event.victimPlayerId, event.victimTeam));
    const objectives = (evidence.objectives || []).filter(event => visibleReference(event.playerId, event.team));
    const changed = players.length !== (evidence.players || []).length || events.length !== (evidence.events || []).length || objectives.length !== (evidence.objectives || []).length;
    if (!changed) return round;
    return {
      ...round,
      screenshotEvidence: {
        ...evidence,
        players,
        events,
        objectives,
        ourAverageLoadout: averageKnownPlayers(players, 'loadoutValue'),
        ourAverageBank: averageKnownPlayers(players, 'bank'),
        // Removing an archived participant makes the original event sequence
        // incomplete. Fail closed instead of inventing openings or trades.
        eventsComplete: false,
        openingEventComplete: false,
      },
    };
  });
}

/** Project the immutable evidence store into the one dataset used by every
 * current analytics tab. Review/editing surfaces continue to receive raw data. */
export function projectCurrentPlayerAnalytics(data: TrackerData): TrackerData {
  const policy = currentAnalyticsIdentityPolicy(data);
  return {
    ...data,
    playerStats: currentAnalyticsPlayerStats(data),
    rounds: currentAnalyticsRounds(data.rounds || [], policy),
    soloq: (data.soloq || []).filter(row => policy.isVisible(null, row.player)),
  };
}
