# Stage 10 — schedule and team operations

Closed on 20 October 2026 (Africa/Cairo).

## Delivered

- One server-side schedule contract now validates manual, repeated and PRACC-backed events for both month and hourly-day views.
- Consecutive hourly events are created in one atomic request. Coaches can update shared series content without moving sibling time slots, delete one event, or delete the complete series.
- Full-day main goals remain distinct from timed practices, officials, VOD reviews, offline sessions, Team Talks and Debriefs.
- PRACC retains ownership of imported date, time, title and event details. Coaches retain category, attendance rules and a separate `coachNotes` field that survives refreshes.
- Player check-ins, coach corrections and resets append immutable attendance-audit entries instead of erasing decision history.
- The attendance ledger continues to resolve Cairo DST per event, grants the configured grace window, converts late/absent events into strikes and red dots, and applies reversible green credits.
- Schedule and goal writes are enforced as coach-only at the server, including the legacy generic endpoints.
- PRACC cancellations cannot erase events that already contain attendance history or linked practice evidence.

## Explicit deferral

WhatsApp, Telegram and Discord delivery remains a later integration. It requires provider credentials, per-player consent, destination verification, quiet hours, retry policy and idempotent delivery. Stage 10 does not fabricate destinations or send test messages to real people.

## Acceptance

- Targeted scheduling, attendance, PRACC, calendar-export and public-data suite: 30 tests passed before the final full gate.
- Atomic series creation/edit/deletion, player write denial, append-only attendance correction history and PRACC preservation are covered by automated tests.
- Full repository gate: 127 test files / 837 tests, lint, TypeScript and production build passed.
