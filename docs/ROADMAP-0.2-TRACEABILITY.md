# Moe Tracker 0.2 — canonical traceability matrix

Last reconciled: 20 October 2026, Africa/Cairo. This file is the permanent scope ledger for the combined product audit, tracker research, and 0.2 build sequence. A feature is not considered finished because a component exists; it advances only through the gates below.

## Status vocabulary

`Not started` → `Implemented` → `Automatically tested` → `Real-data validated` → `Physically validated` → `Released`.

`Externally blocked` is used when completion depends on Riot approval, licensed data, public code signing, messaging-provider credentials, or another party. It never means the app may invent data or silently bypass the dependency.

## Stage 0 — safety, inventory and rollback

| ID | Requirement | Highest gate | Evidence / next gate |
| --- | --- | --- | --- |
| 0.1 | Frozen eight-match installed-data baseline | Physically validated | `stage0-baseline-2026-10-20.json`; original file hash retained. |
| 0.2 | Complete field, API, component and calculation inventory | Automatically tested | `stage0-code-inventory-2026-10-20.json`; regenerate at every stage boundary. |
| 0.3 | Encrypted pre-upgrade recovery point | Physically validated | Backup `2026-10-20T09-31-21-562Z-2a1b72d44b`; dry-run restore passed. |
| 0.4 | Cross-store invariants and unknown-not-zero policy | Real-data validated | `stage0Integrity.test.ts`; installed workspace passes with no findings. |
| 0.5 | All unfinished 0.2 work behind default-off flags | Automatically tested | `featureFlags.ts`; unknown flags ignored. |

## Stages 1–4 — one canonical evidence system

| ID | Requirement | Highest gate | Evidence / next gate |
| --- | --- | --- | --- |
| 1.1 | Canonical Match, Round, PlayerAppearance, Identity and EvidenceSource records | Real-data validated | Deterministic graph validates 8 matches, 180 rounds, 40 appearances and 228 sources with no broken edges. |
| 1.2 | One identity resolver for OCR, replay, VOD, roster aliases and opponents | Real-data validated | Shared resolver yields 0 unresolved and 0 ambiguous appearances in the installed test workspace. Opponent identity history remains Stage 6 scope. |
| 1.3 | Archive, restore and 60-day purge without current-analytics leaks | Automatically tested | Historical rows remain immutable; physical expiry rehearsal remains. |
| 1.4 | Versioned derived metrics and deterministic rebuilds | Real-data validated | Eight derived builds are linked by source hash/calculation version; canonical fingerprint is order-independent. |
| 2.1 | Dynamic map catalog across pool, stats, compositions and calculator | Automatically tested | Shared runtime catalog drives selectors, zero-evidence rows, map analysis, calculator, compositions, economy and VOD discovery. |
| 2.2 | Dynamic agent catalog across stats and compositions | Automatically tested | Case-insensitive runtime catalog propagates new agents and removes disabled agents from current metrics without deleting history. |
| 2.3 | Dynamic weapon catalog including new weapons and clear artwork | Automatically tested | Warden is catalogued and classified as a full-buy weapon; all media uses deterministic local art with a labelled fallback. |
| 3.1 | One resumable ingestion job for screenshot, replay, YouTube and local VOD | Automatically tested | One persisted state machine, history, progress event and fail-closed restart/cancellation contract now covers all four sources. |
| 3.2 | Multi-map coach/player VOD discovery with per-game matching | Real-data validated | Disposable 2h49m coach fixture separated the expected three games; two map names resolved and one remained explicitly unknown. |
| 3.3 | Incremental OCR/cache invalidation instead of full reprocessing | Automatically tested | Frame checkpoints resume VOD work; bounded screenshot results reuse unchanged image/roster/selection/version keys. |
| 3.4 | Replay parser owned fork, patch compatibility and OCR fallback | Real-data validated | Moe vrfkit fork and fallback path work; representative every-patch corpus remains. |
| 4.1 | Field-level replay/screenshot/VOD/manual evidence fusion | Real-data validated | `evidence-fusion/v3` unifies round and player facts, excludes draft/incomplete evidence, versions coach resolutions and invalidates downstream source hashes. |
| 4.2 | Accepted evidence replaces anonymous IDs in every review surface | Real-data validated | Accepted overlays project reviewed names while raw parser evidence stays immutable; installed-data invariant reports zero leaks. |
| 4.3 | Dedupe same physical match across every ingestion source | Real-data validated | Fail-closed date/map/opponent/score/five-player fingerprint is order-independent; VOD linking uses it and installed-data audit reports zero duplicates. |

## Stages 5–7 — review, analytics and coaching loop

| ID | Requirement | Highest gate | Evidence / next gate |
| --- | --- | --- | --- |
| 5.1 | One review workspace with functional accept, dismiss, restore and delete | Automatically tested | Review persists before focus changes; status, recovery, deletion and evidence navigation have HTTP/UI contract tests. Physical installed-button pass remains Stage 11. |
| 5.2 | Match selection filters every linked review panel | Automatically tested | One pure context projection now drives match-derived coach data; match, replay, VOD, economy and coach surfaces share the persisted match/round selection. |
| 5.3 | Collapsible replay history and dense sections default minimized | Automatically tested | Replay history and integrated intelligence default collapsed; round detail cards remain individually expandable. |
| 6.1 | Player stats by map, agent, side and period with confidence | Automatically tested | Player Stats, contextual ratings and a per-metric accepted-source coverage ledger are integrated. |
| 6.2 | Map calculator incorporates roster performance and sample quality | Automatically tested | `best-map-ledger/v1` publishes every weighted input, sample count, coverage level and neutral fallback. |
| 6.3 | Economy by pistol/mid/full buy, weapon, map, side, site, agent and player | Automatically tested | Contextual economy v2/v3 coverage. |
| 6.4 | Weapons that win rounds, with sample-aware comparisons | Automatically tested | Confirmed equipped-weapon outcomes only; do not infer purchases. |
| 6.5 | KAST, FK/FD, trades, multi-kills, plants, defuses, orbs, ults and HS | Automatically tested | Each metric reports complete/partial/unavailable coverage; known zero is preserved and KAST/multi-kill denominators are explicit. |
| 6.6 | Calibrated descriptive player ratings with uncertainty and drift | Automatically tested | Median/MAD, shrinkage, intervals, trends and context splits integrated. |
| 6.7 | Predictive player ratings | Not started | Requires out-of-sample calibration and drift backtests before any predictive label. |
| 7.1 | Finding → goal/action → owner → next-block verification | Automatically tested | Converting an accepted finding atomically creates an owned action and linked goal; the goal surfaces the comparable next-block outcome. |
| 7.2 | Goals linked to a match, round, player and evidence clip | Automatically tested | Manual and generated goals validate canonical match/round/clip/owner links and fail closed on mismatches. |
| 7.3 | Debrief and team-talk workflows remain distinct but linkable | Automatically tested | Separate event types can be paired symmetrically and show one shared goal/verification outcome chain. |
| 7.4 | Causal intervention claims with role-adjusted controls | Not started | Matched cohorts are descriptive; significance and larger controls required. |

## Stages 8–10 — round, spatial and team operations intelligence

| ID | Requirement | Highest gate | Evidence / next gate |
| --- | --- | --- | --- |
| 8.1 | Advantage states (2v1, 3v1, 5v3, etc.) and conversion/loss | Automatically tested | `contextual-round-intelligence/v1` exposes only complete ordered-feed states and preserves unknown outcomes. |
| 8.2 | Utility, orb and ultimate usage timelines | Automatically tested | One selected accepted feed prevents replay/VOD/screenshot double counting; unavailable values remain null. |
| 8.3 | Trade distance, spacing, territory and execute/retake context | Automatically tested | Round context and five-second trade windows share the contextual ledger; coordinate metrics remain availability-gated in spatial v4. |
| 8.4 | Throws are coach-confirmed judgments, never automatic facts | Released | Observed failures may be suggested, but tactical intent and “throw” labels remain coach decisions with audit history. |
| 9.1 | Replay-backed 2D paths, kill markers and utility timelines | Automatically tested | Spatial pipeline v4 preserves coordinate provenance. |
| 9.2 | Cross-match death and utility heatmaps | Automatically tested | Verified, source-declared and cohort-envelope coverage are reported separately. |
| 9.3 | Official map-bound calibration and orientation | Contract automatically tested | Fail-closed bounds/orientation/asset-checksum/provenance contract is implemented; production maps remain unverified until independent calibration evidence is registered. |
| 9.4 | Route clustering and utility-to-space impact | Engine automatically tested | Calculations activate only in verified map space and remain unavailable for current uncalibrated production evidence. |
| 9.5 | Compositions and playbook with map/agent thumbnails | Implemented | Visual/UI refinement and dynamic-catalog linkage remain. |
| 10.1 | Monthly and hourly day calendar modes | Automatically tested | Both views consume the same canonical event rows; physical responsive/accessibility pass remains. |
| 10.2 | Full-day goals plus repeatable hourly practices/debriefs/team talks | Automatically tested | Atomic series creation, series-content edits and single/series deletion share one server contract. |
| 10.3 | PRACC calendar ingestion | Real-data validated | Provider fields refresh by event ID while coach notes, attendance history and evidence links remain local and durable. |
| 10.4 | Player attendance check-in, late strikes, red/green dots and coach override | Automatically tested | Cairo/DST windows, permissions, append-only correction history and reversible credits are covered. Physical multi-role acceptance remains. |
| 10.5 | WhatsApp, Telegram and Discord notifications | Deferred by product scope | Later integration requires credentials, consent, verified destinations, quiet hours, retry and dedupe; no messages are sent in 0.2 Stage 10. |

## Stage 11 — release candidate and external gates

| ID | Requirement | Highest gate | Evidence / next gate |
| --- | --- | --- | --- |
| 11.1 | Clean dashboard/navigation and coherent collapsible UI | Automatically tested | 100/125/150/200% reflow, skip-link and keyboard navigation pass with zero overflow; the installed 0.1.78 Home, review, economy and settings surfaces were verified. |
| 11.2 | Accessible Windows desktop release | Automatically tested | WCAG 2.2 A/AA, reduced motion and Windows forced-colors gates pass with zero violations; a human screen-reader/high-contrast run remains external. |
| 11.3 | Install, update, rollback and second-PC sync | Automatically tested | In-place 0.1.78 installation and retained real-data integrity pass on this PC; update/rollback/sync contracts pass in isolated profiles. Independent physical second-PC evidence remains. |
| 11.4 | Signed public Windows installer | Externally blocked | Requires a public code-signing certificate. |
| 11.5 | Official Riot ranked/history integration with opt-in | Externally blocked | Production API/RSO approval and eligible product scope required. |
| 11.6 | Licensed opponent/pro telemetry | Externally blocked | Requires licensed source/terms; no scraping. |

## Non-negotiable release invariants

- No duplicate accepted physical match.
- No current metric can reference a deleted/archived-only identity.
- No derived metric exists without a traceable source and calculation version.
- Missing or unsupported evidence is never represented as zero.
- Raw historical evidence is immutable; current projections may exclude it without deleting it.
- Coach judgment is visually and structurally distinct from observed fact.
- A stage cannot advance by fixture-only tests: automated, installed real-data, and physical UI gates remain separate.
