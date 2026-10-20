import { confusableCaptureKey, normalizeCaptureName } from './scrimCaptureImport';

export const identityExactKey = (value: unknown) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').replace(/[^a-z0-9]/g, '');
export const identityOcrKey = (value: unknown) => {
  const normalized = normalizeCaptureName(String(value || ''));
  return confusableCaptureKey(normalized) || identityExactKey(value);
};

export type IdentityResolution = {
  status: 'matched' | 'ambiguous' | 'unresolved';
  playerId: string | null;
  matchedBy: 'explicit-id' | 'exact-name' | 'ocr-equivalent' | null;
  candidatePlayerIds: string[];
  observedName: string;
};

type Candidate = { playerId: string; displayName: string; archived: boolean; aliases: Set<string> };

function add(index: Map<string, Set<string>>, key: string, playerId: string) {
  if (key) index.set(key, new Set([...(index.get(key) || []), playerId]));
}

/**
 * One non-writing identity resolver shared by OCR, replay, VOD and analytics.
 * It never guesses through ambiguity and never rewrites observed names.
 */
export function buildIdentityResolver(data: any) {
  const candidates = new Map<string, Candidate>();
  const ensure = (playerId: unknown, displayName: unknown, archived = false) => {
    const id = typeof playerId === 'string' ? playerId.trim() : '';
    const name = typeof displayName === 'string' ? displayName.trim() : '';
    if (!id || !name || id.toLocaleLowerCase('en').startsWith('name:')) return null;
    const candidate = candidates.get(id) || { playerId: id, displayName: name, archived, aliases: new Set<string>() };
    if (!candidate.displayName) candidate.displayName = name;
    candidate.archived = candidate.archived || archived;
    candidate.aliases.add(name); candidates.set(id, candidate); return candidate;
  };

  for (const player of data?.rosterPlayers || []) {
    const candidate = ensure(player?.id, player?.displayName, !!player?.retiredAt);
    if (candidate) for (const alias of player?.aliases || []) if (typeof alias === 'string' && alias.trim()) candidate.aliases.add(alias.trim());
  }
  for (const archive of data?.seasonArchives || []) for (const player of archive?.rosterPlayers || []) ensure(player?.id, player?.displayName, true);
  for (const batch of data?.tryoutBatches || []) for (const alias of batch?.aliases || []) {
    const candidate = candidates.get(String(alias?.playerId || '')); if (candidate && typeof alias?.alias === 'string' && alias.alias.trim()) candidate.aliases.add(alias.alias.trim());
  }
  for (const correction of data?.identityCorrectionBatches || []) {
    if (correction?.revertedAt) continue;
    const candidate = candidates.get(String(correction?.targetPlayerId || '')); const observed = String(correction?.sourceIdentity || '').replace(/^unlinked-name:/, '').trim();
    if (candidate && observed) candidate.aliases.add(observed);
  }
  for (const row of data?.playerStats || []) {
    const candidate = candidates.get(String(row?.playerId || '')); const observed = String(row?.displayNameSnapshot || row?.player || '').trim();
    if (candidate && observed) candidate.aliases.add(observed);
  }

  const exact = new Map<string, Set<string>>(); const ocr = new Map<string, Set<string>>();
  for (const candidate of candidates.values()) for (const alias of candidate.aliases) {
    add(exact, identityExactKey(alias), candidate.playerId); add(ocr, identityOcrKey(alias), candidate.playerId);
  }
  const result = (observedName: string, ids: string[] | undefined, matchedBy: IdentityResolution['matchedBy']): IdentityResolution => {
    const candidatePlayerIds = [...new Set(ids || [])].sort();
    return { status: candidatePlayerIds.length === 1 ? 'matched' : candidatePlayerIds.length > 1 ? 'ambiguous' : 'unresolved', playerId: candidatePlayerIds.length === 1 ? candidatePlayerIds[0] : null, matchedBy: candidatePlayerIds.length === 1 ? matchedBy : null, candidatePlayerIds, observedName };
  };
  return {
    resolve(input: { playerId?: unknown; observedName?: unknown; includeArchived?: boolean }): IdentityResolution {
      const observedName = typeof input.observedName === 'string' ? input.observedName.trim() : '';
      const explicit = typeof input.playerId === 'string' ? input.playerId.trim() : '';
      if (explicit && candidates.has(explicit)) return result(observedName, [explicit], 'explicit-id');
      const allowed = (ids: Iterable<string>) => [...ids].filter(playerId => input.includeArchived !== false || !candidates.get(playerId)?.archived);
      const exactIds = exact.get(identityExactKey(observedName)); if (exactIds?.size) return result(observedName, allowed(exactIds), 'exact-name');
      const ocrIds = ocr.get(identityOcrKey(observedName)); if (ocrIds?.size) return result(observedName, allowed(ocrIds), 'ocr-equivalent');
      return result(observedName, [], null);
    },
    identity(playerId: string) { const candidate = candidates.get(playerId); return candidate ? { ...candidate, aliases: [...candidate.aliases].sort() } : null; },
    identities() { return [...candidates.values()].map(candidate => ({ ...candidate, aliases: [...candidate.aliases].sort() })).sort((left, right) => left.playerId.localeCompare(right.playerId)); },
  };
}
