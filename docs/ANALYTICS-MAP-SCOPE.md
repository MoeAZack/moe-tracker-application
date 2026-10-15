# Analytics map scope contract

S0.4 defines a view-only map scope for current-performance analytics. It does
not change stored matches, evidence, settings, synchronization, or public
payloads.

## Modes

- **All recorded / practice maps** is the default. Analytics include every
  match in the already-selected core/tryout/history phase. The map universe is
  the case-insensitive, whitespace-trimmed union of configured active maps,
  configured rotated maps, and maps observed in those matches.
- **Configured active map pool** is an explicit user choice. Analytics include
  only matches whose normalized map appears in `settings.maps`. The choice is
  local view state and is not persisted for the team.

Every current-performance route receives the same pure projection: Dashboard,
Economy, AI coaching/comparisons, Map Analysis, Compositions, roster/player
analytics, and the corresponding website summaries. Existing tryout and
archived-phase filtering happens before map scope is applied.

## Deterministic boundaries

- Map comparison trims surrounding whitespace and ignores case.
- Duplicate map names collapse to one canonical display name.
- If a normalized map appears in both active and inactive settings, its
  explicit active status wins and the UI reports the conflict.
- An empty active list produces an honest zero-match active-pool projection; it
  never falls back to all maps.
- Blank or unconfigured match maps remain visible in All mode as observed or
  `Unknown map`, and are excluded with a visible count in active-pool mode.
- The projection returns new view objects where normalization is needed and
  never mutates its input.

## Evidence boundary

Match Log (desktop and website), Replay Evidence, VOD Review, Lineup Library,
strategy/evidence libraries, and season archives use the unfiltered workspace
data. Rotating or disabling a map therefore cannot hide or delete historical
evidence. Portable and public raw payload generation is unchanged.
