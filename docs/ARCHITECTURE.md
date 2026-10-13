# Moe Tracker desktop architecture

## Data ownership

The desktop workspace is authoritative for raw evidence. Cloudflare is authoritative only for the latest coach-accepted team summary.

```text
VALORANT replay / selected scoreboard
                 |
                 v
       Local evidence workspace
       - raw replay (30-day default)
       - immutable parser evidence
       - identity overlay
       - coach review draft
                 |
        coach accepts the match
                 |
          +------+------+
          |             |
          v             v
 portable package   cloud summary
 (PC transfer)      (website stats)
```

## Operating modes

### Offline-first

All capture, parsing, review, analytics, and exports work without a network. Accepted changes enter an outbox and synchronize when connectivity returns.

### Connected

Accepted summaries synchronize immediately. A coach can request a temporary raw replay upload only for central reprocessing. Raw cloud objects are deleted after successful processing and abandoned objects expire after one day.

## Windows folders

| Purpose | Default path |
|---|---|
| VALORANT replay discovery | `%LOCALAPPDATA%\VALORANT\Saved\Demos` |
| Manual replay inbox | `Documents\Moe Tracker\Replays` |
| Scoreboard inbox | `Documents\Moe Tracker\Scoreboards` |
| Portable exports | `Documents\Moe Tracker\Exports` |
| Local backups | `Documents\Moe Tracker\Backups` |
| Application state | Electron `userData\Local Workspace` |

Additional replay folders can be added from the application. Screenshots are never read from arbitrary folders without the user selecting that folder or file.

## Identity and conflict rules

- SHA-256 identifies a replay across every PC.
- Parser evidence is immutable and retains its provenance.
- Name mappings and coach corrections are separate overlays.
- Multiple devices may prepare the same replay; the cloud deduplicates by hash.
- Any authorized coach device may accept a draft.
- Conflicting accepted revisions remain auditable and never silently overwrite raw evidence.

## Game-integrity boundary

The application may observe the existence of the VALORANT process to improve UI timing later, but it must not read or modify process memory, inject code, hook rendering, expose hidden players, or offer live decision guidance.
