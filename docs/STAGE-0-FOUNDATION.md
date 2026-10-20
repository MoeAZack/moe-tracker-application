# Moe Tracker 0.2 — Stage 0 foundation

Completed 20 October 2026 (Africa/Cairo). Stage 0 changes governance and safety only; all future 0.2 product behavior remains disabled.

## Frozen installed-data baseline

The installed desktop workspace was read without modification and preview-migrated in memory from schema 11 to schema 12. The reproducible machine-readable record is `stage0-baseline-2026-10-20.json`.

| Measure | Frozen value |
| --- | ---: |
| Matches | 8 |
| Player metric rows | 40 |
| Rounds | 180 |
| Schedule events | 3 |
| Roster identities | 6 (1 archived) |
| Calibrated rating records | 15 |
| Match record | 6 wins, 2 losses |
| Attack rounds | 58–31 |
| Defense rounds | 45–46 |
| Original database SHA-256 | `eba3b6089f68e61b6f64422296558883f3f6692b11e9d96911295c2e5c47ac10` |

The Stage 0 audit reported zero errors and zero warnings. The source database was not rewritten.

## Recovery point

Encrypted recovery point `2026-10-20T09-31-21-562Z-2a1b72d44b` was created at 12:31 Cairo with the installed app's Windows-protected recovery credential. A dry-run restore verified:

- encrypted AES-GCM envelope and plaintext checksum;
- schema compatibility and complete replacement semantics;
- valid tracker-state structure;
- complete replay inventory metadata;
- zero missing or corrupt replay blobs.

The four replay records in the manifest are explicitly `local-evidence` records, so raw replay bytes are intentionally omitted and are not reported as missing. Automated tests also perform an exact destructive-restore rehearsal in an isolated temporary workspace; the installed database itself was not replaced.

## Integrity gate

`lib/stage0Integrity.ts` is the gate used before and after each later migration. It rejects:

1. duplicate entity IDs or repeated accepted source evidence;
2. player/round rows whose match no longer exists;
3. accepted matches or player metrics without explicit source metadata;
4. ready analytics builds without a source hash;
5. current ratings or active coaching actions tied to archived identities;
6. archived evidence leaking into current player analytics;
7. unavailable metric envelopes silently storing zero.

Unknown remains distinct from zero. Historical evidence remains stored, while the current-analytics projection excludes identities that are archived without a live replacement.

## Complete inventory

`stage0-code-inventory-2026-10-20.json` is generated from the installed dataset and current source tree. It records 1,768 normalized database field paths, 148 API routes, all 44 UI component files, and 455 exported calculation/storage/workflow symbols. Dynamic identity/hash keys are normalized and values and secrets are deliberately excluded.

Regenerate the two records with:

```text
npm run stage0:audit -- --db <database> --output <baseline.json>
npm run stage0:inventory -- --db <database> --output <inventory.json>
```

## Feature isolation

Every 0.2 stage is off by default in `lib/featureFlags.ts`. Unknown flag names are ignored. A stage must pass its own migration, automated, real-data and physical validation gates before its flag can be enabled for release.

## Stage 0 exit gate

- [x] Installed totals frozen and hashed.
- [x] Complete database/code/API/UI inventory generated.
- [x] Encrypted pre-upgrade recovery point created.
- [x] Recovery dry-run passed on the physical Windows device.
- [x] Exact restore behavior covered in an isolated automated test.
- [x] Integrity gate passes the installed eight-match workspace.
- [x] Every unfinished 0.2 area defaults off.
- [x] No installed data was changed.

Stage 1 may begin only from a commit that preserves these checks and totals.
