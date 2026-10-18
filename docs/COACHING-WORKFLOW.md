# Coaching workflow contracts (S1, S2, S3, S5, S6)

Version: `moetracker.coaching-workflow/v1`

## Data flow

1. Accepted match, player, and round evidence is grouped into explicit practice blocks or a Cairo-date fallback.
2. A block summary keeps ATT/DEF openings separate and records coverage for economy, roster, composition, map, and evidence health.
3. The versioned signal generator produces deterministic fingerprints. Re-imports and recomputation update the same signal rather than duplicating it.
4. Coach status changes and classification corrections append audit entries. The original observation and evidence references are never overwritten.
5. An accepted signal can become an owned action. Later accepted blocks produce `satisfied`, `regressed`, or `inconclusive` outcomes.
6. The coach dashboard consumes those same contracts through a bounded card catalog and saved versioned layouts.

## Privacy and roles

- Players never receive the private signal inbox or staff dashboard layouts.
- A player receives only team-visible actions assigned to that identity (or explicitly team-wide actions).
- Players may acknowledge or start their own action; only a coach may accept, dismiss, correct, resolve, or cancel coaching work.
- Exports contain summarized values and evidence identifiers, not screenshot bytes, replay files, paths, credentials, or private staff notes.

## Tray capture safety

The tray helper is post-match only. It uses ordinary Windows capture and visible mouse interaction against a foreground VALORANT Summary window. It does not inspect process memory, inject code, or operate while a live round is active. Capture can be visibly paused from the tray or Settings. Window mode, display, notification behavior, offline queueing, logs, captures, support bundle, retry, disconnect, and pairing identity are available from the shared installed application.

## Remaining release evidence

S6 still requires the external gates already listed in the roadmap: a public Windows signing certificate and a second physical Windows-PC run covering install, capture, offline restart, pairing, synchronization, update, and rollback.
