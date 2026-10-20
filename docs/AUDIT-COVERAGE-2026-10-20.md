# Full audit coverage — 20 October 2026

This matrix is the release acceptance record for the requested P0–P4, replay spatial analysis, heatmaps, and player ratings. A checked row means the data is persisted, consumed by the UI, and covered by an automated test. It does not mean unsupported evidence is guessed.

## Accepted in 0.1.77

| Contract | Implemented data path | Acceptance evidence |
| --- | --- | --- |
| P0 canonical coaching decisions | Round classifications, confirm/dismiss history, Review Inbox, linked actions and debriefs share stable IDs and persisted audit history. | Coaching workflow and round cockpit suites. |
| P1 evidence fusion | Manual, confirmed screenshot, accepted replay, VOD and coach decisions produce a persisted conflict ledger. A selected resolution changes the source fingerprint and downstream round/economy analytics. | `aggregateVersioning.test.ts` resolution-propagation test. |
| P2 resilient VOD | Source retention, job stages, local/YouTube inputs, atomic OCR-frame checkpoints, restart, and correct failed/completed job states. | `integratedIntelligence.test.ts` checkpoint/release contract plus VOD suites. |
| P3 development | Evidence-linked strengths/weaknesses, debrief actions, signal-specific before/later outcomes, and player/map/agent/role matched follow-up cohorts. | `integratedIntelligence.test.ts` intervention cohort test plus coaching workflow suites. |
| P4 economy | Confirmed equipped-weapon outcomes segmented by map, side, site, our buy, enemy buy, player, and agent with sample confidence. | Contextual economy and archived-player suites. |
| Replay 2D | Owned normalizer emits bounded two-second movement samples and positioned replay events. Accepted records produce paths, kills/deaths, utility timeline, territory, spacing, and trade distance. | Spatial world-coordinate and replay-opening tests. |
| Cross-match heatmaps | Death and utility cells are aligned per map. Verified bounds use map space; otherwise all same-map replays share one explicit cohort envelope. | Cross-match heatmap test and rendered heatmap grids. |
| Player ratings | Robust median/MAD team-peer calibration, capped component influence, shrinkage to 50, uncertainty interval, trend, and map/agent/role context. | Integrated rating test and Player Stats UI. |

## Evidence boundaries still open

- Production map calibration coverage: the fail-closed v1 contract now verifies bounds, orientation, asset checksum and provenance before enabling artwork, official heatmaps, route clusters or utility-space rows. Each real map still needs independently verified calibration evidence; relative replay geometry remains exploratory until then.
- External team notifications: schedule and attendance operations are coherent locally, but WhatsApp/Telegram/Discord delivery remains intentionally unavailable until credentials, consent, destinations, quiet hours and retry/deduplication rules are configured.
- Predictive validation: ratings are calibrated to the current team cohort, but are descriptive. They are not advertised as win prediction, hidden MMR, or universal player rank.
- VOD decoder checkpointing: completed OCR frames resume. The FFmpeg changed-frame extraction stage restarts because a streaming decoder cannot safely resume from an arbitrary byte state.
- Real-corpus replay coverage: the parser path and normalized contracts are tested, but representative retained replays across every current map/patch remain an acceptance task.
- Windows trust: the installer remains unsigned and still needs a physical-PC, screen-reader, high-contrast, and 200% zoom acceptance pass.
- External delivery: Discord/Telegram/WhatsApp delivery, quiet hours, retries, and deduplication remain future integrations.

No open boundary above silently disables the accepted features. When required evidence is missing, the relevant UI shows unavailable/relative status instead of inventing data.
