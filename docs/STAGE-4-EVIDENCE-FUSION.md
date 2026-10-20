# Stage 4 — one evidence and identity projection

Stage 4 makes replay, confirmed screenshot, VOD, manual entry and coach decisions candidates in one field-level ledger. Raw evidence remains immutable; the accepted projection is rebuilt from the winning candidates.

## Deterministic policy

1. A recorded coach resolution wins and retains every prior revision, actor, time and reason.
2. Accepted replay evidence wins over confirmed screenshot, corroborated VOD and manual entry.
3. Screenshot evidence is eligible only after confirmation. An empty event list is a known zero only when `eventsComplete` is true.
4. Missing, draft or unsupported evidence never becomes zero.
5. Both round facts and player facts use the same candidate/conflict representation and resolution endpoint.

The `moetracker.evidence-fusion/v3` report exposes candidates, alternatives, source, confidence, conflict state and resolution state for every supported field. Player reconciliation conflicts are no longer hidden inside replay materialization. Any player field or reconciliation change also changes the analytics source hash.

## Physical-match deduplication

`physicalMatchIdentity` is deliberately fail-closed. It creates a cross-source fingerprint only when date, normalized map, normalized opponent, both scores and at least five stable player identities are known. The fingerprint is independent of player ordering. VOD linking now checks it before the older heuristic, while the integrity audit reports any existing duplicate physical records.

Incomplete evidence does not guess. It remains a separate review-required item until enough identity exists.

## Accepted identity invariant

Accepted replay overlays are projected through stable roster identities. Review surfaces use reviewed names for accepted rows and round events, while parser IDs remain preserved only in raw evidence. The Stage 0 integrity audit now fails if an accepted materialized player or round fact still exposes an anonymous/parser identity.

## Validation

- Unit coverage: physical fingerprint order independence, fail-closed matching, duplicate audit, accepted identity projection, anonymous leak detection, player/round evidence fusion, draft exclusion and source-hash invalidation.
- Installed disposable workspace: 8 matches, 40 player appearances and 180 rounds; zero duplicate-physical warnings and zero accepted-identity errors.
- No installer was produced for this stage. The user-approved desktop VOD and screenshots remain reusable fixtures for later physical pipeline stages.
