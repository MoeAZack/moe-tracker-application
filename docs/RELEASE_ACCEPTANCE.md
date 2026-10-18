# Desktop release acceptance

Last updated: 19 October 2026, 00:52 Cairo (`Africa/Cairo`).

This record distinguishes the current installed coach build from a publicly signed release. Version 0.1.60 is accepted for this PC and merged to `main`; it is **not** claimed as a signed public release or as independently accepted on a second physical PC.

## Accepted installed head

- Main commit: `e7fee3b7e2bde34fdb031e9fd9df32801cfc4763` (PR #62).
- Ordered audit increments merged through PRs #48–62: analytics trust, connected player profiles, unified match review, PRACC practice-to-progress, internal release/adoption readiness, empty-roster economy identity correction, cross-surface data-link consistency, metric-to-round evidence, workspace navigation simplification, and catalog-validated weapon round outcomes.
- GitHub checks on every increment: `verify` passed and `windows-lifecycle` passed.
- Final local verification: lint, type checking, production build, 107 test files and 734 tests passed.
- Automated accessibility audit: desktop/mobile coach and player surfaces passed with zero blocking WCAG 2.2 A/AA violations.

## Windows artifact and upgrade evidence

- Artifact: `Moe-Tracker-Application-0.1.60-Setup.exe`.
- Size: 363,323,955 bytes.
- SHA-256: `EBF82ED1B6202FD164AED5EC00F2B94DA29FDE5A7B351DDF34E0D09994880AC2`.
- Silent in-place upgrades through 0.1.59 and 0.1.60 completed with exit code 0.
- Installed executable: `C:\Program Files\Moe Tracker Application\Moe Tracker Application.exe`.
- Installed product version: `0.1.60.0`.
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

The installed Electron window was then connected through its local debugging endpoint solely for read-only acceptance. The page reported version 0.1.60 and retained the requested sidebar order: **Home**, **Schedule & Goals**, **Performance**, **Review**, **Playbook**, then **Team**. Compositions appeared under Playbook. With Tryouts mode off, Tryout Comparisons was absent from Team and remained available to restore from Settings.

The earlier evidence checks remain applicable: the observed-roster table rendered five profiles; expanding the first displayed 8 exact contributing evidence rows across 8 matches instead of an empty history. Economy under **All matches** and **All rounds** rendered exactly five screenshot-derived player rows with 64 confirmed rounds each. Version 0.1.58 adds exact confirmed-round links for screenshot-derived player metrics and routes those links through the shared VOD review context. Player summary K/D/A, ACS, FK–FD, KAST, record, and expanded metric cards again use semantic color cues rather than an undifferentiated white hierarchy.

Version 0.1.60 rendered 12 catalog-valid equipped-weapon outcome rows from the retained workspace. The table showed winning and losing player-rounds, observed sample size, win rate, K/D, and player coverage. It retained the catalog-valid Bandit category and excluded the unrecognized OCR label `Wardsan` without rewriting source evidence. The inspection session was closed and the installed application restarted normally without the debugging endpoint.

## Public distribution state

- Latest published GitHub release: v0.1.40.
- The release environment and repository currently expose no configured signing secrets.
- Windows reports the installed 0.1.60 executable and installer as `NotSigned`.
- The release workflow correctly refuses publication without `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`, verifies Authenticode before installation, and publishes only after those checks pass.
- Automatic updates remain staged: checking is automatic, while download and restart/install remain explicit user actions.

## External gates still open

1. Obtain a publicly trusted Windows code-signing certificate and configure the protected release secrets.
2. Run install, post-match capture, offline restart, pairing, synchronization, update, rollback, keyboard-only, high-contrast, 200% zoom, and assistive-technology acceptance on a second physical Windows PC.
3. Publish the exact verified signed artifact and confirm the staged update path from the previous public version.

Until those three items have independent evidence, 0.1.60 is the current verified installed coach build—not a fully accepted public release.
