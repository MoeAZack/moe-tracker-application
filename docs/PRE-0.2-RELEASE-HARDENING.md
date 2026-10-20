# Moe Tracker 0.2 release hardening

The 0.2 release candidate advances only when the current stage has passed its
acceptance gate. A later stage may not weaken an earlier invariant.

## H0 — Referential integrity

Status: PASSED (20 Oct 2026, Africa/Cairo) after the re-audit fixes in #84.

Contract:

- A saved round keeps its identity when the same round is edited or reprocessed.
- Removing a round removes or detaches every reference to that round.
- Removing a match deletes match-owned evidence and derived records.
- Coach-authored goals and VOD notes survive match deletion with invalid links removed.
- Only coaches can delete a match.
- An exact immutable source or exact rich confirmed-round payload cannot be accepted twice.
- Scores, dates, maps, K/D/A totals, or short W/L sequences are never sufficient duplicate proof.
- Schema 13 repairs only unambiguous orphan-owned rows and records what it removed.
- A same-game re-capture (per round, identical result, win condition and
  ordered killer -> victim list, over at least ten rounds with fully
  identified kill lists) is quarantined, not rejected: it is kept, excluded
  from analytics, ratings and the website, and shown beside the saved game
  until a coach keeps both or discards the copy. The 10-row scoreboard is
  optional: unread cells never let a copy through, but two complete
  scoreboards that disagree keep the games apart. Map label, date, capture
  folder, economy, loadouts and OCR confidence are not part of the
  fingerprint. A further copy quarantines only itself; a coach's keep
  decision stands. Deleting the original releases its copy in the same
  write. Schema 15 flags existing pairs after evidence hydration; nothing is
  deleted automatically.
- A match, its scoreboard and its rounds can be saved in one write; a rejected
  round set saves nothing.
- First-death totals are fill-only. Coach-entered and scoreboard FD values are
  never replaced, a player absent from the round evidence stays unknown, and a
  derived value returns to unknown when its evidence stops being complete.

Re-audit (20 Oct 2026, Africa/Cairo): the external re-audit found the original
duplicate guard missed an OCR-variant re-capture, the post-recompute FD
overwrite survived, and save-match/save-rounds could half-commit. #84 fixed all
three and added the duplicate quarantine described above.

Quarantine mechanism: `sameGameEvidence` (`lib/matchIntegrity.ts`) builds the
round-facts fingerprint and the optional complete-scoreboard key.
`refreshDuplicateQuarantine` runs after save-match, save-rounds, match delete,
VOD submission, replay acceptance and the schema-15 upgrade (after evidence
hydration), and stores a server-owned `duplicateReview` on the later copy.
Quarantined matches are excluded from analytics history, coaching signals,
tryout comparisons, calibrated ratings and the website payload. Coaches decide
through `POST /api/match-duplicate-review` (`keep-both` or `discard-this`) from
the Match Log side-by-side panel.

Acceptance case: the owner's installed 8-match database, where the same game
was captured on 15 and 18 Oct (all 10 scoreboard rows, 168/168 kills and
24/24 win reasons identical; map label, capture folder and four rounds of
economy differ). On #84's head the owner verified that the pair is quarantined
without deletion, the website payload excludes the copy, a re-capture of a
game with two unread scoreboard rows is quarantined, disagreeing complete
scoreboards stay distinct, deleting the original releases the copy, and a
kept-distinct decision survives a third copy. Synthetic stand-ins for these
cases live in `tests/fixtures/sameGameRecapture.ts`; owner data is not
committed.

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

Re-audit gate result (20 Oct 2026): #84 head `a4d8bb7` passed 138 test files /
896 tests, lint, production build and both CI jobs (`verify`,
`windows-lifecycle`), and the owner verified it against the installed database.

## H1 — Storage v2

Move large replay/VOD/analytics evidence out of the active aggregate payload, add
retention and capacity telemetry, and prove a 100-match season plus archive/restore.

Status: PASSED (20 Oct 2026, Africa/Cairo) after the re-audit fixes in #85.
The owner verified e1f0c11 against the installed database (round trip, a
124 KB active index, crafted-reference rejection, externalized
`roundAnalytics`, remote GC and D1 batching, restore over a lost artifact,
and index-only backup restore) and both CI jobs passed on that head.

Contract:

- The active database is a small referential index; bulky round evidence,
  aggregate intelligence, parser results, accepted replay drafts, and archived
  evidence collections live in immutable SHA-256-addressed artifacts.
- Reads hydrate artifacts transparently and fail closed on missing, truncated,
  or corrupted evidence.
- Writes commit artifacts before atomically activating their referencing index.
- Local, Firestore, and D1 stores use the same logical contract. Orphaned
  artifacts on every backend are collected only after a configurable retention
  window (`EVIDENCE_ARTIFACT_RETENTION_DAYS`, default 30) measured from the
  moment they became unreferenced, not from creation. Re-referencing an artifact
  clears its orphan mark, and deletes re-check the mark so a concurrent writer
  cannot lose evidence.
- Externalized fields: round screenshot, replay, VOD and advantage evidence;
  match `roundAnalytics`; player-stat `screenshotMetrics`; VOD submission
  `timelineEvidence`; accepted replay intake screenshot drafts; and archived
  evidence collections.
- Artifact references are server-owned. Any client payload containing an
  artifact reference is rejected with 400, and malformed references fail closed
  on read.
- D1 artifact inserts run in batches of 50 statements. Firestore and D1 keep
  the active revision plus the last 3 inactive revisions for rollback and
  collect everything older (throttled by `EVIDENCE_GC_INTERVAL_MS`, default
  10 minutes per process).
- Local writes fsync the index and artifacts before activation.
- Private backup restore works when the current database has missing
  artifacts: the pre-restore safety backup falls back to the stored index
  (`preRestoreScope: 'index-only'`) instead of refusing the restore, and the
  restore rewrites any artifact deleted outside the store. An index-only
  backup restores by hydrating against the evidence vault; dry-run reports
  `evidenceStatus`, and restore fails closed with 409 naming any artifact the
  vault no longer holds.
- Offline audit scripts (`stage0-baseline`, `stage0-inventory`,
  `stage2-catalog-audit`) read through `readOfflineSnapshot`, which hydrates
  from the evidence vault and runs the post-hydration migrations read-only.
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
- Re-audit coverage: D1 batching and orphan GC with rollback revisions kept,
  Firestore revision and orphan GC, restore over a missing artifact, crafted
  and malformed reference rejection (including over HTTP), round trip of the
  newly externalized fields, and offline snapshot hydration.

Known limits: GC is throttled per process rather than coordinated across
instances; an index-only backup is only as restorable as the vault it points
at; Firestore revisions committed before this change are
not in the committed ledger and are left in place.

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

Status: READY locally. Exact-head CI is the final merge gate.

Contract:

- Every workspace has a stable human-readable URL. Match and round context are
  carried in the link so Review, Replay, VOD, and Economy reopen together.
- A role cannot remain on a surface it cannot use. Player accounts do not see
  the coach roster workspace, and Player Stats is restricted to the identity
  bound to the authenticated player session.
- Coaches can correct an exact saved round field from the linked review surface.
  Every correction requires a reason, preserves the previous value, records the
  coach and time, recomputes coaching workflow state, and cannot be written by a
  player account.
- Replay evidence is summarized as actionable validation, coverage, and player
  counts. Raw internal JSON is not presented as the normal coaching interface.
- Blocking browser alerts are surfaced as dismissible in-app notifications;
  destructive confirmations remain explicit.
- Coach-facing labels describe actions and limitations in plain language while
  preserving the underlying evidence and audit terminology in stored records.

Acceptance evidence:

- Behavior coverage proves URL round-tripping, invalid-route fallback,
  identity-bound player profiles, coach-only audited fact correction, invalid
  correction rejection, readable evidence presentation, and role navigation.
- Full exact-head test, lint, production build, release UI, accessibility, and
  capture gates must pass before H4 is merged.

Gate result (20 Oct 2026): 133 test files / 869 tests passed, type checking and
lint passed, the production build passed, release UI passed at 100%, 125%, 150%,
and 200% zoom plus forced colors with zero blocking findings, all six automated
accessibility surfaces passed, and the 24- and 28-round capture layouts passed.

## H5 — Release candidate

Pin and verify bundled runtimes, exercise desktop IPC journeys, produce a signed
Windows candidate, and pass clean install, upgrade, rollback, updater, and release
acceptance on the exact candidate head.

Status: READY as a local 0.2 release candidate. Public distribution remains
blocked by the external Windows certificate and independent-PC gates below.

Contract:

- The application version is 0.2.0. Electron, Electron Builder, Sharp, FFmpeg,
  FFprobe, yt-dlp, VRFKit, embedded Python, and PyArrow are exact-version pinned.
  Every shipped Windows executable or archive with an owned pin is SHA-256
  verified before packaging. Python and PyArrow can no longer enter the bundle
  through a version-only download.
- Every renderer IPC command is registered exactly once through the trusted
  local-origin wrapper. A packaged fresh-profile journey proves local service,
  session, encrypted credential, settings, ingestion, scoreboard, and recovery
  calls against the actual Electron bridge.
- The 0.1.78 installation upgrades to 0.2.0 without changing the retained
  8-match, 180-round, 40-player-stat workspace. A full binary uninstall followed
  by a clean 0.2.0 install also starts and passes the packaged IPC journey.
- The update controller installs only a completed download. The exact 0.1.78 and
  0.2.0 installers pass last-known-good promotion and two-failed-start rollback.
- Candidate metadata verifies installer/blockmap presence, update-manifest
  SHA-512, SHA-256 evidence, Git head cleanliness, and Authenticode state.
- The tag release workflow requires a valid Windows signing certificate, checks
  the installed signature, runs the packaged IPC journey, and publishes only
  after all checks pass. Missing certificate secrets fail closed.

Acceptance evidence:

- Runtime pins and the bundled runtime manifest pass exact hash verification.
- Desktop IPC/update/recovery behavior passes both focused automated tests and
  the packaged fresh-profile/installed-profile journeys.
- 135 test files / 874 tests, type checking, lint, dependency audit, production
  build, release UI, accessibility, and capture gates must pass on the final head.
- The local installer remains `NotSigned` because no public code-signing
  certificate is configured locally or in the GitHub release environment. It is
  a local test candidate only; the workflow will not publish it as trusted.
