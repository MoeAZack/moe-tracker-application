# Coaching signal registry (S0.3)

Schema identifier: `moetracker.signal-registry/v1` · Implementation: [`lib/signalRegistry.ts`](../lib/signalRegistry.ts) · Tests: [`tests/signalRegistry.test.ts`](../tests/signalRegistry.test.ts)

The registry is a closed, immutable set of coaching-signal definitions. It gives later analytics and review workflows stable exact identifiers without adding a public API, persistence model, signal generator, UI, or thresholds. Lookup is exact: aliases, whitespace, case changes, and unknown/future identifiers are rejected.

## Registered signals

| Identifier | Value / unit | Direction | Evidence expectation |
| --- | --- | --- | --- |
| `economy.pistol-conversion` | percentage of eligible rounds | higher is better | Won pistol plus its known immediate follow-up result. |
| `economy.anti-eco-loss` | losses / eligible anti-eco rounds | lower is better | Denominator includes only rounds where our team is proven full buy, the opponent proven eco/low buy, and the result known. |
| `economy.full-buy-loss` | percentage of eligible rounds | lower is better | Proven team full buy and result. |
| `economy.low-buy-win` | percentage of eligible rounds | higher is better | Proven team eco/low buy and result. |
| `opening.first-death-recovery` | percentage of eligible rounds | higher is better | Team suffered the first death; result is known. |
| `opening.conversion` | percentage of eligible rounds | higher is better | Team secured the first kill; result is known. This is not pistol follow-up conversion. |
| `round.advantage-collapse` | collapses / eligible advantage rounds | lower is better | Denominator includes only rounds where complete ordered life-state evidence proves our team held the configured multi-player advantage and the result is known. |
| `combat.multikill` | occurrence count | higher is better | Complete player-attributed eliminations for the covered round. Two/three/four/ace are dimensions, not separate IDs. |
| `composition.result` | percentage of eligible matches | higher is better | Five observed agents, map, and complete decisive score. Missing or tied scores are unknown. |
| `evidence.incomplete` | evidence-gap count | informational | A fully inspected scope identifies explicit missing, partial, contradictory, or unsupported facts. It is evidence quality, not a performance failure. |

## Envelope and evidence rules

- Every signal metric is an S0.2 `moetracker.derived-metric/v1` envelope and therefore carries workspace scope, sample, coverage, confidence, unknown reason, calculation version, and de-duplicated S0.1 source references.
- Performance signals require accepted source references. `evidence.incomplete` may describe reviewable evidence that is not accepted yet.
- A known value, including observed zero, requires complete declared coverage. Partial coverage is unknown with `incomplete-coverage`; contradictory evidence is unknown with `contradictory-evidence`; an empty sample is unknown with `no-samples`. A partial screenshot showing no events cannot manufacture a zero.
- `signalRecomputationKey` hashes the registry schema, exact signal ID, workspace, caller-supplied cohort/context key, and canonical source identities. It excludes the calculated value and calculation version, so recalculating the same logical signal replaces rather than duplicates it. Different cohorts remain distinct.

## Boundaries

This contract defines names and compatibility only. S0.4 owns active-map-pool filtering, S0.6 owns aggregate-builder migration/versioning, S1 owns summary consumption, and S2 owns review-signal generation, severity, thresholds, persistence, and lifecycle. No current payload or stored record is changed by S0.3.
