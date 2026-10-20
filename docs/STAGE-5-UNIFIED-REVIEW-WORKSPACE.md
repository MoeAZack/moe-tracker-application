# Stage 5 — unified review workspace

Stage 5 closes the review-loop behavior that previously looked like several unrelated panels.

## One context

The shared match and round selection is persisted for the desktop session. `projectReviewContext` is the single read-only projection for match-derived coach analysis: matches, rounds, player rows, VOD reviews/submissions, coaching signals/actions, builds and evidence resolutions move together. Roster and settings context remain available.

Selecting **Review** now saves the `reviewing` state first, then focuses that match without navigating away. **Evidence** is the explicit action that opens the full VOD/replay/round workspace. Match, Replay, VOD and Economy continue to use the same selection.

## Working lifecycle

- Review, Accept and Needs evidence persist their state and update the active button.
- Dismiss writes an auditable reason and moves the item into the recoverable state.
- Recover returns a dismissed item to New.
- Delete is available only after dismissal and suppresses regeneration by fingerprint.
- A failed state mutation does not navigate or pretend the action succeeded.

## Clutter control

Accepted replay history defaults minimized. Integrated fusion/spatial/debrief intelligence also defaults minimized. Round cards start collapsed and expand individually. Evidence details and corrected-revision input remain opt-in.

## Validation boundary

The action lifecycle has server-level tests and the focus/navigation split has a UI contract test. The context projection is tested across every match-derived collection. No installer was produced; the final installed mouse/keyboard/responsive pass remains part of Stage 11, as requested.
