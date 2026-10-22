import crypto from 'crypto';
import { buildIdentityResolver } from './identityResolver';
import { evidenceReferenceForMatch, evidenceReferenceForRound, evidenceReferenceKey, normalizeEvidenceReference, workspaceIdentity, type EvidenceReferenceV1, type EvidenceSourceType } from './evidenceReference';

export const CANONICAL_DATA_SPINE_SCHEMA = 'moetracker.canonical-data-spine/v1' as const;
export const CANONICAL_DATA_SPINE_VERSION = 'canonical-data-spine/v1' as const;

type Location = { kind: 'active' } | { kind: 'season-archive'; archiveId: string };
export type CanonicalSourceNode = { id: string; state: EvidenceReferenceV1['state']; types: EvidenceReferenceV1['sourceTypes']; matchId: string | null; roundId: string | null; capturedAt: string | null; acceptedAt: string | null; reference: EvidenceReferenceV1 };
export type CanonicalIdentityNode = { id: string; displayName: string; aliases: string[]; status: 'active' | 'archived'; createdAt: string | null; retiredAt: string | null };
export type CanonicalMatchNode = { id: string; location: Location; date: string | null; map: string | null; opponent: string | null; state: EvidenceReferenceV1['state']; sourceIds: string[]; roundIds: string[]; appearanceIds: string[] };
export type CanonicalRoundNode = { id: string; location: Location; matchId: string; roundNumber: number | null; sourceIds: string[] };
export type CanonicalAppearanceNode = { id: string; location: Location; matchId: string; sourceRowId: string; playerId: string | null; identityStatus: 'matched' | 'ambiguous' | 'unresolved'; observedName: string; agent: string | null; appearanceType: string | null; sourceIds: string[] };
export type CanonicalDerivedBuild = { matchId: string; status: string; sourceHash: string | null; calculationVersions: string[] };
export type CanonicalDataSpine = { schema: typeof CANONICAL_DATA_SPINE_SCHEMA; calculationVersion: typeof CANONICAL_DATA_SPINE_VERSION; workspaceId: string; sourceFingerprint: string; identities: CanonicalIdentityNode[]; sources: CanonicalSourceNode[]; matches: CanonicalMatchNode[]; rounds: CanonicalRoundNode[]; appearances: CanonicalAppearanceNode[]; derivedBuilds: CanonicalDerivedBuild[] };

const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  : JSON.stringify(value);
const hash = (value: unknown) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

function containers(data: any): Array<{ location: Location; container: any }> {
  return [{ location: { kind: 'active' }, container: data }, ...(data?.seasonArchives || []).map((archive: any) => ({ location: { kind: 'season-archive' as const, archiveId: String(archive.id) }, container: archive }))];
}

function appearanceReference(base: EvidenceReferenceV1, row: any, playerId: string | null, observedName: string): EvidenceReferenceV1 {
  const method = row?.sourceMetadata?.method;
  const source: EvidenceSourceType | null = method === 'vod-submission' ? 'vod'
    : method === 'provider-import' && row?.sourceMetadata?.provider === 'vrfkit' && base.replay ? 'replay'
      : ['manual', 'screenshot', 'live-logger', 'provider-import'].includes(method) ? method : null;
  if (!source && !row?.sourceMetadata) return base;
  return normalizeEvidenceReference({
    ...base, sourceTypes: source ? [source] : base.sourceTypes, round: null,
    // A VOD row on a match from another source is anchored by its match id.
    vod: source === 'vod' ? base.vod || { vodReviewId: null, noteId: null, atSeconds: null } : source ? null : base.vod,
    capturedAt: row?.sourceMetadata?.capturedAt || base.capturedAt,
    observedIdentities: observedName ? [{ playerId, observedName, agent: text(row?.agent), team: 'ours' }] : [],
    producer: base.producer,
  });
}

export function buildCanonicalDataSpine(data: any): CanonicalDataSpine {
  const workspaceId = workspaceIdentity(data); if (!workspaceId) throw new Error('Canonical data spine requires a workspace identity.');
  const resolver = buildIdentityResolver(data); const sources = new Map<string, CanonicalSourceNode>();
  const addSource = (reference: EvidenceReferenceV1) => {
    const id = evidenceReferenceKey(reference); if (!sources.has(id)) sources.set(id, { id, state: reference.state, types: reference.sourceTypes, matchId: reference.matchId, roundId: reference.round?.roundId || null, capturedAt: reference.capturedAt, acceptedAt: reference.acceptedAt, reference }); return id;
  };
  const matches: CanonicalMatchNode[] = []; const rounds: CanonicalRoundNode[] = []; const appearances: CanonicalAppearanceNode[] = [];
  for (const { location, container } of containers(data)) for (const match of container?.matches || []) {
    const reference = evidenceReferenceForMatch(data, String(match.id), { workspaceId }); const matchSourceId = addSource(reference);
    const matchRounds = (container.rounds || []).filter((round: any) => round?.matchId === match.id);
    const matchStats = (container.playerStats || []).filter((row: any) => row?.matchId === match.id);
    for (const round of matchRounds) {
      const roundReference = evidenceReferenceForRound(data, String(match.id), { roundId: String(round.id), roundNumber: round.roundNo }, { workspaceId });
      rounds.push({ id: String(round.id), location, matchId: String(match.id), roundNumber: Number.isSafeInteger(round.roundNo) ? round.roundNo : null, sourceIds: [addSource(roundReference)] });
    }
    for (const row of matchStats) {
      const observedName = String(row?.displayNameSnapshot || row?.player || '').trim(); const resolution = resolver.resolve({ playerId: row?.playerId, observedName, includeArchived: true });
      const appearanceSourceId = addSource(appearanceReference(reference, row, resolution.playerId, observedName));
      appearances.push({ id: `appearance:${String(row.id)}`, location, matchId: String(match.id), sourceRowId: String(row.id), playerId: resolution.playerId, identityStatus: resolution.status, observedName, agent: text(row.agent), appearanceType: text(row.appearanceType), sourceIds: [appearanceSourceId] });
    }
    matches.push({ id: String(match.id), location, date: text(match.date), map: text(match.map), opponent: text(match.opponent), state: reference.state, sourceIds: [matchSourceId], roundIds: matchRounds.map((round: any) => String(round.id)).sort(), appearanceIds: matchStats.map((row: any) => `appearance:${String(row.id)}`).sort() });
  }
  const identities = resolver.identities().map(identity => ({ id: identity.playerId, displayName: identity.displayName, aliases: identity.aliases, status: identity.archived ? 'archived' as const : 'active' as const, createdAt: text((data.rosterPlayers || []).find((item: any) => item.id === identity.playerId)?.createdAt), retiredAt: text((data.rosterPlayers || []).find((item: any) => item.id === identity.playerId)?.retiredAt) }));
  const derivedBuilds: CanonicalDerivedBuild[] = Object.entries(data.analyticsBuilds || {}).map(([matchId, build]: [string, any]) => ({ matchId, status: String(build?.status || 'unknown'), sourceHash: text(build?.sourceHash), calculationVersions: [...new Set<string>((Array.isArray(build?.builders) ? build.builders : []).map((value: unknown) => String(value)))].sort() })).sort((left, right) => left.matchId.localeCompare(right.matchId));
  const core = { schema: CANONICAL_DATA_SPINE_SCHEMA, calculationVersion: CANONICAL_DATA_SPINE_VERSION, workspaceId, identities, sources: [...sources.values()].sort((left, right) => left.id.localeCompare(right.id)), matches: matches.sort((left, right) => left.id.localeCompare(right.id)), rounds: rounds.sort((left, right) => left.id.localeCompare(right.id)), appearances: appearances.sort((left, right) => left.id.localeCompare(right.id)), derivedBuilds };
  return { ...core, sourceFingerprint: hash(core) };
}

export type CanonicalSpineIssue = { code: string; reference: string };
export function validateCanonicalDataSpine(spine: CanonicalDataSpine) {
  const issues: CanonicalSpineIssue[] = []; const sourceIds = new Set(spine.sources.map(source => source.id)); const matchIds = new Set(spine.matches.map(match => match.id)); const roundIds = new Set(spine.rounds.map(round => round.id)); const appearanceIds = new Set(spine.appearances.map(appearance => appearance.id)); const identityIds = new Set(spine.identities.map(identity => identity.id));
  const unique = (values: string[], kind: string) => { const seen = new Set<string>(); for (const value of values) { if (seen.has(value)) issues.push({ code: `duplicate-${kind}`, reference: value }); seen.add(value); } };
  unique(spine.sources.map(source => source.id), 'source'); unique(spine.matches.map(match => match.id), 'match'); unique(spine.rounds.map(round => round.id), 'round'); unique(spine.appearances.map(appearance => appearance.id), 'appearance'); unique(spine.identities.map(identity => identity.id), 'identity');
  for (const match of spine.matches) { for (const id of match.sourceIds) if (!sourceIds.has(id)) issues.push({ code: 'missing-source', reference: `${match.id}:${id}` }); for (const id of match.roundIds) if (!roundIds.has(id)) issues.push({ code: 'missing-round', reference: `${match.id}:${id}` }); for (const id of match.appearanceIds) if (!appearanceIds.has(id)) issues.push({ code: 'missing-appearance', reference: `${match.id}:${id}` }); }
  for (const round of spine.rounds) { if (!matchIds.has(round.matchId)) issues.push({ code: 'missing-match', reference: `${round.id}:${round.matchId}` }); for (const id of round.sourceIds) if (!sourceIds.has(id)) issues.push({ code: 'missing-source', reference: `${round.id}:${id}` }); }
  for (const appearance of spine.appearances) { if (!matchIds.has(appearance.matchId)) issues.push({ code: 'missing-match', reference: `${appearance.id}:${appearance.matchId}` }); if (appearance.playerId && !identityIds.has(appearance.playerId)) issues.push({ code: 'missing-identity', reference: `${appearance.id}:${appearance.playerId}` }); }
  for (const build of spine.derivedBuilds) if (!matchIds.has(build.matchId)) issues.push({ code: 'orphan-derived-build', reference: build.matchId });
  return { ok: issues.length === 0, issues };
}

export function serializeCanonicalDataSpine(spine: CanonicalDataSpine) { return canonical(spine); }
