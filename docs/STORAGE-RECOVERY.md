# Storage and private recovery contract

Rewritten 22 October 2026, Africa/Cairo. The Firestore and Google Cloud Storage
backends were removed; setting `USE_FIRESTORE=true` now stops the server at
startup.

There are two storage backends:

- **Local workspace (desktop):** one JSON file per workspace. Writes apply the
  schema validation, a conservative 840 KiB per-entity limit (800 KiB for a
  season archive), a 64 MiB database limit, an optimistic revision check,
  fsync and an atomic rename.
- **Cloudflare D1 (website):** compact team summaries only, with the same
  schema validation and per-record bounds.

The workspace holds real team evidence. It is never reset or rebuilt without a
tested migration and a recovery point, and suspect rows are quarantined, not
deleted.

`POST /api/backup` remains a shareable, secret-stripped export. It is not a
disaster-recovery artifact. Importing one uses the current optimistic revision,
creates a private pre-import snapshot, preserves access identities, and
explicitly clears replay/adaptor evidence that would otherwise be stale.
Private recovery backups (local workspace only; D1 uses offline exports) are
created only by the CRON-secret route or internal
functions. Each private backup has a versioned manifest, a checksum-bound
complete state snapshot, and an inventory of replay blobs. Raw `.vrf` files are
never embedded. Restore validates everything, supports dry-run, creates a
private pre-restore snapshot, and replaces the complete state so omissions are
deletions. Dry-run reports metadata validity separately from blob completeness;
an incomplete inventory is not restore-ready and blocks an actual restore. No
public HTTP restore route exists.

Replay files use verified content-addressed publication on the local
filesystem. The backend prefers an exclusive hardlink, with an owned, expiring
publication lock + sibling copy + fsync + hash verification + rename fallback
for filesystems without hardlinks. Expired locks are recovered under a separate
cleanup guard that also has owner and expiry metadata and can itself be
recovered after a crash; live foreign owners are preserved.
`REPLAY_STORAGE_BACKEND=filesystem` is the only backend.

Parser work is coordinated by persisted leases containing owner, expiry,
heartbeat, and fence. Another instance may recover only an expired lease. On
startup, an unexpired foreign lease arms a wakeup for its expiry, so recovery
does not depend on another request or queue event. Completion/failure updates
are ignored unless owner and fence still match.
