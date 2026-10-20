# Desktop release acceptance

Last updated: 20 October 2026, 14:40 Cairo (`Africa/Cairo`).

Moe Tracker 0.1.78 is the current accepted local release candidate on this PC. It is not a signed public release and has not been accepted on a second physical PC.

## Automated and installed gates

- Type checking, lint, production build, 127 test files, and 837 tests passed.
- Authenticated release UI passed at 100%, 125%, 150%, and 200% effective zoom with keyboard-only navigation, a working skip link, reduced motion, zero horizontal overflow, and zero WCAG 2.2 A/AA violations.
- Windows forced-colors emulation passed with zero violations.
- An encrypted recovery point was created and dry-run restored before upgrade.
- Silent in-place installation completed with exit code 0; the installed product version is `0.1.78.0`.
- Installed Home, team sync, Match Review, Economy, Settings, and Device/Sync/Storage surfaces all passed the current UI contract.
- The retained schema-12 workspace still contains 8 matches, 180 rounds, and 40 player-stat rows with zero integrity errors or warnings.

Machine-readable and screenshot evidence is stored locally under `release/release-evidence` and `release/ui-verification`. The implementation and exact acceptance boundaries are recorded in `STAGE-11-RELEASE-CANDIDATE.md`.

## Windows artifact

- Artifact: `Moe-Tracker-Application-0.1.78-Setup.exe`
- Size: 371,464,653 bytes
- SHA-256: `7FE41EB8FB0E15DCA5BF0B8CAFBEA35A90A0205003665D1CD7C078AAC3FD7EEE`
- Installed executable: `C:\Program Files\Moe Tracker Application\Moe Tracker Application.exe`
- Authenticode: `NotSigned`

## Update, rollback, and synchronization scope

The staged update controller requires a completed download before install. Post-update health promotes a healthy installer as last-known-good, launches it after two failed starts, and enters safe mode when no rollback artifact exists. Recovery-backup, portable package encryption, outbox deduplication, pairing/session security, and ranked-summary synchronization pass their automated contracts. The 0.1.78 upgrade itself was validated on this PC; a full update/rollback/sync run on an independent physical PC remains open.

## Public distribution gates still open

1. Obtain and configure a publicly trusted Windows code-signing certificate, then sign and verify the exact public artifact.
2. Run install, capture, offline restart, pairing, synchronization, update, rollback, fullscreen capture, high contrast, 200% zoom, and screen-reader acceptance on a second physical Windows PC.
3. Publish only that exact signed and independently accepted artifact, then confirm the staged update path from the previous public version.

Official Riot ranked/history integration and licensed opponent/pro telemetry have separate external approval/licensing gates. Until all relevant external gates close, 0.1.78 remains a local release candidate rather than a public production release.
