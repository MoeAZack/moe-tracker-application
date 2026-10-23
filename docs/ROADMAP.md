# Delivery roadmap

Last reconciled: 22 October 2026, Africa/Cairo. Version 0.2.0 is published
(unsigned). The owner picked stages R1 to R4 from the second audit; R5 was not
picked. Older sections below are kept as the record of what shipped.

## Direction — the VOD is the primary source

Set by the owner on 23 October 2026. A full coach VOD shows the whole game, so a
VOD alone should produce a complete match: the final score, every round and its
winner, and every kill, death and assist from the kill feed. Later it should also
give player positions and moves, drawn on a 2D map. A scoreboard screenshot, a
mid-game TAB board, the end screen and a replay file are layers that confirm or
correct the VOD numbers. They are not required before a match can be saved.
Several POVs of the same game merge, each filling what another missed.

- [x] Kills and deaths from the kill feed when no board is read (a board still wins)
- [x] End screen and last HUD score (partial when the game is cut off)
- [ ] TAB boards found on the 720p coach view, used to correct the kill-feed tally (detector tightened in #175, untested on the PC)
- [ ] Assists, round winners and round count from the VOD
- [ ] Multi-POV merge: one match per game, each submission's timeline fused (`fuseVodEvidence` is the seam)
- [ ] 2D replay of positions and moves (not started)

## Handoff — state and next steps (23 October 2026)

Written for whoever continues the project. Main is the source of truth; the
owner's PC builds installers locally (no public release since 0.2.0; 0.2.1 at
fa964bd was never published). Rules that still hold: never delete matches from
the owner's database (quarantine or copy first), nothing from the owner's PC
(screenshots, database, real player names) goes into the repo, no code signing,
no public installer or tag without the owner's explicit permission, OCR runtime
changes under `lib/` and `src/` need the PC corpus gate (corpus14 vs
baseline-b1e8e12: 0 cell diffs, 0 false accepts).

**Works (checked on the owner's PC):** scoreboard screenshot import with
Tesseract (28/31 K/D/A at 1080p) or the built-in PaddleOCR number reader
(31/31); VOD import of a coach VOD splits one match per game (VOD 1 gave 3
games, starts 48, 3752, 7408 s); the end screen reads both layouts ("ALLIES 7 –
17 ENEMIES" and "9 DEFEAT 15"), G1 read 7–17; kill-feed K/D tally; the
five-picker when no board names our players; editable game cards; local
evidence frames.

**Fails or is weak (numbers from the PC runs on 7d75719):**
- TAB boards: on 7d75719 the detector passed 66 of 74 sampled frames and only
  the first 12 were tried, so real boards were missed; 27 of 42 numbers read as
  "1"; 4 of 94 rows named our players. The fix in PR #175 (fixed board height,
  all ten rows, empty ULTIMATE–K gap over the block 0.317–0.683, no try cap,
  the 1s rule only for blank reads) is untested on the PC. Ground truth for the
  next PC check, TAB openings as start second (all the same layout, HUD on top,
  0.25–4.5 s each): VOD 1 717, 1713, 2782, 4714, 5021, 5194, 8277–8293, 8441,
  8539, 8598, 8772, 8883, 9017, 9505; VOD 2 986, 1316, 1335, 1440, 1470, 1571,
  2140, 4184, 4196, 4272, 4287, 4297, 4373, 4499, 4520, 4779, 5096, 5116, 5124,
  5381, 5400, 5479, 5757, 5869, 5896, 6110, 6116, 6205, 6457, 6582, 6608, 7672,
  7957, 8319, 8373, 8454; VOD 3 637, 1117, 1222, 1368, 1531, 1579, 1597, 1787,
  2541, 3007, 6407, 7978. The detector should fire at those and nowhere else.
- HUD score: bare-score reads often miss the left number (hud-tail "4 *",
  "* 1" at 3663–3713 s on VOD 1). Next fix: measure the two HUD score digit
  boxes on a 720p coach frame and read each box glyph by glyph like the end
  banner (`readBannerDigits`, `narrowGlyph`). G2 and G3 have no end screen (G2
  ended on a network problem at 12–12, G3 is cut off at 12–11), so their score
  depends on this.
- Rounds: 3, 6 and 5 rounds detected per game; should be about 24. Round
  winners and count from the HUD score changes are the next step after the HUD fix.
- Names on TAB rows: matching is fuzzy (`orderedNames`, closest wins); recheck
  once boards read.
- The trial VODs are not imported into the live app yet; that waits on a PC run
  that reads G1 7–17 and real TAB numbers.
- Open PRs #161 (HUD orientation per video) and #162 (evidence frames) are green
  but need a rebase onto main before review.

**Order of next work:** 1) PC rerun of VOD 1 and 2 on #175's merge, compare
against the timestamps above; 2) per-digit HUD score read; 3) rounds and round
winners from HUD changes; 4) import the three trial VODs live on a copied
profile first; 5) multi-POV merge; 6) the "Moe OCR" ensemble default only if it
beats Tesseract on the corpus (it did not: 28/31 and 25/31).

## Current — after 0.2.0

- [ ] **R1 Clean house**
  - [x] Screen error boundary: one failing screen no longer blanks the app
  - [x] Private roster data out of the tree; synthetic names in tests
  - [x] `AUTONOMY.md` rewritten for real data and the current gates
  - [x] Old Google code removed: Firestore, Cloud Storage, Google sign-in, Firebase stub
  - [ ] Git history purged of the old `db.json` (runs on the owner's PC)
  - [ ] Dead integrations removed: GRID key, HenrikDev, VLR, ranked-sync prototype
  - [ ] Fonts bundled with the app; unused packages removed
  - [ ] PRACC rows with coach work kept and flagged instead of deleted
  - [ ] Map Analysis copy and small-sample markers; Compositions empty state; Roster open; "Unknown" pistol results
  - [ ] Docs describe the current release, storage and replay paths
- [ ] **R2 One product**: 7 destinations instead of 16 tabs, AI hub out of Coach Workspace, one strat editor, Live Logger folded into Record match, one visual system and product name, a source chip on every stat
- [ ] **R3 Coach loop**: strategy board, VOD jumps to the round, drawing on a frame, tasks from a round, automatic practice summary, batch video import, synced multi-POV review
- [ ] **R4 OCR evidence loop**: replay-joined labels, false-accept report, more scoreboard layouts, single-screenshot corrections; every OCR change passes the `d685d56` zero-diff gate on the owner's corpus

## Integrated coaching intelligence — P0 to P4

- [x] **P0 Canonical coaching decisions** — round-cockpit confirmations and dismissals feed the central Review Inbox; immutable classification history is retained.
- [x] **P1 Evidence fusion and conflict center** — coach, accepted replay, confirmed screenshot, VOD, and manual facts use one persisted field ledger. Conflicts have coach-selectable resolutions with immutable revision history and automatically rebuild affected analytics.
- [x] **P2 Resilient VOD automation** — durable desktop job history, retained sources, multi-game discovery, local-file ingestion, atomic per-frame OCR checkpoints, and restart without repeating completed OCR frames. Failed imports remain failed and resumable rather than being marked complete.
- [x] **P3 Player development and debriefs** — recurring evidence becomes strengths/weaknesses, linked interventions, match debrief actions, and before/after cohorts matched by player, map, agent, and role. Tactical judgments still require coach confirmation.
- [x] **P4 Contextual economy intelligence** — weapon outcomes retain our buy class, enemy buy class, map, side, site, player, and agent with visible sample confidence.
- [x] **Replay spatial intelligence v4** — accepted coordinates drive paths, kill markers, utility timelines, territory, spacing, trade-distance, and heatmaps. Verified map space now requires bounds, orientation, an immutable asset checksum and independent provenance; source-declared and cohort-envelope geometry stays explicitly exploratory.
- [x] **Gated spatial sequences** — route clusters and descriptive utility-to-space occupancy are implemented and automatically tested, but activate only for verified map calibrations with representative coordinate samples.
- [x] **Team operations v2** — monthly/day schedule views now share atomic repeated-series mutations, PRACC-owned fields are protected from local drift, coach notes survive sync, and attendance corrections retain an append-only audit trail.
- [x] **Context-calibrated player ratings v3** — persisted robust median/MAD peer calibration with capped components, small-sample shrinkage, uncertainty, trend, and map/agent/role splits. It is explicitly descriptive and not yet outcome-predictive.

### Next evidence-driven queue

- [ ] P5 Production map calibration evidence: the verified calibration contract and downstream gate are complete; independently verify and register bounds/orientation/checksums per supported map before tactical-map overlays activate.
- [ ] P6 VOD candidate-extraction checkpoints: OCR frames now resume; changed-frame extraction still restarts because its streaming decoder state is not safely serializable.
- [ ] P7 Causal development validation: matched before/after cohorts now exist; add larger role-adjusted controls and significance reporting before attributing improvement to an intervention.
- [x] P8 Spatial sequence engine: route clustering and descriptive utility-to-space impact are implemented; production results remain evidence-gated until P5 coverage exists.
- [ ] P9 Predictive rating validation: out-of-sample outcome calibration, drift monitoring, and versioned backtests before any predictive label.
- [ ] P10 Consented team notifications: add verified WhatsApp/Telegram/Discord destinations, quiet hours, idempotent retry and delivery receipts only when provider credentials and player consent are available.

## Now — functional desktop foundation

- [x] Clean public repository and desktop product identity
- [x] Electron desktop shell with isolated preload bridge
- [x] Local-only application server and atomic local database
- [x] Automatic VALORANT and manual replay-folder discovery
- [x] One-click match processing entry point
- [x] Scoreboard, replay, export, and backup folders
- [x] Portable team export
- [x] Persist normalized local replay evidence before any upload
- [x] Local review inbox and identity overlay
- [x] Import/export `.moetracker` packages with integrity hashes
- [x] One-button post-match timeline capture with automatic review opening
- [x] Local recognition for the complete current VALORANT agent roster
- [x] Screenshot-derived FK/FD, weapon, economy, multi-kill, map, and composition evidence
- [x] Temporary tryout identities that preserve analytics before the permanent roster is selected
- [x] One-click support bundle with diagnostic logs and recent capture evidence

## Next — reliable team synchronization

- [x] Simple team pairing code for player and coach devices
- [x] Durable local outbox with retry and idempotency keys
- [x] Cloud summary contract and replay-hash deduplication
- [x] Coach acceptance on any authorized coach device
- [x] Website reduced to accepted statistics and basic team information
- [x] Sync status, conflict review, and offline indicators

## Then — polished Windows release

- [x] Background tray behavior and automatic startup option
- [x] Staged automatic update channel with post-update health verification and cached last-known-good rollback
- [x] Configurable 30-day replay retention and storage budget
- [x] Encrypted scheduled local backups
- [x] Windows installer and in-place upgrade acceptance in isolated Windows profiles
- [x] Automated WCAG 2.2 A/AA audit for desktop/mobile login and authenticated summary surfaces
- [x] Release-workspace keyboard, reduced-motion, forced-colors, and 100/125/150/200% reflow gate
- [x] 0.1.78 same-PC in-place install with encrypted recovery point and retained-workspace integrity check
- [ ] Signed public release and independent physical-PC/assistive-technology acceptance

## Upcoming — evidence quality and coach workflow

The detailed build order, contracts, acceptance gates, and explicit deferrals for
the coaching SaaS are maintained in [SAAS-COACHING-ROADMAP.md](./SAAS-COACHING-ROADMAP.md).

- [ ] Broaden the varied-match screenshot acceptance set across maps, UI languages, display scaling, and GPU color profiles
- [ ] Add confidence-guided correction for uncertain trade, clutch, and later-kill event rows without blocking reliable FK/FD
- [ ] Add coach-side tryout comparison views and a guided promotion flow from temporary identity to permanent roster member
- [ ] Add scheduled encrypted local backups with restore rehearsal and retention controls
- [ ] Complete a second-PC install, synchronization, update, rollback, and fullscreen-capture acceptance run
- [ ] Complete independent human screen-reader/high-contrast acceptance (keyboard-only and 200% automated gates pass)
- [ ] Obtain a public Windows code-signing certificate and publish the signed installer through the staged update channel
- [x] S0 — Stabilize canonical evidence references, metric envelopes, and signal identifiers
- [x] S1 — Generate an accepted-evidence practice-block summary after capture
- [x] S2 — Turn detected review signals into an evidence-linked coaching inbox
- [x] S3 — Carry reviewed findings into assignments and next-block verification
- [x] S4 — Add player, tryout, teammate, period, agent, side, and map comparisons
- [x] S5 — Add configurable coach-dashboard presets and saved layouts
- [ ] S6 — Tray-first capture implementation is complete; public signing and second physical-PC acceptance remain release gates
- [ ] S7 — Add bounded team notifications and Discord delivery

## Later

- [ ] Official Riot opt-in/API integration if the product is approved
- [ ] Optional coach-requested temporary raw upload
- [x] Clip extraction from locally available VOD evidence
- [x] S8 — Evidence-gated replay-backed 2D spatial intelligence (coordinate-free replays remain explicitly unsupported)
- [ ] S9 — Evaluate licensed public opponent intelligence after the private workflow is reliable
- [ ] Never: process-memory inspection, injection, or live unfair assistance
