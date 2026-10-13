# MoeTracker migration status

Canonical direction: the desktop application becomes the offline-first evidence system while the existing website remains the rollback path until desktop parity and synchronization acceptance pass.

## Current milestone

- Phase 0 — desktop foundation: complete.
- Phase 1 — stable local data core: in progress; atomic revision writes, integrity-checked recovery backups, storage bounds, and legacy import exist.
- Phase 2 — local replay automation: real-replay packaged acceptance passed; clean-machine and extended restart soak remain.
- Phase 3 — scoreboard automation: watched-folder intake, local OCR, crop fallback, exact K/D/A replay matching, and review queue are implemented; real varied-screenshot acceptance remains.
- Phase 4 — identity and role model: player-first and coach-first dashboards plus simple pairing implemented on the review branch.
- Phase 5 — duplicate handling: replay SHA-256 cloud identity and idempotent evidence merge implemented; multi-device acceptance remains.
- Phase 6 — offline/online synchronization: durable outbox/inbox, automatic retry, encrypted pairing credential, and explicit offline/connected modes implemented on the review branch.
- Phase 7 — coach review and fan-out: existing acceptance transaction populates match, player, round, map/economy inputs and review records; wider acceptance remains.
- Phase 8 — portable packages: integrity manifest, preview, conflict preservation, team/player/match/season scopes, import recovery backup, and optional local-only password encryption are implemented; cross-PC acceptance remains.
- Phase 10 — Windows release: branded installer/executable, system tray, single-instance background operation, silent optional start with Windows, installer/uninstaller, replay watching, background retry, retention controls, and rotating local-only crash diagnostics are implemented. Isolated clean-install, in-place upgrade with preserved device/user data, and uninstall-with-preserved-user-data acceptance passed on Windows; automatic updates/rollback and another-player-PC acceptance remain.
- Phases 9, 11 and 12: not started. The website remains live and unchanged.

## Safety boundaries

- No live game process memory, injection, or live unfair assistance.
- Raw replay files remain local by default.
- Corrections are overlays; accepted raw evidence provenance remains immutable.
- Practice matches may contain all scheduled rounds and are not assumed to stop at 13.
- All displayed scheduling and log times use `Africa/Cairo`.
