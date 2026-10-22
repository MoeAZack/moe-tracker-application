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

Status: PASSED (21 Oct 2026, Africa/Cairo) after the re-audit fixes in #86
and the follow-up in #87. #87 closed the four items left by #86's code review:
learned corrections applied by saved-row index, learned aliases missing from
single-screenshot imports, leaked VOD work folders, and PRACC events removed
from the feed. Independent verification of #87 (`VERIFY 3e8e930 — PASS`):
each new behaviour test fails with its fix reverted. The items under
"Deferred" are known and are not claimed as fixed.
The re-audit found 2 of 12 items fixed. The corpus regressions were reproduced on the owner's private
corpus and traced to the scoreboard row offset and tint-normalized portrait
distance (agents), the team-colour score mask (one session's score) and the
removed K/D/A confidence floor (three assist cells). The corpus run now matches
0.1.15 with no wrong cells.

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
- Capture runs with ordinary Windows rights; elevation is requested only when
  the coach marks VALORANT as running as administrator. The standalone
  launcher defaults to automatic round detection.
- A resumed VOD job continues its original job and work directory (frames are
  re-extracted, not reused), and a resumed download is still deleted once
  integrated. A failed resume never deletes the retained source.
- A completed job's work folder is removed, including a local VOD's candidate
  frames; the coach's own video is never deleted. At startup, `source-*`
  folders that no restartable job references are swept, so a download
  interrupted by a crash (its job is marked failed) does not stay on disk.
- `desktop:read-vod-frame` serves frames only to the window that ran the
  discovery.
- Discovery replies name candidate frames instead of inlining every 1080p PNG;
  the renderer reads them one at a time.
- Without a linked scoreboard, kill-feed rows with one of our players count as
  eliminations against an unresolved opponent (never a roster identity).
  Timeline reconciliation is complete only when every player row was checked.
- OCR learning accepts captures saved through the review path. A learned
  correction is tied to the scoreboard row it was read from (0-9), not the
  saved row's position, and edits of an already saved match are never tied to
  a screen region. Single-screenshot imports use the learned aliases, and
  cached extractions are invalidated when a learned alias changes the roster.
- Name-only roster entries match screenshot names again.
- PRACC feeds resolve TZIDs through their VTIMEZONE and X-WR-TIMEZONE data,
  keep all-day dates unshifted, time out after 15 s, and concurrent syncs share
  one run that writes once to a fresh read. An upcoming event removed from the
  feed is removed from the schedule unless it has attendance or a practice
  block; past rows stay, and an empty feed removes nothing.
- Two rifles beside pistols classify as a half buy; the Bandit is a pistol.
- Normalized map coordinates remain bounded to 0..1. Raw VALORANT world-space
  coordinates may be negative and are calibrated before spatial analysis.
- Final scoreboard portraits are matched on the calibrated grid with plain
  colour error; the separator row offset never moves the portrait crop. The
  final score cells use the plain threshold, and a joined K/D/A line below
  confidence 70 leaves kills, deaths and assists unknown.
- Capture FD comes from each round's opening kill on either team and is kept
  only when every round's first death is attributed to exactly one of the ten
  scoreboard rows, so it sums to the round count; otherwise every row's FD
  stays unknown.
- `tests/fixtures/capture-ground-truth.json` `rowLabels` lists cells that must
  stay unknown unless the true value is read;
  `node scripts/ocr-row-label-check.mjs <backtest-out-dir>` fails a run that
  fills one wrongly.

Deferred (unchanged, not claimed as fixed):

- Frame-difference buckets are still sized over the whole video.
- `scripts/scrim-capture.ps1` still keeps the round tail by order and has no
  automatic capture at match end.
- The VOD scoreboard snapshot still reads K/D/A as the last three numbers of a
  row, and kill-feed tracking dedupes unresolved opponents by raw OCR name, so
  a noisy re-read can count twice.
- Learned field corrections are not applied on the single-screenshot path
  (`extractLocalScoreboardDraft` receives no `correctionModel`); only learned
  aliases are.
- PRACC feed removal deletes an upcoming row that has coach notes or required
  players when it has no check-ins, attendance audit or practice block.
- The orphaned VOD work-folder sweep runs only at startup.
- A YouTube download interrupted by a crash is cleaned up, not resumed.

Acceptance evidence:

- The supplied 2 h 49 m 40 s, 1280x720 coach VOD
  (`SHA-256 3e646d...e9f0`) produced exactly three game boundaries at 08:16,
  1:04:48, and 2:05:04. Twenty-four OCR candidates remained candidates rather
  than being reported as 24 games.
- YouTube/live URL normalization, downloaded/local cleanup, cancellation,
  frame normalization, three-game boundary selection, controlled OCR learning,
  negative world coordinates, automatic capture deduplication, and capture
  ground truth have behavior coverage.
- Private 15-session corpus (`Scrim-20261014-*`, headless harness, no roster,
  no learning store), run on the owner's PC; screenshots never leave it.
  Baseline 0.1.15 (`d685d56`): 141/150 agents. Before the fix (`b6f964d`):
  130/150, one score half unknown, three wrong assist cells. At `4c63469`:
  141/150, every agent, score and round identical to 0.1.15, the three
  labelled portraits unknown; the three assist cells were still wrong and are
  fixed by the K/D/A confidence floor. At `8a4bdd9` agents, scores, rounds and
  every K/D/A cell matched 0.1.15; FD was filled in 8 sessions that 0.1.15
  left unknown with sums of 8-14 against 18-32 rounds, fixed by the
  attribution rule above. At `4349259` (VERIFY PASS, 21 Oct 2026): agents
  141/150, every score, round and K/D/A cell identical to 0.1.15, and the
  labelled cells unknown. FD filled in 8 sessions with ΣFD = ΣFK = round
  count, identical across re-captures of the same game; FD stays unknown in
  the other 7. The OCR side of H2 has no wrong cells on this corpus.

## H3 — Metric trust

One authority per metric, explicit unknown values, numerator/denominator/coverage,
enforced sample gates, and experimental isolation for unvalidated composite scores.

Status: PASSED (21 Oct 2026, Africa/Cairo) after #89 (merged as `eaf3d22`;
independent `VERIFY 64045e5 — PASS`: 954/954 tests, 15 of 16 mutations caught
with the one survivor equivalent, 6/6 accessibility surfaces with no blocking
violations). The earlier "READY locally" claim did not survive the re-audit.
All seven re-audit blockers are fixed with behaviour tests:

- KAST had 8 implementations and `metricTrust` had 2 consumers. KAST now has
  one implementation (`publishKast`, `playerRowKastEvidence`,
  `screenshotKastEvidence`), and 15 files read from `metricTrust`.
- Unknown became 0 in Dashboard, Compositions, MapBestStats, AITacticalHub,
  `fd || 0` and the AI coach prompt. All of these now keep unknown values
  unknown.
- The Best Map insight recommended from null scores with the experimental
  toggle off. It now appears only for an enabled score that was computed.
- Tryouts counted toward the ten-player rating cohort. They no longer do.
- Stale v3 ratings were shown as "threshold passed". Ratings are now v5,
  older stored rows are recomputed, and "threshold passed" needs a published
  rating.
- Coaching signals were dropped on refresh. Review state now survives a
  metric change.

Contract:

- Coach-facing rates come from one gate, `publishRate` in `lib/metricTrust.ts`.
  It carries numerator, denominator, coverage (observed/expected sources),
  confidence, and the withheld reason (`no-evidence`, `incomplete-coverage`,
  `no-samples`, `insufficient-samples`).
- Missing match rows never become zero (`knownTotal`), and partial rows never
  produce complete totals. This covers K/D/A, openings, objectives, side
  splits, team K/D, clutches, throws and first deaths, and win rates. Draws
  are undecided, not losses.
- KAST has one implementation. Screenshot KAST counts only when every
  confirmed round has survival, event and assist coverage (`kast.covered ===
  coveredRounds`). A match or row without complete KAST withholds the total;
  a covered subset never stands in for it.
- Advantage totals count one round once even when it passed through several
  exact advantages; the exact-state breakdown remains available separately.
- The configured minimum sample setting (`stats.lowSample`, default 15) gates
  KAST, opening, agent, composition, team and map win rates, best-map score
  inputs and intervals, AI hub clutch and trade rates, and coaching signals.
- Bandit remains a pistol for economy classification.
- Best-map and player composite scores are disabled by default, explicitly
  experimental when enabled, and omit unknown or undersampled inputs. They
  publish no fabricated neutral values, uncertainty bands, recommendations or
  trends. An agent with no observed rows has no proficiency grade, and an
  ungraded pick blocks the draft synergy score.
- The experimental player score's cohort is the non-tryout players (by roster
  status, active tryout batch, row appearance or tryout match) who have ten
  matches and every component observed. Fewer than ten such players leaves
  every player visibly unrated. Stored ratings from another calculation
  version are recomputed.
- A coaching signal keeps its id and review state when its metric moves.
  A triaged signal that is no longer generated is kept, and only untriaged
  ones disappear with their evidence. A deleted signal stays deleted.

Acceptance evidence:

- Behaviour coverage is in `tests/metricPublication.test.ts` (22 tests) and
  `tests/mapBestRosterIdentity.test.tsx`. It proves that incomplete rows stay
  unknown and that screenshot and tryout KAST fail closed. It also proves
  that sample gates publish only at threshold, that the insight and interval
  are off with the toggle, and that tryouts and undersampled players do not
  complete the cohort. Further cases cover stale ratings, review state across
  refresh, and unknown values in the AI coach prompt and AI hub. The
  map-ledger source-grep test was replaced by behaviour tests.
- Fail-without-fix: reverting each fixed library file to `main` fails its new
  tests. The independent verifier caught 13 of 14 mutations on a373ed3; the
  one survivor is equivalent.
- Local gate on the PR head: lint, typecheck, full `vitest run` and the
  production build pass, and CI `verify` and `windows-lifecycle` are green.
  `test:a11y` was not re-run for H3. It runs in the release workflow.

Deferred (recorded, not fixed in H3):

- AI hub proficiency grade bands and draft synergy points are uncalibrated
  heuristics, shown only from observed rows.
- Round-review coaching signals are per-round coach decisions (one sample
  each), so the sample gate does not apply to them.
- Triaged coaching signals that are no longer generated are kept
  indefinitely; there is no auto-archive.
- The per-player headshot rate in the AI hub still averages covered rows
  (`headshotRate`), with its basis shown.

## H4 — Product coherence

Repair role-specific surfaces, evidence correction, navigation, plain-language
labels, and coherent coach/player review workflows.

Status: PASSED (21 Oct 2026, Africa/Cairo) after #91 (merged as `57b40f0`;
`VERIFY 927e2d1 — PASS`) and #92 (merged as `c70c800`; `VERIFY fb014d7 —
PASS`). Independent verification: 973/973 tests, 8 of 8 mutations caught,
`test:a11y` 12/12 surfaces with 0 blocking, and `test:release-ui` with 0
blocking at 100/125/150/200% zoom and in forced colors (3 of 3 runs; 1 on
`main` before #92). The new audit fails on a `main` build at the Back check.
The earlier "READY locally" claim did not survive the re-audit. Re-audit
blockers (all fixed):

- Hash routes use `replaceState`, so Back does not work.
- Replay and Coach Workspace drop the selected round.
- `#/tryouts` redirects Home.
- 27 `alert()` and 26 `confirm()` calls remain.
- The fusion panel shows raw JSON.
- Accessibility gates cover only the login and summary surfaces.

Re-audit fixes (verified):

- Tab and match changes push a history entry; round steps replace. Back and
  Forward are read from `popstate`/`hashchange` without writing a new entry
  (`syncWorkspaceRoute`, `src/utils/workspaceRoute.ts`).
- A link opens any tab its surface and role allow (`routableWorkspaceTabs`).
  Hiding Tryout comparisons in Settings hides only the nav entry, so
  `#/tryouts` opens. Players are still sent off coach-only tabs.
- Coach Workspace Review/Evidence carry the signal's round
  (`signalReviewTarget`) and keep the selected round on the same match
  (`focusReviewContext`); Replay highlights the selected round.
- All 30 `alert()`, 27 `confirm()` and 7 `prompt()` calls go through
  `src/utils/appDialogs` (dismissible notices; labelled modal confirmations
  and prompts; destructive ones name the action and start on Cancel). ESLint
  `no-alert` fails any new browser dialog in `src`.
- The fusion conflict ledger names fields, sources and values in plain
  language; structured values are summarised and never printed as JSON.
- `scripts/accessibility-audit.mjs` adds six installed-app surfaces on
  synthetic data (Coach Workspace, Replay Evidence and Coach Workspace with a
  selected round, Tryout comparisons, VOD Review with evidence fusion open, a
  destructive confirmation) and checks Back, the round link, `#/tryouts`, the
  fusion panel and Escape-cancels behaviour. `A11Y_BROWSER` selects a local
  Chromium.

Contract items already on main, with their evidence:

- Coach round-fact correction: `POST /api/vod/round-review` with
  `factCorrection` (`lib/routes/vodLineup.ts`) requires a reason, stores
  `previousValue`, `value`, `reason`, `at` and `by` on
  `round.reviewCockpit.factCorrections`, then calls `refreshCoachingWorkflow`.
  The VOD Review round cockpit (`RoundReviewCockpit.tsx`, "Correct a round
  fact") is the linked surface. Behaviour coverage:
  `tests/coachingHttp.test.ts` ("stores round review decisions…") checks the
  audited correction with its previous value, a 400 for an invalid value, and
  a 403 for a player session.
- Identity-bound Player Stats: `tests/playerSoloTrackerArchive.test.tsx`
  ("shows a player only their identity-bound profile", "does not expose roster
  mutation to players") and `tests/roleDashboard.test.tsx` ("does not infer an
  unpaired player identity from a matching display name"). Player sessions are
  sent off coach-only tabs by `routableWorkspaceTabs`
  (`tests/workspaceRoute.test.ts`).
- Release UI gate: `A11Y_BROWSER=/opt/pw-browsers/chromium npm run
  test:release-ui` reports 0 blocking findings at 100/125/150/200% zoom (the
  Calendar quick-status button now uses white text on the primary colour). On
  927e2d1 the forced-colors pass still had 1 blocking finding, pre-existing on
  main: `.ui-button-primary` at 1.18:1 (#031c19 on #000). `.ui-button-primary`
  now uses ButtonText/ButtonFace (GrayText when disabled) under
  `@media (forced-colors: active)`; the forced-colors result is recorded by
  the verifier's run.

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

Status: PASSED (21 Oct 2026, 23:29 Africa/Cairo) on the unsigned local
candidate at `e623d39` (after #104), under the owner's signing waiver below.
H0-H5 have all passed. Nothing is tagged, released or uploaded: tagging 0.2.0
and any public installer still need the owner's explicit permission. The
earlier "READY as a local 0.2 release candidate" claim did not survive the
re-audit; these were its blockers, each resolved below:

- 15 public releases are unsigned (latest v0.1.71).
- The updater has no `publisherName` or signature check.
- There is no rollback on a failed first update.
- The release-candidate audit fails open off Windows.
- NSIS install, upgrade and rollback are not exercised in CI.
- The coach JWT is held in the renderer under `unsafe-inline`.

Known limitation (not fixable from 0.2.0): only installers built from 0.2.0 on
leave a copy of themselves in `Local Workspace\Updates\installed`
(`desktop/installer.nsh`). An existing 0.1.x installation has no such copy, so
the first 0.1.x → 0.2.0 automatic update cannot roll back; if 0.2.0 fails its
startup check twice, updates pause in safe mode instead. Every later update
can roll back.

Known limitation (screenshot metrics on unlinked rows): 0.2.0 rebuilds a
player row's screenshot metrics only from round evidence that names the player
by stable roster id; it never joins by observed name. A 0.1.x workspace whose
round evidence is name-only keeps every stored metric untouched (#100), but
each one reads as unknown everywhere, in the coach payload and in every
server-side summary, rating, round-save response and sync (#101). Relinking the
row to a roster player (Player Stats → player → Identity correction) keeps the
stored value and does not bring the metric back, because the round evidence
still carries no id. On the owner's workspace this affects the 5 of 40 player
rows that carried stored metrics; all 900 of our player entries in round
evidence are name-only.

Progress (21 Oct 2026, Africa/Cairo):

- Fixed in #94: the coach JWT stays in the main process, the production CSP has
  no `unsafe-inline`, the updater fails closed without a trusted publisher,
  0.2.0 installers keep a rollback copy, the candidate audit fails closed off
  Windows, and CI runs a real NSIS install → upgrade → rollback.
- Fixed in #96: runtime pins (npm integrity, Electron checksum, yt-dlp
  2026.08.19), a fail-closed tag workflow with a separate publish job, and
  `scripts/workspace-upgrade-check.mts`.
- Fixed in #99–#101: the upgrade check compares reads on source fields and
  requires derived aggregates to agree across reads; a quarantined copy's
  aggregates no longer change on every read of an unsaved workspace; stored
  screenshot metrics that cannot be rebuilt are never deleted and read as
  unknown on every surface.
- Upgrade evidence (owner's retained 0.1.78 workspace, read-only copy, #99 at
  1412334): 8 matches, 180 rounds and 40 player stats in all five snapshots
  (stored, two reads, save, re-read); 1 quarantined duplicate; storage schema
  14 → 15; source content hashes identical across every read; source folder
  byte-identical afterwards; `failures: []`. All 8 matches rebuild; 40 of 40
  player rows have no stable roster link.
- Rollback evidence (owner's PC, simulated, nothing installed): the real
  0.1.78 installer and a local `--publish never` 0.2.0 build. First update with
  no earlier healthy update: prepared with rollback ready, first start
  verifying, second failed start rolled back to 0.1.78 with one launch of the
  pinned 0.1.78 installer, and a tampered rollback installer went to safe mode
  with no launch. `failures: []`.
- Fixed in #104: the release-candidate audit falls back to Windows PowerShell
  5.1 when PowerShell 7 is not installed, and fails the Authenticode inspection
  unless it reads exactly one record with a known status per expected file
  (under 5.1 the old script had produced one malformed record and the unsigned
  audit passed on it).

Signing waiver (owner, 21 Oct 2026 22:07 Africa/Cairo: "dont sign its ok"):
0.2.0 ships without a code-signing certificate. The "signed candidate" item
becomes an unsigned local candidate:

- The candidate is built with `--publish never` at the merge head, and its
  installer SHA-256 and update-manifest SHA-512 are recorded as evidence.
- `desktop/update-trust.json` stays empty, so installed apps keep automatic
  updates blocked; each new version is installed by hand.
- The tag workflow and `scripts/release-preflight.mjs` stay unchanged and fail
  closed (no signing secrets, no trusted publisher), so nothing can publish.
- Windows SmartScreen warns on install ("unknown publisher").
- The release-candidate audit and the `windows-lifecycle` CI job (real NSIS
  install → upgrade → rollback) remain the install and rollback evidence.
- Deferred path: buy a code-signing certificate, add its publisher to
  `desktop/update-trust.json` and the signing secrets to the release
  environment; the existing fail-closed checks then allow a signed release.

Candidate evidence (owner's PC, fresh clone, `npm run desktop:installer`,
`--publish never`, no signing configuration; nothing published or uploaded):

- Head: `e623d39d54f5c7e80e69dc7fad0d8b7bf029ce48`; `git status --porcelain`
  empty before the build, after it and after the audit.
- Installer `Moe-Tracker-Application-0.2.0-Setup.exe`, 343,443,901 bytes:
  SHA-256 `9478260f0ca1892d7171e464213505a463503dd3923211bcf864c7a19e0f6772`,
  SHA-512 `Q9DRqjINaRFz7I8fqbpgkwnCTCvSTsLxCmVJQWb3Yt74RTtJJdyCOt0GKI1hPXurmAW9nryeRWnbtHmXKLNuEg==`
  (base64; equal to both `sha512` entries in `latest.yml`).
- Blockmap, 348,746 bytes: SHA-256
  `26ef504386d55d647c852dc1c7671b3ebc67cb74986a24d43eec3c2441691442`.
- `node scripts/release-candidate-audit.mjs` (no flags) exited 0:
  `exactHead: true`, `dirtyPaths: []`, two Authenticode records (installer and
  unpacked app) both `NotSigned`, `trustedPublishers: []`, `failures: []`,
  `localCandidateReady: true`, `publicReady: false`.

Gate result (21 Oct 2026): the independent verifier checked this evidence
against the waiver contract and passed H5.

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

## Withdrawn: v0.2.0 (2026-10-22)

v0.2.0 was withdrawn on 2026-10-22 at the owner's request. The first start of the
public 0.2.0 installer on a 0.1.x workspace (storage schema 14) migrated the store
to schema 15. Within about 12 seconds the app had written a `db.json` without its
matches, player stats, rounds, coaching signals, ratings and analytics. The
evidence artifact count dropped from 196 to 0, while the artifact sidecar files on
disk were left intact. Settings, roster, schedule and secrets were unchanged. The
owner chose a clean setup over restoring that workspace.

A synthetic schema-14 workspace upgraded through the same 0.2.0 build keeps all
of its data, so the migration alone does not explain the loss. The only code path
that reproduces the exact result is the match purge (`purgeMatchGraph`), run once
per match through match deletion or the duplicate review's discard. What issued
those deletions on the owner's PC is still open. The release stays withdrawn until
that is known, because without it nobody can say another 0.2.0 install is safe.

Why H5 did not catch it:

- The upgrade evidence above ran `scripts/workspace-upgrade-check.mts` at #99.
  The release was built later, after #100 and #101 changed code that runs during
  migration. H5 was not rerun at the release commit.
- The check reads and saves the store module directly. It never starts the
  installed app, so a write made by a startup path after migration is invisible
  to it.
- The `windows-lifecycle` CI job upgrades an empty workspace, not a populated
  schema-14 one.

## Gate for any 0.2.1

No 0.2.1 (or later) installer is published until all of these pass:

- A. The fix carries two tests.
  - A1, upgrade regression: a synthetic, populated schema-14 fixture (matches,
    player stats, rounds, coaching signals, ratings, at least one externalized
    evidence artifact) runs through the built server's first-start sequence, not
    only `readDB`/`saveDB`, and every count is unchanged afterwards.
  - A2, purge burst: deleting every match in a row, through both match deletion
    and the duplicate review's discard, leaves a durable audit entry per purge
    (who, which match, when) and a backup written before the last match goes.
    It fails on the 0.2.0 code.
  If the actor behind the owner's loss is found, the fix covers it with its own
  test. The fix also carries these store guards, each with a test that fails
  without it:
  - An ordinary save that takes non-empty matches, rounds or player stats (as
    stored in the current index) to empty is refused unless the caller passes an
    explicit destructive flag.
  - The first save from a schema older than 15 takes a backup first.
  - Resetting metrics takes a private backup first (or quarantines) and fails
    closed.
  - A missing `db.json` is not silently replaced by an empty store when the
    workspace existed before.
  - A damaged `db.json` is quarantined.
  - The orphaned-evidence sweep never deletes evidence files when the index is
    empty, when its counts disagree with the previous index, or in the process
    that just ran a storage migration.
- B. On the owner's PC, a copy of the real schema-14 workspace (never the live
  one) is upgraded with the exact candidate installer, with its SHA-256 recorded.
  Matches, rounds, player stats, evidence artifacts and coaching signals are
  counted before the upgrade, after first start, after two minutes idle and after
  a restart. All counts must be identical.
- C. The same run from a 0.2.0-wiped copy shows the restore path brings the data
  back.
- D. The commit the upgrade evidence ran on is the commit the installer was built
  from. Any runtime change after the evidence means rerunning it.
- E. A fresh install works end to end. Start from an empty workspace, run the first
  start, import matches, then restart. The counts must stay the same at every step.
  This is the owner's own path.
- F. The owner gives explicit permission to publish.
