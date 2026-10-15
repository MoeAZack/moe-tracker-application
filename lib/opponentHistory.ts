import type { Match } from '../src/types';

export interface OpponentHistoryRow {
  key: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  maps: string[];
  lastPlayed: string;
}

const normalized = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const score = (match: Match) => {
  if (typeof match.ourScore === 'number' && typeof match.theirScore === 'number') return [match.ourScore, match.theirScore];
  if ([match.attW, match.attL, match.defW, match.defL].every(value => typeof value === 'number')) return [match.attW! + match.defW!, match.attL! + match.defL!];
  return null;
};

function preferredName(variants: Map<string, number>) {
  return [...variants].sort(([left, leftCount], [right, rightCount]) => {
    if (rightCount !== leftCount) return rightCount - leftCount;
    const capitals = (value: string) => (value.match(/[A-Z]/g) || []).length;
    return capitals(right) - capitals(left) || left.localeCompare(right, 'en');
  })[0]?.[0] || '';
}

export function buildOpponentHistory(matches: readonly Match[]): OpponentHistoryRow[] {
  const grouped = new Map<string, { variants: Map<string, number>; matches: Match[] }>();
  for (const match of matches) {
    const name = String(match.opponent || '').trim().replace(/\s+/g, ' ');
    const key = normalized(name);
    if (!key) continue;
    const group = grouped.get(key) || { variants: new Map<string, number>(), matches: [] };
    group.variants.set(name, (group.variants.get(name) || 0) + 1);
    group.matches.push(match);
    grouped.set(key, group);
  }
  return [...grouped].map(([key, group]) => {
    let wins = 0; let losses = 0; let ties = 0;
    for (const match of group.matches) {
      const result = score(match); if (!result) continue;
      if (result[0] > result[1]) wins += 1; else if (result[0] < result[1]) losses += 1; else ties += 1;
    }
    return {
      key,
      name: preferredName(group.variants),
      games: group.matches.length,
      wins,
      losses,
      ties,
      maps: [...new Set(group.matches.map(match => match.map).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en')),
      lastPlayed: group.matches.map(match => match.date).filter(Boolean).sort().at(-1) || '',
    };
  }).sort((left, right) => right.games - left.games || right.lastPlayed.localeCompare(left.lastPlayed) || left.name.localeCompare(right.name, 'en'));
}
