# Identity snapshot policy

Schema policy: `moetracker.identity-snapshot/v1`

Roadmap: S0.5

An accepted player appearance has two separate kinds of identity data:

| Field | Meaning | Update rule |
| --- | --- | --- |
| `playerId` | Proven stable roster link used to aggregate one person's appearances. | Preserved independently of names. It is never inferred from an unmatched name. An explicit reasoned correction may change it to an active roster identity or clear it. |
| `displayNameSnapshot` | Name observed when this appearance was accepted. | Write-once. Historical labels prefer it. |
| `agent` | Agent observed for this appearance. | Write-once. |
| `appearanceType` | `core`, `tryout`, or `standIn` for this appearance. | Write-once; later promotion or retirement does not relabel it. |
| current roster name/status | Present-day roster information. | May change and may be shown separately. It is not historical evidence. |

## Creation and legacy rows

New manual, screenshot, capture, and replay appearances record the observed
name and agent at acceptance. A roster selection supplies an explicit
`playerId`; exact-name matching is accepted only when it has exactly one roster
candidate. Ambiguous and unmatched names remain unlinked. Unlinked rows are not
combined merely because their names are equal.

Legacy rows without one or more snapshot fields remain explicit legacy rows.
Routine reads, re-saves, synchronization, roster changes, and archive/reset do
not backfill or destructively rewrite them. Bulk repair/versioned migration is
S0.6, not part of this policy.

## Updates and corrections

`lib/identitySnapshot.ts` is the canonical write policy. Routine match saves,
replay re-acceptance, screenshot-summary synchronization, and desktop inbox
merges preserve the accepted snapshot and stable link. A coach may correct an
observed name, agent, or appearance type only by naming the fields and giving a
non-empty reason in `identityCorrection`. The server appends correction
provenance and ignores client-supplied correction history. A named `playerId`
correction may link another active identity or clear a wrong link; it does not
silently change the observed name, agent, or appearance type.

## Display, aggregation, archives, and access

Historical evidence labels use `displayNameSnapshot`, with the legacy `player`
value only as an explicit compatibility fallback. Analytics aggregate only a
proven `playerId`; each unlinked row remains a separate identity. Evidence
reference resolution keeps its immutable observed identity and exposes current
roster identity separately.

Season archives and archived tryout evidence retain exact appearance rows for
authorized staff. Archival continues to revoke player credentials, devices,
and consent-based access. Player/public projections omit private correction
history and never include season archive bodies.

## Deterministic guarantees

- rename, promotion, retirement, tryout archive, and season reset do not alter
  accepted observed facts;
- routine re-save/re-import is idempotent for identity snapshots;
- duplicate names do not establish a link;
- evidence reference serialization remains stable after roster changes; and
- no roster mutation grants access to archived players.
