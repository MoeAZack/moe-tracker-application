# Optional post-match scrim capture

Moe Tracker includes this capture workflow in the Windows app for completed matches where match history or replay access is unavailable. The app launches a bundled, elevated Windows helper; it does not inject into VALORANT or inspect game memory.

## Calibrated workflow

1. Open VALORANT at a supported 16:9 resolution. F11 may be used to toggle into the larger fullscreen view.
2. Open the completed match Summary screen.
3. In Moe Tracker’s dashboard, enter the last numbered round shown in Timeline, choose whether the report has a Performance tab, and select **Start post-match capture**. Use the Timeline number as the source of truth if VALORANT's headline score is inconsistent.
4. Approve the Windows elevation prompt and return focus to VALORANT during the five-second countdown.
5. Do not move the mouse until capture finishes.

The helper captures the scoreboard, head-to-head page, and every requested round into `Documents\Moe Tracker\Scoreboards\Scrim-<timestamp>`. If Windows blocks that folder, it automatically falls back to `%LOCALAPPDATA%\MoeTracker\Scoreboards\Scrim-<timestamp>`. It also writes `capture-manifest.json` so the importer can detect complete and interrupted runs.

Completed capture folders enter the desktop review inbox automatically; interrupted folders are ignored. Confirmed round evidence supports per-player equipped-weapon results, opening duels, multi-kills, KAST coverage, low-budget wins, full-buy losses, and anti-eco losses. “Equipped weapon” is intentionally distinct from “purchased weapon,” because the screen cannot prove whether a gun was bought, saved, dropped, or picked up.

If capture, OCR, synchronization, or another desktop action fails, use **Settings → Device, Sync & Storage → Export support bundle**. The ZIP contains the local diagnostic log, capture transcript, app/build information, and the capture session tied to the failure when available. The visible error also receives an `MT-…` code so the report can be matched to the exact event.

## Safety behaviour

- Safely restores and verifies VALORANT focus before every click and capture; stops if that verification fails.
- Detects and scales to common 16:9 render areas including 1600 x 900 and 1920 x 1080.
- Uses separate calibrated tab layouts for reports with and without Performance.
- Scrolls the timeline to round 1 before capture and targets the measured center of each numbered round box.
- Skips the non-clickable halftime and overtime separators.
- Does not read game memory, inject code, or run during gameplay.
- Captures rounds 1-24 in the normal pass. For overtime reports, it scrolls to the far end and captures rounds 25-32 in a second pass.
- Press `Alt+F4` to stop the elevated PowerShell helper if necessary.

Riot may change the post-match layout or its third-party application rules. Coordinate automation must be retested after relevant client updates.
