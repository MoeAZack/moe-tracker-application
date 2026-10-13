# Moe Tracker Application

Windows-first, offline-first practice analysis for a VALORANT team. The desktop application watches replay folders, keeps detailed evidence on the PC, supports local scoreboard OCR, and synchronizes only accepted summaries to the lightweight team website.

## Product split

- **Desktop:** replay discovery, parsing, screenshots, review drafts, detailed events, portable backups, retention, and queued synchronization.
- **Website:** accepted matches, main player statistics, map pool summaries, roster, schedule, and sync health.
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

## Build the Windows installer

```powershell
npm run check
npm run desktop:installer
```

The installer is written to `release/`. Signing is intentionally not configured yet; unsigned development builds can trigger Windows reputation warnings.

## Safety boundary

Moe Tracker reads completed replay files and user-selected screenshots. It does not inject into VALORANT, inspect process memory, automate gameplay, or provide live behavior-changing information.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).
