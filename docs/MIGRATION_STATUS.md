# MoeTracker migration status

Canonical direction: the desktop application becomes the offline-first evidence system while the existing website remains the rollback path until desktop parity and synchronization acceptance pass.

## Current milestone

- Phase 0 — desktop foundation: complete.
- Phase 1 — stable local data core: in progress; atomic revision writes, integrity-checked recovery backups, storage bounds, and legacy import exist.
- Phase 2 — local replay automation: implementation complete; clean-machine and extended restart acceptance remain.
- Phase 3 — scoreboard automation: local OCR/crop/review foundation exists; automatic folder matching acceptance remains.
- Phase 4 — identity and role model: player-first and coach-first dashboards plus simple pairing implemented on the review branch.
- Phase 5 — duplicate handling: replay SHA-256 cloud identity and idempotent evidence merge implemented; multi-device acceptance remains.
- Phase 6 — offline/online synchronization: durable outbox/inbox, automatic retry, encrypted pairing credential, and explicit offline/connected modes implemented on the review branch.
- Phase 7 — coach review and fan-out: existing acceptance transaction populates match, player, round, map/economy inputs and review records; wider acceptance remains.
- Phase 8 — portable packages: integrity manifest, preview, conflict preservation, team/player/match/season scopes, and import recovery backup implemented on the review branch; password encryption remains.
- Phases 9–12: not started. The website remains live and unchanged.

## Safety boundaries

- No live game process memory, injection, or live unfair assistance.
- Raw replay files remain local by default.
- Corrections are overlays; accepted raw evidence provenance remains immutable.
- Practice matches may contain all scheduled rounds and are not assumed to stop at 13.
- All displayed scheduling and log times use `Africa/Cairo`.
