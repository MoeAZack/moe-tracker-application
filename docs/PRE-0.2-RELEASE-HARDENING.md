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

## H3 — Metric trust

One authority per metric, explicit unknown values, numerator/denominator/coverage,
enforced sample gates, and experimental isolation for unvalidated composite scores.

## H4 — Product coherence

Repair role-specific surfaces, evidence correction, navigation, plain-language
labels, and coherent coach/player review workflows.

## H5 — Release candidate

Pin and verify bundled runtimes, exercise desktop IPC journeys, produce a signed
Windows candidate, and pass clean install, upgrade, rollback, updater, and release
acceptance on the exact candidate head.
