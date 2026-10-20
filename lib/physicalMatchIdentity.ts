import crypto from 'crypto';
import type { Match, PlayerStats, TrackerData } from '../src/types';

const normalized = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
const score = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const identity = (row: Partial<PlayerStats>) => row.playerId ? `id:${row.playerId}` : normalized(row.displayNameSnapshot || row.player) ? `name:${normalized(row.displayNameSnapshot || row.player)}` : null;

export interface PhysicalMatchIdentity {
  schema: 'moetracker.physical-match/v1';
  fingerprint: string;
  date: string;
  map: string;
  opponent: string;
  score: [number, number];
  roster: string[];
}

/** High-precision cross-source identity. Five linked players plus date, map,
 * opponent and score are required; incomplete evidence is never guessed. */
export function physicalMatchIdentity(match: Pick<Match, 'date' | 'map' | 'opponent' | 'ourScore' | 'theirScore'>, stats: Array<Partial<PlayerStats>>): PhysicalMatchIdentity | null {
  const roster = [...new Set(stats.map(identity).filter((item): item is string => Boolean(item)))].sort();
  const ourScore = score(match.ourScore); const theirScore = score(match.theirScore);
  const date = String(match.date || '').trim(); const map = normalized(match.map); const opponent = normalized(match.opponent);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !map || ['unknownmap', 'unknown'].includes(map) || !opponent || opponent === 'unknownopponent' || ourScore === null || theirScore === null || roster.length < 5) return null;
  const payload = { schema: 'moetracker.physical-match/v1' as const, date, map, opponent, score: [ourScore, theirScore] as [number, number], roster: roster.slice(0, 10) };
  return { ...payload, fingerprint: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}

export function findPhysicalMatchCandidates(data: Pick<TrackerData, 'matches' | 'playerStats'>, match: Pick<Match, 'date' | 'map' | 'opponent' | 'ourScore' | 'theirScore'>, stats: Array<Partial<PlayerStats>>) {
  const target = physicalMatchIdentity(match, stats); if (!target) return [];
  return (data.matches || []).filter(candidate => physicalMatchIdentity(candidate, (data.playerStats || []).filter(row => row.matchId === candidate.id))?.fingerprint === target.fingerprint);
}

export function auditPhysicalMatchDuplicates(data: Pick<TrackerData, 'matches' | 'playerStats'>) {
  const groups = new Map<string, string[]>();
  for (const match of data.matches || []) { const item = physicalMatchIdentity(match, (data.playerStats || []).filter(row => row.matchId === match.id)); if (item) groups.set(item.fingerprint, [...(groups.get(item.fingerprint) || []), match.id]); }
  return [...groups].filter(([, matchIds]) => matchIds.length > 1).map(([fingerprint, matchIds]) => ({ fingerprint, matchIds }));
}

