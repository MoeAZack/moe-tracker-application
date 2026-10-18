# VOD timeline analysis

Moe Tracker 0.1.43 adds local full-video analysis to the existing VOD submission workflow.

## Processing flow

1. A player supplies a YouTube URL or selects an original video file through the desktop file picker.
2. The end-screen frame establishes the ten observed names and the five active-roster identities.
3. Bundled, pinned video tools probe the source and sample changing kill-feed, objective-notice, and ultimate-HUD regions across the complete duration.
4. Tesseract runs locally. Raw video and raw OCR text are not uploaded.
5. Timestamped observations are reduced into video-evidence metrics and stored with explicit per-signal coverage.
6. The normal VOD submission linker attaches the evidence to an existing five-player match or creates a new match section.

## Evidence rules

- Missing and unreadable events remain unknown, never zero.
- Persisting kill-feed rows are deduplicated.
- A trade is derived only from an observed revenge elimination inside the five-second window.
- Kill and death coverage becomes complete only when all five selected players' observed totals exactly match the accepted scoreboard totals.
- KAST remains partial until authoritative round boundaries and assists are proven.
- Ultimate and orb observations remain partial unless continuous HUD coverage proves completeness.
- Throw intent is never stored as fact. The analyzer currently emits no automatic throw findings.
- Stronger replay evidence and existing non-null statistics are never overwritten by VOD evidence.

## Source support

- Original MP4, MKV, MOV, WebM, AVI, and M4V files are preferred.
- Public YouTube, youtu.be, Shorts, Live, and Embed URLs are supported through the bundled local transport.
- Private, age-restricted, member-only, DRM-protected, unavailable, or authentication-required videos may require the original file.
- One submission is limited to four hours and 30 GB.

The first production detector is intentionally conservative. Additional calibrated HUD profiles can improve agent-specific utility, observer layouts, assists, round boundaries, and multi-POV evidence fusion without changing the stored evidence contract.
