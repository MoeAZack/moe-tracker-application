# Private vrfkit replay parser

Status: owned fork implemented and validated; bundled desktop deployment remains coach-review-only.

MoeTracker accepts only the Windows x64 release of the owned [MoeAZack/vrfkit](https://github.com/MoeAZack/vrfkit) fork pinned below. [yakisoba0728/vrfkit](https://github.com/yakisoba0728/vrfkit) remains the tracked upstream for reviewed updates, but the application never downloads an upstream artifact directly:

- tag: `v0.2.6-moe.1`
- source commit: `4bacfdc2b766caec02d830cc65f8c4e2ea9dc14c`
- release ZIP SHA-256: `1708748fdb87adea30c91c0f53f0272c3ae54eba771ea7222904e71d89f9c543`
- packaged `vrfkit.exe` SHA-256: `ea20f413ebe909ef45e49a6d2890f3d341aede69f22b42be8ea6acc357fc41a3`
- supported replay patches: `11.06` through `13.08`
- license: Apache-2.0

The canonical values live in `scripts/replay-runtime-pin.json`. The server and collector re-hash the executable and validate `build-info.json` before use. A mismatched executable is never run.

## Gated installation

1. Download `vrfkit-v0.2.6-moe.1-windows-x64.zip` and its `.zip.sha256` only from the owned GitHub `v0.2.6-moe.1` release. MoeTracker does not accept an unpinned parser update.
2. Before extraction, run `Get-FileHash -Algorithm SHA256` on the ZIP and require the exact ZIP digest above. Also compare the official checksum-file text. Stop on any mismatch.
3. Extract to a private, administrator-controlled tools directory. Require only `vrfkit.exe`, `build-info.json`, `LICENSE`, and `NOTICE.md`.
4. Hash `vrfkit.exe` and require the exact executable digest above. Inspect `build-info.json` and require the exact tag, commit, executable digest, and `x86_64-pc-windows-msvc` target above.
5. Provide a separately managed Python environment with `pyarrow` available. Pin the wheel version and hash in the deployment's dependency lock; install from that lock with hash verification. Do not let the web process install packages.
6. Set absolute `VRFKIT_BINARY_PATH` and `VRFKIT_PYTHON_PATH` values. Keep `VRFKIT_JOBS_DIR` unset or make it a private child of `REPLAY_STORAGE_DIR`. Restart and use a coach session to start one bounded validation job.

The release is independent community software, not Riot-endorsed. Keep its `LICENSE` and `NOTICE.md` with the binary.

## Job flow and security boundary

1. An enrolled device uploads and SHA-256-verifies a `.vrf` into private hash-addressed storage. Nothing parses automatically.
2. A coach deliberately calls `POST /api/replay-intake/uploads/:sha256/parse`.
3. The server re-hashes both the private replay and pinned executable, creates a fresh private job directory, and launches vrfkit without a command shell.
4. `vrfkit export ... --checkpoints` receives only a minimal OS environment allowlist (never server secrets) and is bounded by wall time, output bytes, file count, filesystem containment, and symlink/reparse rejection. Timeout and limit failures terminate the whole process tree and wait for confirmed exit. Standard output/error are bounded and never returned as raw diagnostics.
5. The local normalizer reads only the new export. It writes one bounded JSON result with replay, binary, commit, manifest, and output-size provenance.
6. The existing replay evidence engine derives openings, trades, clutch candidates, and objective evidence only when complete identity/team/timeline capabilities and an independent trusted `manifest.players` roster mapping are present. Every result is non-writable and `review-required`.
7. Raw exports and the intermediate normalized file are deleted after every success or failure. Only bounded normalized/provenance/status evidence remains. The scheduler defaults to one parser process, eight queued jobs, two active jobs per coach/device, and deterministic 30-day/100-job terminal retention.

The status/result endpoint is `GET /api/replay-intake/uploads/:sha256/parser`. Coaches can see all private replay jobs. A player can see only a replay associated with that player's own enrolled device identity. API responses never include raw paths, account UUIDs, source filenames from other devices, or parser stdout.

## Evidence contract

Supported when the corresponding replay evidence is complete:

- map asset path and reviewed friendly-name mapping;
- final team score from typed `RoundResults` winner rows;
- player K/D/A from final `BasicCombatStatsComponent` aggregates;
- first blood/death and the round event timeline from cross-checked `characterDeath` events;
- plants and defuses from authoritative objective events cross-checked to typed RPC player references;
- ultimate-orb captures from paired typed `OrbPickedUpRPC` player/orb references;
- ultimate uses from authoritative `bUltimateActive` transitions cross-checked to the same player's nearby `characterUltimateUsed` event;
- KAST from complete round eliminations, monotonic round-scoped assist changes, survival, and traded-death evidence;
- trades and clutch candidates derived by the review engine from complete life-state event order.

Missing fields are `{ value: null, status: "unavailable" }`. Zero appears only when the complete evidence stream proves no event occurred for that player. KAST stays unavailable if either the elimination or assist stream is incomplete. The replay does not expose a verified player display-name field: `ProfileName` contains crosshair/profile labels, so player names remain unavailable and identities are replay-scoped pseudonyms until the local post-match OCR pairing supplies a unique K/D/A-and-agent name match. Unique exact roster-name matches prefill the player and team overlay; ambiguous or duplicate matches remain unassigned for coach review.

## Real replay validation (private, 15 Oct 2026 Cairo)

The owned 13.08 transform and exact release binary were exercised against the two 13.08 replays still retained locally; raw replays were not uploaded or committed. The strict fork audit recorded 2/2 passing files, 1,781,485/1,781,485 oracle blocks, 58,694 checkpoint blocks, 50,012 independently compared typed values with zero mismatches, and zero transform, framing, field, or array failures. Earlier private screenshot comparison also confirmed:

- Haven, 22 played rounds, score 9–13;
- ten complete K/D/A rows totaling 165 kills and 165 deaths;
- 22 first-blood events, 18 plants, and 7 defuses;
- all 22 opening events resolved; downstream output remained non-writable and review-required.

Both retained 13.08 samples produced complete orb and ultimate-use capabilities (17/30 and 15/22 total observations respectively). One sample also produced complete 24-round KAST; the other correctly kept KAST unavailable because its elimination stream was incomplete. The replay manifest duration is not silently replaced with the post-game UI duration; any difference stays visible for review. Player-name mapping remains the only scoreboard field unavailable from replay evidence itself and is supplied through the local OCR overlay.
