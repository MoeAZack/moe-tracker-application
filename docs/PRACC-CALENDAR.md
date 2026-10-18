# PRACC calendar integration

Moe Tracker 0.1.45 can subscribe to the private `.ics` feed available from PRACC.

## Connect

1. Open **Settings → Attendance Rules** as a coach.
2. Paste the PRACC match calendar URL into **PRACC calendar feed**.
3. Choose **Save & sync**.

The URL must use HTTPS on `pracc.com` and match `/api/matches/{key}/calendar.ics`. The private key is stored server-side and is excluded from player responses, website summaries, and shareable backups.

## Synchronization behavior

- PRACC dates and times are converted to `Africa/Cairo`.
- All-day events remain all-day goals on the schedule.
- Timed events keep their duration when PRACC provides an end time.
- The PRACC event UID prevents duplicate imports and allows later feed changes to update the same schedule row.
- Existing attendance assignments and check-ins are preserved when PRACC changes an event.
- Future cancelled events are removed only when they have no check-ins.
- Opening **Schedule & Goals** performs an automatic check with a ten-minute cooldown. Coaches can always use **Sync now**.
- Disconnecting the feed keeps already imported schedule entries.

If PRACC returns an expired or missing feed, Moe Tracker keeps the URL and displays the provider error so the coach can replace it with a regenerated link.
