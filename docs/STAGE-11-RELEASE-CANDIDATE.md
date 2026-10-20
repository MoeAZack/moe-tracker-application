# Stage 11 — release candidate and external gates

> Historical 0.1.78 acceptance record. The current 0.2.0 H5 candidate and its
> remaining public-signing gates are recorded in `RELEASE_ACCEPTANCE.md` and
> `PRE-0.2-RELEASE-HARDENING.md`.

Accepted on 20 October 2026, 14:40 Cairo (`Africa/Cairo`).

Stage 11 produces a locally installable Moe Tracker 0.1.78 candidate and closes the gates that can be proven on this PC. It does not mislabel an unsigned build as a public release and does not simulate Riot approval, licensed telemetry, another physical PC, or a human assistive-technology review.

## Candidate evidence

- The complete repository gate passed: 127 test files, 837 tests, type checking, lint, and the production build.
- `npm run test:release-ui` exercises the authenticated release workspace at 100%, 125%, 150%, and 200% effective zoom. Each scale passed keyboard navigation, skip-link focus, responsive reflow, reduced-motion behavior, and WCAG 2.2 A/AA checks with zero blocking violations and zero document/body horizontal overflow.
- Windows forced-colors emulation passed with zero accessibility violations. The audit found and fixed two unnamed calendar navigation controls and one low-contrast event action before accepting the candidate.
- The release audit is reproducible through `scripts/release-ui-audit.mjs`; machine-readable evidence is written to `release/release-evidence/ui-audit-0.1.78.json`.
- An encrypted recovery point (`2026-10-20T11-34-02-015Z-19d151935b`) was created before installation. Its restore dry run verified the manifest, database hash, and complete local blob inventory.
- The 0.1.78 NSIS installer was built, installed silently in place, and launched from `C:\Program Files\Moe Tracker Application\Moe Tracker Application.exe`. The installed product reports `0.1.78.0`.
- The installed UI passed Home, team sync, Match Review, Economy, Settings, and Device/Sync/Storage checks. Screenshots and `installed-ui-0.1.78.json` are retained under `release/ui-verification`.
- The installed schema-12 workspace remained valid after upgrade: 8 matches, 180 rounds, 40 player-stat rows, and zero integrity errors or warnings. Evidence is retained in `release/release-evidence/installed-baseline-0.1.78.json`.

## Artifact

- File: `Moe-Tracker-Application-0.1.78-Setup.exe`
- Size: 371,464,653 bytes
- SHA-256: `7FE41EB8FB0E15DCA5BF0B8CAFBEA35A90A0205003665D1CD7C078AAC3FD7EEE`
- Authenticode: `NotSigned`

The artifact is suitable for local test installation only. It must not be published as a trusted public Windows release until the exact artifact is signed and reverified.

## Gates that remain external

1. Obtain a publicly trusted Windows code-signing certificate, build/sign the exact public artifact, verify Authenticode, and exercise the staged update from the prior public version.
2. Run install, offline restart, capture, pairing, synchronization, update, rollback, fullscreen capture, keyboard-only use, high contrast, 200% zoom, and a screen-reader pass on an independent physical Windows PC.
3. Obtain Riot production API/RSO approval before enabling an official ranked/history adapter.
4. License an opponent/pro telemetry source before exposing non-team historical telemetry. Scraping is not an acceptable substitute.
5. Configure provider credentials, player consent, verified destinations, quiet hours, idempotent retry, and delivery receipts before enabling external team notifications.

## Release verdict

Moe Tracker 0.1.78 is an accepted **local release candidate**. The 12-stage engineering program is integrated and verified to the available local/automated gates. Public release, official Riot data, licensed external telemetry, human assistive-technology acceptance, and independent second-PC evidence remain explicitly open.
