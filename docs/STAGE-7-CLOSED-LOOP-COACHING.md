# Stage 7 — closed-loop coaching

Stage 7 connects accepted evidence to work the team can own and verify later.

## Finding to goal and action

Converting an accepted review finding now creates two linked records in one saved operation:

- a coaching action with the immutable source evidence, owner IDs, priority, target and next-block evaluation policy;
- a visible practice goal carrying the source signal, action, owner, match, round and first local evidence clip when available.

The generated goal appears in Schedule & Goals without manual re-entry. Its card shows the action state and the comparable next-block result as satisfied, regressed or still awaiting enough evidence.

## Manual goal evidence

The goal editor can link a canonical match, then one of that match's rounds, then a local clip attached to that round. It stores the stable player ID alongside the display name. The server rejects a retired owner, a round from another match, or a clip from another round.

## Team Talk and Debrief

Team Talk and Debrief remain distinct calendar types. Either can be linked to the other; the server writes the relationship symmetrically and clears the old reverse link when it changes. The schedule card then shows their combined linked goals and how many were completed, verified or regressed.

## Lifecycle and cleanup

Player deletion removes player-owned actions and their generated goals so no live coaching metric retains an erased identity. Sync/export projections include the new evidence links. Raw match, round and clip evidence is not mutated by the coaching workflow.

## Validation boundary

Pure tests cover goal generation, round/clip provenance, next-block projection and paired-session outcomes. HTTP tests cover atomic action/goal creation, symmetric event pairing and fail-closed goal links. Causal claims remain deliberately unavailable until matched controls and out-of-sample evidence are sufficient.
