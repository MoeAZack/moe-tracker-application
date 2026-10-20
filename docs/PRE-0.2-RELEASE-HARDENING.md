# Moe Tracker 0.2 release hardening

The 0.2 release candidate advances only when the current stage has passed its
acceptance gate. A later stage may not weaken an earlier invariant.

## H0 — Referential integrity

Status: READY locally. Exact-head CI is the final merge gate.

Contract:

- A saved round keeps its identity when the same round is edited or reprocessed.
- Removing a round removes or detaches every reference to that round.
- Removing a match deletes match-owned evidence and derived records.
- Coach-authored goals and VOD notes survive match deletion with invalid links removed.
- Only coaches can delete a match.
- An exact immutable source or exact rich confirmed-round payload cannot be accepted twice.
- Scores, dates, maps, K/D/A totals, or short W/L sequences are never sufficient duplicate proof.
- Schema 13 repairs only unambiguous orphan-owned rows and records what it removed.

Acceptance evidence:

- Unit and HTTP coverage for stable IDs, stale IDs, removed rounds, full match purge,
  player authorization, exact-source reuse, exact-round reuse, and migration repair.
- Production database dry-run: 8 matches, 180 rounds, zero integrity errors,
  zero duplicate warnings, and zero records removed by the schema-13 repair.
- Full test, production build, capture dry-run, and accessibility gates must pass.

Gate result (20 Oct 2026): 128 test files / 846 tests passed, production
build passed, five Windows lifecycle suites / 41 tests passed, 24- and
28-round capture dry-runs passed, and the installed database migration dry-run
reported zero integrity errors and zero destructive repairs.

## H1 — Storage v2

Move large replay/VOD/analytics evidence out of the active aggregate payload, add
retention and capacity telemetry, and prove a 100-match season plus archive/restore.

Status: READY locally. Exact-head CI is the final merge gate.

Contract:

- The active database is a small referential index; bulky round evidence,
  aggregate intelligence, parser results, accepted replay drafts, and archived
  evidence collections live in immutable SHA-256-addressed artifacts.
- Reads hydrate artifacts transparently and fail closed on missing, truncated,
  or corrupted evidence.
- Writes commit artifacts before atomically activating their referencing index.
- Local, Firestore, and D1 stores use the same logical contract. Local orphaned
  artifacts receive a configurable 30-day retention window.
- Storage telemetry reports the active index and compressed evidence vault
  separately instead of measuring the hydrated in-memory object as one blob.
- Large season archives remain restorable without crossing the former 800 KiB
  entity ceiling.

Acceptance evidence:

- The current 8-match / 180-round workspace projects from 2,292,213 bytes to a
  245,710-byte active index (89.3% reduction), with 139 deduplicated artifacts
  occupying 289,852 compressed bytes.
- A 100-match / 2,400-round season stays below the former D1 index wall and
  passes archive, externalize, hydrate, and restore round-trip coverage.
- Local atomic commit, missing-artifact failure, corruption detection, and
  retention cleanup have behavior tests.
- Full local gate (20 Oct 2026): 130 test files / 854 tests, production build,
  six accessibility surfaces, and both capture layouts passed.

## H2 — Ingestion reliability

Fix and prove YouTube/local VOD handoff, cleanup, normalized frame selection,
controlled OCR learning, capture behavior, spatial coordinates, and the real corpus.

Status: READY locally. Exact-head CI is the final merge gate.

Contract:

- A downloaded YouTube source is approved for the same trusted renderer session
  that discovered it, so timeline analysis can consume it without a second file
  confirmation.
- Completed downloaded sources are deleted; paused downloads and coach-selected
  local VODs remain resumable and are never deleted by cleanup.
- Frame-change scores and thresholds share a normalized 0..1 scale. Candidate
  frames remain distinct from game boundaries and never inflate the game count.
- OCR aliases require two distinct captures. Field corrections require three
  distinct captures and the same model, layout, resolution, and screen region.
  Coaches can pause learning or reset all local labels.
- Automatic capture may collect a small overtime tail, but printed round numbers
  reconcile duplicate tiles before acceptance. Explicit round-count captures
  still require the exact requested count.
- Normalized map coordinates remain bounded to 0..1. Raw VALORANT world-space
  coordinates may be negative and are calibrated before spatial analysis.

Acceptance evidence:

- The supplied 2 h 49 m 40 s, 1280x720 coach VOD
  (`SHA-256 3e646d...e9f0`) produced exactly three game boundaries at 08:16,
  1:04:48, and 2:05:04. Twenty-four OCR candidates remained candidates rather
  than being reported as 24 games.
- YouTube/live URL normalization, downloaded/local cleanup, cancellation,
  frame normalization, three-game boundary selection, controlled OCR learning,
  negative world coordinates, automatic capture deduplication, and capture
  ground truth have behavior coverage.

## H3 — Metric trust

One authority per metric, explicit unknown values, numerator/denominator/coverage,
enforced sample gates, and experimental isolation for unvalidated composite scores.

Status: READY locally. Exact-head CI is the final merge gate.

Contract:

- Coach-facing rates use one shared publication gate and preserve numerator,
  denominator, coverage, confidence, and the reason a value is withheld.
- Missing match rows never become zero and partial rows never produce complete
  K/D/A, opening, objective, side, split, or win-rate totals.
- Screenshot KAST requires complete survival, event, and assist coverage; a
  successful subset cannot silently replace failed rounds in the denominator.
- Advantage totals count one round once even when it passed through several
  exact advantages; the exact-state breakdown remains available separately.
- The configured minimum sample setting gates coaching signals and map/player
  publications instead of serving as a visual warning only.
- Bandit remains a pistol for economy classification.
- Best-map and player composite scores are disabled by default, explicitly
  experimental when enabled, omit unknown or undersampled inputs, and publish
  no fabricated neutral values, uncertainty bands, or trends.
- The experimental player score requires a complete ten-player cohort with ten
  matches per player; otherwise it remains visibly unrated.

Acceptance evidence:

- Behavior coverage proves incomplete aggregate rows stay unknown, screenshot
  KAST fails closed, multi-state advantages do not triple count, sample gates
  publish only at threshold, and experimental scores reject insufficient data.
- Full local gate (20 Oct 2026): 132 test files / 864 tests, production build,
  six accessibility surfaces with no blocking violations, and both 24- and
  28-round capture layouts passed.

## H4 — Product coherence

Repair role-specific surfaces, evidence correction, navigation, plain-language
labels, and coherent coach/player review workflows.

## H5 — Release candidate

Pin and verify bundled runtimes, exercise desktop IPC journeys, produce a signed
Windows candidate, and pass clean install, upgrade, rollback, updater, and release
acceptance on the exact candidate head.
