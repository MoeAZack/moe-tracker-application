# Delivery roadmap

Last reconciled: 20 October 2026, Africa/Cairo. This status is tied to executable tests and the audit matrix in `AUDIT-COVERAGE-2026-10-20.md`; the release remains unsigned until the external Windows signing gate is completed.

## Integrated coaching intelligence — P0 to P4

- [x] **P0 Canonical coaching decisions** — round-cockpit confirmations and dismissals feed the central Review Inbox; immutable classification history is retained.
- [x] **P1 Evidence fusion and conflict center** — coach, accepted replay, confirmed screenshot, VOD, and manual facts use one persisted field ledger. Conflicts have coach-selectable resolutions with immutable revision history and automatically rebuild affected analytics.
- [x] **P2 Resilient VOD automation** — durable desktop job history, retained sources, multi-game discovery, local-file ingestion, atomic per-frame OCR checkpoints, and restart without repeating completed OCR frames. Failed imports remain failed and resumable rather than being marked complete.
- [x] **P3 Player development and debriefs** — recurring evidence becomes strengths/weaknesses, linked interventions, match debrief actions, and before/after cohorts matched by player, map, agent, and role. Tactical judgments still require coach confirmation.
- [x] **P4 Contextual economy intelligence** — weapon outcomes retain our buy class, enemy buy class, map, side, site, player, and agent with visible sample confidence.
- [x] **Replay spatial intelligence v3** — the owned replay normalizer now emits bounded two-second movement paths plus positioned eliminations/objectives. Accepted evidence drives 2D paths, kill markers, utility timelines, territory, spacing, trade-distance, and cross-match death/utility heatmaps. Official map artwork is shown only with declared map bounds; otherwise a clearly labeled relative/cohort envelope is used.
- [x] **Context-calibrated player ratings v3** — persisted robust median/MAD peer calibration with capped components, small-sample shrinkage, uncertainty, trend, and map/agent/role splits. It is explicitly descriptive and not yet outcome-predictive.

### Next evidence-driven queue

- [ ] P5 Official map calibration assets: independently verified world bounds/orientation per supported map so replay coordinates can overlay official tactical-map geometry rather than the relative cohort envelope.
- [ ] P6 VOD candidate-extraction checkpoints: OCR frames now resume; changed-frame extraction still restarts because its streaming decoder state is not safely serializable.
- [ ] P7 Causal development validation: matched before/after cohorts now exist; add larger role-adjusted controls and significance reporting before attributing improvement to an intervention.
- [ ] P8 Spatial sequence models: execute/retake route clustering and utility-to-space impact, gated by representative coordinate coverage.
- [ ] P9 Predictive rating validation: out-of-sample outcome calibration, drift monitoring, and versioned backtests before any predictive label.

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
- [ ] Signed public release and independent physical-PC/assistive-technology acceptance

## Upcoming — evidence quality and coach workflow

The detailed build order, contracts, acceptance gates, and explicit deferrals for
the coaching SaaS are maintained in [SAAS-COACHING-ROADMAP.md](./SAAS-COACHING-ROADMAP.md).

- [ ] Broaden the varied-match screenshot acceptance set across maps, UI languages, display scaling, and GPU color profiles
- [ ] Add confidence-guided correction for uncertain trade, clutch, and later-kill event rows without blocking reliable FK/FD
- [ ] Add coach-side tryout comparison views and a guided promotion flow from temporary identity to permanent roster member
- [ ] Add scheduled encrypted local backups with restore rehearsal and retention controls
- [ ] Complete a second-PC install, synchronization, update, rollback, and fullscreen-capture acceptance run
- [ ] Complete human screen-reader, keyboard-only, high-contrast, and 200% zoom accessibility acceptance
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
