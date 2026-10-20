# Development test-data policy

Owner clarification recorded 20 October 2026 (Africa/Cairo).

- Moe Tracker remains a test-stage application during the 12-stage 0.2 program.
- The current database is disposable. Its purpose is accuracy, migration, linking and regression testing; it may be reset after Stage 12.
- Existing screenshots and replay files are test fixtures and may be processed repeatedly when a stage requires real-media validation.
- `videoplayback (1).mp4` on the development PC desktop is a disposable coach-POV test VOD containing three games. It is reserved for the unified ingestion, evidence fusion and VOD accuracy stages.
- Intermediate installers are unnecessary. Build or install only when a stage needs packaged-runtime, Windows integration, upgrade/rollback, or physical UI evidence.
- The final install may start from a fresh database after Stage 12.

Safety checks, provenance and recovery remain development invariants because they detect linking and migration defects. They are not a claim that the current test records require long-term preservation.
