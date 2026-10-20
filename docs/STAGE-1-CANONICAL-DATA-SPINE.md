# Stage 1 — canonical data spine and identity resolution

Completed 20 October 2026 (Africa/Cairo). The Stage 1 feature remains default-off until the 0.2 release sequence enables it.

## Contract

`lib/canonicalDataSpine.ts` builds one deterministic, non-writing graph over the active season and retained season archives:

- stable roster identities and immutable aliases;
- matches and their evidence state;
- rounds and their exact evidence references;
- player appearances linked to an observed row and stable player ID;
- canonical screenshot, replay, VOD, manual, live-logger and provider source references;
- versioned derived builds and their source hashes.

Every edge is validated. Missing matches, rounds, appearances, identities, sources, and orphaned derived builds fail closed. Input order does not change the canonical serialization or fingerprint.

`lib/identityResolver.ts` is the shared non-writing resolver for screenshot OCR, VOD scoreboard OCR, replay overlays, current analytics and the canonical spine. Resolution order is:

1. explicit stable player ID;
2. unique exact display name or accepted alias;
3. unique OCR-equivalent name;
4. ambiguous or unresolved—never guessed.

Observed spellings remain immutable. Resolution adds a link; it does not rewrite the evidence label.

## Integration boundary

- Screenshot and VOD scoreboard extraction call the shared resolver through `matchExtractedRosterName`.
- Replay acceptance and accepted-overlay row matching use the shared resolver/key.
- Current analytics archive filtering uses the same OCR-equivalent key.
- Coach data can include the complete canonical graph only when `canonicalDataSpine` is enabled.
- Player and website payloads never receive the graph.
- The Stage 0 integrity gate now rebuilds and validates the graph for every real-data audit.

## Disposable real-data validation

The installed test workspace produced:

| Canonical entity | Count |
| --- | ---: |
| Matches | 8 |
| Rounds | 180 |
| Player appearances | 40 |
| Stable identities | 6 |
| Evidence sources | 228 |
| Versioned derived builds | 8 |
| Unresolved appearances | 0 |
| Ambiguous appearances | 0 |
| Broken graph links | 0 |

This is accuracy evidence only; the test workspace may be reset after the 0.2 program.

## Exit gate

- [x] One stable identity resolver across screenshot, VOD, replay and analytics paths.
- [x] One canonical match/round/appearance/source graph.
- [x] Deterministic fingerprint independent of collection order.
- [x] Source-specific appearance provenance rather than match-only attribution.
- [x] Archive status preserved without leaking archived-only identities into current analytics.
- [x] Derived builds retain calculation versions and source hashes.
- [x] Coach-only, default-off rollout boundary.
- [x] Automated ambiguity, missing-parent, privacy and deterministic-build tests.
- [x] Installed disposable dataset validated with no broken joins.
