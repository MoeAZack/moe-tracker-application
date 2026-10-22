# Moe Tracker 0.2.1 release notes (draft)

Draft for the GitHub release text. Not published: publishing needs the owner's
explicit permission for this version (gate F in `PRE-0.2-RELEASE-HARDENING.md`),
after gates B to E pass on the owner's PC.

## What happened with 0.2.0

On 22 October 2026 an incident with 0.2.0 was reviewed. On the owner's PC,
soon after upgrading from 0.1.x, a workspace lost all of its
matches, player stats and rounds. The review found that those matches were
deleted one by one through Match Review, not by the upgrade. It also found that
0.2.0 gave no protection against that: no record of who deleted a match, no
backup before the last match went, and no undo. It found a separate bug too: a
0.1.x workspace that had a season archive could not start 0.2.0 at all.

0.2.1 fixes all of these. If you installed 0.2.0, install 0.2.1 over it.

<!-- Say "withdrawn" here only if the owner has pulled the 0.2.0 release by the time this is published. -->

## Your data is safer

- **Deleted matches can be restored.** Deleting a match moves it, with its
  rounds, player stats and veto, to **Recently deleted** in Match Review. Restore
  puts it back.
- **Every match deletion is recorded**: who, which match, when, and from where.
- **A recovery backup is taken before the last match is deleted**, and once for
  each burst of several deletions in a few minutes.
- **Deleting a match always asks first**, whatever the delete-confirmation
  setting says, and the next match is no longer selected under the same Delete
  button.
- **No save can quietly empty the workspace.** A save that would remove every
  match, round or player stat is refused unless it comes from an action that
  means it (deleting the last match, a reset, a season archive, a restore).
- **Upgrading from 0.1.x keeps a copy first.** Before the first save, the
  previous workspace file is kept unchanged next to it. (0.2.0 and 0.2.1 use
  the same storage format, so going from 0.2.0 to 0.2.1 needs no copy.)
- **A damaged or missing workspace file is never replaced by an empty one.** A
  damaged file is set aside unchanged. If the file is missing on a computer that
  had a workspace, the app opens a recovery screen: restore a backup, or start
  an empty workspace on purpose.
- **Reset metrics takes a backup first**, and erases nothing if the backup fails.
- Old evidence files are never cleaned up right after an upgrade, or when a
  save would drop most of them at once.

## Fixed

- A 0.1.x workspace with a season archive no longer stops the app from
  starting. Stored evidence now loads before the upgrade steps run.
- The app opens even when a replay collector state file is damaged after an
  unclean shutdown.
- The desktop app keeps the same local address between launches, so OCR
  learning, the recognition cache and the scoreboard cache no longer reset on
  every start. Learning stranded by earlier versions is recovered once.
- Automatic VOD import keeps running when you switch tabs.
- "Link results" works for practice sessions you created by hand.

## New since 0.2.0

- **VOD review:** queue several VODs for automatic import, one after another.
  Review up to five POVs side by side on one clock (YouTube and local files),
  with jump-to-round and manual sync. Draw on a paused frame. Create tasks from
  a round.
- **Strategy:** one strategy editor, and a strategy board for each strategy on
  your own minimaps.
- **Practice:** an automatic summary for each practice session from its linked
  matches, with "Copy for the team" and a reminder on Home.
- **Scoreboard reading (OCR):** learned corrections also apply to a single
  uploaded scoreboard. Below 1920×1080, each K/D/A number is read twice, and a
  line whose reads disagree, or that only one read is sure of, is left for you
  to fill in instead of being saved wrong.
- **Captures and replays:** a local capture and its replay are joined by their
  evidence. The scoreboard capture is offered when a match ends. A capture is
  auto-saved when only some rounds need review. PRACC can fill a capture's date
  and opponent.
- **One product:** the sidebar is grouped into seven areas, Home has one inbox
  for everything waiting for a coach, and match identity is decided the same
  way for match saves, VOD and replays.
- **Removed:** the old Google code (Firestore, Cloud Storage, Google sign-in)
  and the disabled GRID, VLR and Solo Q integrations.

## Install notes

- The installer is **unsigned**. Windows SmartScreen warns on first run: choose
  "More info", then "Run anyway".
- **Automatic updates are off.** Install new versions by running the new
  installer.
- Check the download against `SHA256SUMS.txt`.

## Known limits

- Restored matches come back exactly as they were deleted. Goal and review
  links that the deletion removed stay removed.
- The deletion record is kept on the desktop. On the website, the list of
  deleted matches is the record.
- OCR below 1920×1080 was measured only on 1920×1080 captures resampled to
  1600×900, not on real 1600×900 captures. Other resolutions, and Windows
  display scaling other than 100%, are not measured yet.
