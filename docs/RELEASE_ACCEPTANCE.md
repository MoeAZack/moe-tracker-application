# Desktop release acceptance

Last updated: 19 October 2026, 00:09 Cairo (`Africa/Cairo`).

This record distinguishes the current installed coach build from a publicly signed release. Version 0.1.57 is accepted for this PC and merged to `main`; it is **not** claimed as a signed public release or as independently accepted on a second physical PC.

## Accepted installed head

- Main commit: `5530b85f07a67c8179696b9ffa9c986e3fa7cf45` (PR #57).
- Ordered audit increments merged through PRs #48–57: analytics trust, connected player profiles, unified match review, PRACC practice-to-progress, internal release/adoption readiness, empty-roster economy identity correction, and cross-surface data-link consistency.
- GitHub checks on every increment: `verify` passed and `windows-lifecycle` passed.
- Final local verification: lint, type checking, production build, 106 test files and 727 tests passed.
- Automated accessibility audit: desktop/mobile coach and player surfaces passed with zero blocking WCAG 2.2 A/AA violations.

## Windows artifact and upgrade evidence

- Artifact: `Moe-Tracker-Application-0.1.57-Setup.exe`.
- Size: 363,321,803 bytes.
- SHA-256: `04317DE9D780D8CDA4A61F97C898E31F229418F1C2DD56C39C9CE2F3E8C9A2B7`.
- Silent in-place upgrade from 0.1.56 completed with exit code 0.
- Installed executable: `C:\Program Files\Moe Tracker Application\Moe Tracker Application.exe`.
- Installed product version: `0.1.57.0`.
- Main window, local service, and replay watcher launched from the installed path.
- A timestamped pre-upgrade database backup was created before installation.

## Preserved live workspace evidence

The post-upgrade workspace retained 8 matches and 40 player-stat rows. Each observed player retained all 8 matches and the same aggregate K/D/A:

| Player | Matches | K / D / A |
|---|---:|---:|
| bellatrix | 8 | 123 / 127 / 64 |
| caelia | 8 | 143 / 138 / 37 |
| dexle | 8 | 137 / 113 / 32 |
| majusia | 8 | 155 / 116 / 43 |
| Sandra | 8 | 130 / 113 / 61 |

This verifies preservation on the owner's current PC. It is not evidence for cross-device synchronization or a second-PC migration.

The screenshot-derived economy view was also evaluated directly against the installed workspace after the upgrade. It returns exactly five participants with 64 confirmed rounds each. The former dexle split is reconciled from 54 unlinked rounds plus 10 stable-identity rounds into one 64-round row; no ambiguous same-name identity is merged automatically.

The installed Electron window was then connected through its local debugging endpoint solely for read-only acceptance. The page reported the real `window.moeDesktop` bridge and version 0.1.57. The observed-roster table rendered five profiles; expanding the first displayed 8 exact contributing evidence rows across 8 matches instead of an empty history. Economy under **All matches** and **All rounds** still rendered exactly five screenshot-derived player rows with 64 confirmed rounds each. The future PRACC session opened with zero match checkboxes selected and explained the conservative/overlap policy. Selecting match `x4xdz3oh9`, round 1 in shared context and opening VOD Review displayed that the round was selected but had no confirmed VOD timestamp, rather than implying synchronized seeking. The temporary review filter was cleared, the debugging session was closed, and the installed application was restarted normally without the debugging endpoint.

## Public distribution state

- Latest published GitHub release: v0.1.40.
- The release environment and repository currently expose no configured signing secrets.
- Windows reports the installed 0.1.57 executable and installer as `NotSigned`.
- The release workflow correctly refuses publication without `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`, verifies Authenticode before installation, and publishes only after those checks pass.
- Automatic updates remain staged: checking is automatic, while download and restart/install remain explicit user actions.

## External gates still open

1. Obtain a publicly trusted Windows code-signing certificate and configure the protected release secrets.
2. Run install, post-match capture, offline restart, pairing, synchronization, update, rollback, keyboard-only, high-contrast, 200% zoom, and assistive-technology acceptance on a second physical Windows PC.
3. Publish the exact verified signed artifact and confirm the staged update path from the previous public version.

Until those three items have independent evidence, 0.1.57 is the current verified installed coach build—not a fully accepted public release.
