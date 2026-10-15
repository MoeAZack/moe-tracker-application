# Aggregate migration and versioning

Schema: `moetracker.aggregate-migration/v1`
Canonical analytics export: `moetracker.canonical-analytics/v1`
Roadmap: S0.6

Every accepted-match aggregate is built from retained source rows by an
immutable builder identity. `map-round-intelligence/v1` and
`player-screenshot-metrics/v1` are the first registered builders. Their source
fingerprint is the SHA-256 of canonical, key-sorted match and round input; old
materialized output is excluded from that input.

## Migration rules

- Recompute replaces aggregates on the existing match/stat rows. It never
  appends a match, player appearance, or review signal.
- Reordering source rows does not change the fingerprint or output.
- Correcting source evidence changes the fingerprint and replaces the prior
  aggregate under the same match identity.
- Screenshot drafts are excluded. Duplicate match identities fail closed as
  contradictory evidence.
- A legacy aggregate without retained source rows is preserved but marked
  `source-unavailable` in private storage; public, website, and shareable
  projections quarantine it. It is never treated as reproducible input.
- Player screenshot aggregates join only through an explicit stable
  `playerId`. Names never create links, and missing identity snapshots are not
  backfilled. Raw unlinked observations are scoped to their match, so the same
  name in two matches remains two appearances.
- Archived season containers pass through the same migration independently.

Storage schema 3 runs this migration once for older state. Ordinary round saves
use the same adapter, while public projections invalidate stale aggregates by
rebuilding from the current builder and fingerprint.

## Canonical export

`buildCanonicalAnalyticsExport` emits S0.2 derived-metric envelopes with one
calculation version, accepted evidence reference, source fingerprint, sample
coverage, and machine-readable unknown reasons. Empty, partial,
zero-denominator, contradictory, draft, and unsupported legacy inputs therefore
remain distinguishable. Current screens and exports use the same round builder;
they do not reinterpret absent legacy values as zero or a loss.
