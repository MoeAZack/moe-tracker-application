# Moe Tracker Application

Version 0.1.43 adds local full-timeline VOD analysis for YouTube and original video files. It samples the complete video, extracts timestamped kill-feed, objective, orb, and ultimate observations, derives supported trades/KAST evidence, and links the result through the same five-player match workflow. See [VOD timeline analysis](docs/VOD-TIMELINE-ANALYSIS.md) for coverage and evidence limits.

Windows-first, offline-first practice analysis for a VALORANT team. The desktop application watches replay folders, keeps detailed evidence on the PC, supports local scoreboard OCR, and synchronizes only accepted summaries to the lightweight team website.

The primary workflow is: capture completed practice → review accepted evidence → assign a coaching action → evaluate it only against a later comparable practice sample.

Completed `Scrim-*` screenshot sessions are detected in both the Documents inbox and the `%LOCALAPPDATA%` fallback. Confirmed rounds feed confidence-aware player weapon, economy, opening-duel, multi-kill, and KAST summaries; accepted compact summaries appear on the website. Players can also submit a personal VOD with a locally read scoreboard frame. Five roster identities are required before the submission can link to an existing screenshot/replay match or create a new match, and only missing statistics are filled. A one-click ZIP support bundle packages diagnostics and the latest capture evidence when capture, OCR, update, or synchronization fails.

## Product split

- **Desktop:** replay discovery, parsing, screenshots, review drafts, detailed events, portable backups, retention, and queued synchronization.
- **Website:** accepted matches, main player statistics, player VOD submissions, map pool summaries, roster, schedule, and sync health.
- **Cloudflare:** compact team summaries and device coordination—not permanent raw replay storage.

## Desktop quick start

```powershell
npm install
npm run desktop:dev
```

The application creates these folders automatically:

- `Documents\Moe Tracker\Replays` — manual replay inbox
- `Documents\Moe Tracker\Scoreboards` — screenshots selected by the user
- `Documents\Moe Tracker\Exports` — portable team packages
- `Documents\Moe Tracker\Backups` — local recovery snapshots

It also watches `%LOCALAPPDATA%\VALORANT\Saved\Demos` when that folder exists.

For normal use, download the latest Windows installer from the repository's Releases page. Public builds remain explicitly marked unsigned until the external code-signing certificate gate is complete.

For private practice matches where replay or match-history access is unavailable, an optional standalone 1920 x 1080 post-match capture helper is documented in [docs/SCRIM-CAPTURE.md](docs/SCRIM-CAPTURE.md).

## Build the Windows installer

```powershell
npm run check
npm run desktop:installer
```

The installer is written to `release/`. The public workflow refuses to publish until Authenticode verification and a clean Windows installation check pass. Local development installers are unsigned and can trigger Windows reputation warnings.

## Safety boundary

Moe Tracker reads completed replay files and user-selected screenshots. It does not inject into VALORANT, inspect process memory, automate gameplay, or provide live behavior-changing information.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md), [docs/AUDIT-IMPLEMENTATION.md](docs/AUDIT-IMPLEMENTATION.md), and [SECURITY.md](SECURITY.md).
