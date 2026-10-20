# Stage 3 — unified resumable ingestion

Completed 20 October 2026 (Africa/Cairo). No installer was produced; this stage was validated from source and against the disposable coach VOD fixture.

## One job contract

`desktop/ingestion-jobs.cjs` defines one durable state machine for local screenshots, replays, YouTube VODs and local VODs:

- sources: `screenshot`, `replay`, `youtube-vod`, `local-vod`;
- states: queued, running, paused, ready, completed, failed and cancelled;
- bounded 0–100 progress, a named stage, a plain-language message and a retained checkpoint;
- restart is offered only when a source and checkpoint both still exist;
- interrupted retained work becomes paused on the next launch; transient work fails closed;
- completed jobs are immutable;
- renderer-visible history never exposes local source paths.

The desktop now stores all jobs in `Local Workspace/Ingestion/jobs.json`, migrates the legacy VOD history on read, exposes one ingestion history, and emits one progress event. Existing VOD APIs remain compatible. Replay processing publishes scan, parse, integrate and complete stages. Every local screenshot extraction automatically creates the same job shape.

Cancellation stops an active VOD controller, marks the job cancelled, and keeps retained source evidence. A partial multi-game import pauses instead of being mislabeled as failed or completed.

## Incremental work

- VOD timeline OCR keeps frame-level checkpoints keyed by source, time range, player projection and POV.
- Screenshot results are cached by image SHA-256, normalized roster projection, crop selection and explicit extractor version.
- Normal UI/application updates reuse unchanged OCR results. An extractor-version bump invalidates only affected result keys.
- The local screenshot cache is bounded to 40 most-recent entries and stores parsed results, never image pixels.

## Disposable fixture validation

The Desktop fixture `videoplayback (1).mp4` was scanned directly without installing the app:

| Property | Result |
| --- | ---: |
| Source SHA-256 | `3e646d038deca3021c023aa39e9f789a763e792b6819eaedc0411b4a8c21e9f0` |
| Duration | 10,180.1 seconds |
| Resolution | 1280×720 |
| Expected games | 3 |
| Detected game boundaries | 3 |
| Boundary timestamps | 08:16, 01:04:48, 02:05:04 |
| Map OCR | Haven, unknown, Abyss |

The expected three games were separated. The unreadable middle map remains unknown instead of being guessed; Stage 4 evidence fusion may fill it from scoreboard/replay evidence.

## Exit gate

- [x] One persisted job contract across all four ingestion sources.
- [x] Consistent progress, pause, failure, cancellation and completion semantics.
- [x] Restart requires retained source plus checkpoint.
- [x] Interrupted jobs recover deterministically.
- [x] Screenshot OCR reuses unchanged results.
- [x] VOD timeline OCR resumes frame checkpoints.
- [x] Three-game coach fixture finds exactly three boundaries.
- [x] Local paths are not exposed in job history.

