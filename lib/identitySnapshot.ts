/**
 * Historical player identity contract.
 *
 * `playerId` is the stable aggregation key. The other fields describe the
 * accepted appearance and are write-once unless a coach submits an explicit
 * correction for the named fields. Legacy rows are deliberately not
 * backfilled here: an absent snapshot stays absent until S0.6 migration work.
 */
export const IDENTITY_SNAPSHOT_FIELDS = ['displayNameSnapshot', 'agent', 'appearanceType'] as const;
export const IDENTITY_CORRECTION_FIELDS = ['playerId', ...IDENTITY_SNAPSHOT_FIELDS] as const;
export type IdentityCorrectionField = typeof IDENTITY_CORRECTION_FIELDS[number];

export type IdentitySnapshotCorrection = {
  fields: IdentityCorrectionField[];
  reason: string;
};

const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

export function historicalPlayerLabel(row: { displayNameSnapshot?: unknown; player?: unknown }): string {
  const snapshot = typeof row.displayNameSnapshot === 'string' ? row.displayNameSnapshot.trim() : '';
  if (snapshot) return snapshot;
  const legacy = typeof row.player === 'string' ? row.player.trim() : '';
  return legacy || 'Unknown player';
}

export function preserveIdentitySnapshot<T extends Record<string, any>>(
  existing: Record<string, any> | undefined,
  incoming: T,
  correction?: IdentitySnapshotCorrection,
): T {
  if (!existing) return incoming;
  const allowed = new Set(correction?.fields || []);
  const result: Record<string, any> = { ...incoming };

  // Linkage is not an observed label and is separately stable. Never replace a
  // proven link during a routine re-save, and never infer one from a name.
  if (!allowed.has('playerId')) {
    if (own(existing, 'playerId')) result.playerId = existing.playerId;
    else delete result.playerId;
  }

  for (const field of IDENTITY_SNAPSHOT_FIELDS) {
    if (allowed.has(field)) continue;
    if (own(existing, field)) result[field] = existing[field];
    else delete result[field];
  }

  // `player` is the legacy evidence label. Keep it aligned with an existing
  // accepted snapshot and otherwise preserve the old legacy value.
  if (!allowed.has('displayNameSnapshot')) {
    if (typeof existing.displayNameSnapshot === 'string' && existing.displayNameSnapshot.trim()) {
      result.player = existing.displayNameSnapshot;
    } else if (own(existing, 'player')) {
      result.player = existing.player;
    }
  } else if (typeof result.displayNameSnapshot === 'string' && result.displayNameSnapshot.trim()) {
    result.player = result.displayNameSnapshot;
  }
  return result as T;
}

export function parseIdentitySnapshotCorrection(value: unknown): IdentitySnapshotCorrection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const fields = Array.isArray(input.fields)
    ? [...new Set(input.fields.filter((field): field is IdentityCorrectionField =>
      typeof field === 'string' && (IDENTITY_CORRECTION_FIELDS as readonly string[]).includes(field)))]
    : [];
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  return fields.length && reason ? { fields, reason } : undefined;
}

/** Merge an accepted row arriving from replay/screenshot synchronization. */
export function mergeAcceptedPlayerStat(existing: Record<string, any> | undefined, incoming: Record<string, any>) {
  return preserveIdentitySnapshot(existing, existing ? { ...existing, ...incoming } : incoming);
}

/** Stable analytics key. Unlinked rows remain separate even when labels match. */
export function playerAggregationKey(row: { id?: unknown; playerId?: unknown }, fallback: string | number = ''): string {
  const playerId = typeof row.playerId === 'string' ? row.playerId.trim() : '';
  if (playerId) return `player:${playerId}`;
  const rowId = typeof row.id === 'string' ? row.id.trim() : '';
  return `unlinked:${rowId || fallback}`;
}
