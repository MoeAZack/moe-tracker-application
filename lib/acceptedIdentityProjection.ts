import type { TrackerData } from '../src/types';
import { buildIdentityResolver } from './identityResolver';

const anonymous = (value: unknown) => /^(anonymous player \d+|player-[a-f0-9]{3,}|unknown)$/i.test(String(value || '').trim());

type IdentityProjectionData = TrackerData & { engineAdapters?: any };

export function buildAcceptedIdentityProjection(data: IdentityProjectionData, matchId: string) {
  const names = new Map<string, { playerId: string | null; displayName: string; source: 'accepted-replay' | 'materialized-stat' | 'roster' }>();
  const resolver = buildIdentityResolver(data);
  const accepted: any = data.engineAdapters?.replay?.[matchId];
  if (accepted?.status === 'accepted') for (const mapping of accepted.overlay?.mappings || []) if (mapping?.parserPlayerId && mapping?.displayName) names.set(String(mapping.parserPlayerId), { playerId: mapping.rosterPlayerId || null, displayName: mapping.displayName, source: 'accepted-replay' });
  for (const row of (data.playerStats || []).filter(row => row.matchId === matchId)) {
    const label = row.displayNameSnapshot || row.player; if (row.playerId && label) names.set(row.playerId, { playerId: row.playerId, displayName: label, source: 'materialized-stat' });
  }
  return {
    resolve(value: unknown) {
      const raw = String(value || '').trim(); const explicit = names.get(raw); if (explicit) return { raw, ...explicit, resolved: true as const };
      const matched = resolver.resolve({ observedName: raw }); const identity = matched.playerId ? resolver.identity(matched.playerId) : null;
      if (matched.status === 'matched' && identity) return { raw, playerId: matched.playerId, displayName: identity.displayName, source: 'roster' as const, resolved: true as const };
      return { raw, playerId: null, displayName: raw || 'Unknown', source: null, resolved: false as const };
    },
    entries: [...names.entries()].map(([raw, item]) => ({ raw, ...item })),
  };
}

export function auditAcceptedAnonymousLeaks(data: IdentityProjectionData) {
  const leaks: Array<{ matchId: string; reference: string; value: string }> = [];
  for (const [matchId, record] of Object.entries(data.engineAdapters?.replay || {}) as Array<[string, any]>) {
    if (record?.status !== 'accepted') continue;
    for (const row of (data.playerStats || []).filter(item => item.matchId === matchId)) {
      const value = String(row.displayNameSnapshot || row.player || ''); if (row.playerId && anonymous(value)) leaks.push({ matchId, reference: `playerStats:${row.id}`, value });
    }
    const rawIds = new Set((record.overlay?.mappings || []).map((mapping: any) => String(mapping.parserPlayerId || '')).filter(Boolean));
    for (const round of (data.rounds || []).filter(item => item.matchId === matchId)) for (const field of ['firstKillBy', 'firstDeathBy', 'clutchPlayer'] as const) {
      const value = String((round as any)[field] || ''); if (anonymous(value) || rawIds.has(value)) leaks.push({ matchId, reference: `round:${round.id}:${field}`, value });
    }
  }
  return leaks;
}
