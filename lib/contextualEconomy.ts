import type { TrackerData } from '../src/types';

export interface ContextualWeaponRow { weapon: string; map: string; side: string; site: string; player: string; agent: string; rounds: number; wins: number; losses: number; winRate: number; confidence: 'low' | 'medium' | 'high' }
export function buildContextualWeaponOutcomes(data: Pick<TrackerData, 'matches' | 'rounds' | 'playerStats'>, matchIds?: Set<string>): ContextualWeaponRow[] {
  const maps = new Map((data.matches || []).map(match => [match.id, match.map || 'Unknown'])); const stats = new Map<string, any>();
  for (const row of data.playerStats || []) stats.set(`${row.matchId}:${row.playerId || String(row.player).toLocaleLowerCase()}`, row);
  const grouped = new Map<string, ContextualWeaponRow>();
  for (const round of data.rounds || []) {
    if (matchIds && !matchIds.has(round.matchId)) continue; if (round.screenshotEvidence?.reviewStatus !== 'confirmed' || !['W', 'L', 'win', 'loss', 'won', 'lost'].includes(String(round.result))) continue;
    const won = ['W', 'win', 'won'].includes(String(round.result));
    for (const player of round.screenshotEvidence.players.filter(item => item.team === 'ours' && item.equippedWeapon)) {
      const stat = stats.get(`${round.matchId}:${player.playerId || player.displayName.toLocaleLowerCase()}`); const values = { weapon: String(player.equippedWeapon), map: maps.get(round.matchId) || 'Unknown', side: round.side || 'Unknown', site: round.site || 'Unspecified', player: player.displayName, agent: stat?.agent || 'Unknown' }; const key = Object.values(values).join('|').toLocaleLowerCase();
      const row = grouped.get(key) || { ...values, rounds: 0, wins: 0, losses: 0, winRate: 0, confidence: 'low' as const }; row.rounds += 1; if (won) row.wins += 1; else row.losses += 1; grouped.set(key, row);
    }
  }
  return [...grouped.values()].map(row => ({ ...row, winRate: Math.round(row.wins / row.rounds * 100), confidence: (row.rounds >= 10 ? 'high' : row.rounds >= 5 ? 'medium' : 'low') as ContextualWeaponRow['confidence'] })).sort((a, b) => b.rounds - a.rounds || b.winRate - a.winRate);
}
