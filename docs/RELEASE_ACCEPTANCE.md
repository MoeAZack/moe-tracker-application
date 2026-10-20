# Desktop release acceptance

Last updated: 20 October 2026, 17:12 Cairo (`Africa/Cairo`).

Moe Tracker 0.2.0 is the current accepted **local release candidate** on this
PC. It is not a signed public release and has not been accepted on a second
physical PC.

## Automated and installed gates

- Type checking, lint, the production build, 135 test files, and 874 tests pass.
- The runtime gate verifies exact versions for Electron 41.10.7, Electron
  Builder 26.15.3, Sharp 0.35.5, FFmpeg 5.3.0, FFprobe 3.1.0, and
  youtube-dl-exec 3.1.17, plus exact Windows hashes for their shipped native
  binaries.
- The replay runtime verifies VRFKit `0.2.6-moe.1` at commit
  `4bacfdc2b766caec02d830cc65f8c4e2ea9dc14c`, Python 3.12.10, and PyArrow
  18.1.0. The VRFKit archive/executable, Python archive/executable, and PyArrow
  wheel are all hash-pinned before packaging.
- The packaged desktop bridge passes a fresh-profile journey covering local
  service startup, coach session creation, encrypted credential availability,
  scoreboard/ingestion reads, retention/capture preference writes, and an
  encrypted recovery backup.
- A recovery point was created and restore-dry-run verified before installation:
  `2026-10-20T14-06-45-985Z-c69607464a` (17:06 Cairo).
- The installed 0.1.78 product upgraded silently to 0.2.0. The retained
  workspace remained 8 matches, 180 rounds, and 40 player-stat rows.
- The 0.2.0 binaries were then fully uninstalled and clean-installed for the
  current user. The installed product reports `0.2.0.0` and passes the same IPC
  journey against both a fresh profile and the retained profile.
- The exact 0.1.78 and 0.2.0 installers pass the staged updater/rollback drill:
  0.1.78 becomes last-known-good, 0.2.0 enters startup verification, and a second
  failed startup launches exactly one 0.1.78 rollback installer.

Machine-readable candidate, runtime, UI, and rollback evidence is written under
`release/release-evidence`. The final installer hash is recorded after the exact
merged head is rebuilt.

## Signing and public distribution

No public Windows code-signing certificate is configured on this PC or in the
GitHub `release` environment. The local installer therefore reports
`Authenticode: NotSigned` and must not be represented as a trusted public build.

The tag workflow is prepared and fail-closed: it requires the certificate,
builds and verifies the signed installer, clean-installs it, verifies the
installed executable signature, runs the packaged IPC journey, and only then
publishes the release assets.

Public distribution still requires:

1. Configure `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` with a publicly
   trusted Windows code-signing certificate and run the protected tag workflow.
2. Accept the exact signed artifact on an independent physical Windows PC,
   including update, rollback, fullscreen capture, high contrast, 200% zoom,
   keyboard-only use, and a human screen-reader pass.

Official Riot ranked/history and licensed opponent/pro telemetry retain their
separate external approval and licensing gates.
