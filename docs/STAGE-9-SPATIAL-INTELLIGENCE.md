# Stage 9 — verified spatial intelligence

Closed on 20 October 2026 (Africa/Cairo).

## Delivered

- Added `moetracker.map-calibration/v1`, a fail-closed calibration contract for replay world bounds, orientation, tactical-map asset checksum, verifier and timestamp.
- A draft, revoked, malformed, unchecksummed or unverified calibration cannot activate map artwork or official cross-match comparisons.
- Spatial reports now distinguish `verified-map`, source `declared-map`, and per-replay envelope geometry.
- Cross-match death and utility heatmaps expose verified, source-declared and cohort-aligned coverage separately.
- Added deterministic route clustering using start, centroid and end map cells.
- Added descriptive utility-to-space rows using teammate occupancy in the eight seconds after a positioned utility event.
- Route and utility-space analysis remain unavailable unless coordinates use a verified map calibration. Utility-space output explicitly makes no causal claim.
- The review workspace shows calibration tier, provenance, route clusters and utility-space coverage.

## Evidence boundary

The contract, orientation transforms, trust gate and downstream calculations are automatically tested with synthetic verified fixtures. No production map is marked verified merely because an image exists in `public/maps`. Real map calibration rows still require independently checked replay-format bounds/orientation and an asset checksum. Until those rows are registered, the app correctly labels existing geometry exploratory and does not overlay it on tactical map artwork.

## Acceptance

- Targeted spatial and aggregate suite: 21 tests passed.
- TypeScript compilation: passed.
- Full repository gate: recorded in the Stage 9 handoff.
