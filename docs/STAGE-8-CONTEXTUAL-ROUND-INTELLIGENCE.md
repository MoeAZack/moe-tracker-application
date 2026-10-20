# Stage 8 — contextual round intelligence

Stage 8 gives every reviewed round one availability-aware intelligence ledger instead of letting replay, VOD and screenshot widgets calculate overlapping facts independently.

## One selected event feed

`contextual-round-intelligence/v1` selects the strongest accepted round timeline. It does not add the same event from replay, VOD and screenshot sources together. The ledger records its contributing sources and independently labels advantage, trade, utility and phase evidence as complete, partial or unavailable.

## Round dimensions

- **Advantages:** exact life states such as 5v3, 3v1 and 2v1 are exposed only from a complete ordered elimination feed with a known outcome.
- **Trades:** replay-provided counts are preferred. Otherwise a complete accepted elimination feed evaluates the existing five-second trade window. Missing evidence produces null, not zero.
- **Utility:** utility casts/effects, orb captures and ultimate uses share one timestamped timeline. Screenshot-derived events now appear when they are the selected complete source.
- **Context:** execute, site entry, rotation, retake, post-plant and round-phase events are shown only when an accepted source explicitly observed them.

The Round Review Cockpit displays these coverage states beside the existing opening, objective, economy and coaching evidence.

## Spatial boundary

Replay-backed coordinates remain in spatial intelligence v3. Territory, teammate spacing and trade distance require explicit coordinates; the app disables those measurements when coordinates are absent. Stage 8 does not infer map positions from video pixels.

## Judgment boundary

The system may report a proven lost advantage, untraded death, economy mismatch or post-plant loss. It does not automatically call a round a throw or assert overpeeking, intent or player blame. Those remain coach-confirmed classifications with audit history.

## Validation boundary

Tests cover exact advantage states, single-feed utility deduplication, five-second trades, execute context and unsupported-as-null behavior. Representative installed replay-coordinate coverage and official map calibration remain later gates.
