# Practice blocks and tryout comparisons

Contracts: `moetracker.practice-block/v1` and `moetracker.tryout-comparison/v1`
Calculation: `tryout-comparison/v1`
Roadmap: minimal S1.1 dependency plus S4.1–S4.7

## Practice blocks

Matches may be assigned to a stable, named explicit block. An explicit assignment
wins over fallback grouping. Unassigned matches with a valid date-only value or an
offset-bearing instant are grouped by their `Africa/Cairo` calendar date. A
malformed or no-offset timestamp remains visibly unassigned. A match cannot be in
two explicit blocks. Coach-only save, split and merge operations validate the whole
request before mutation, preserve a stable block ID, and never edit match evidence.

## Comparison boundary

Comparisons join appearances only by stable `playerId`. Unlinked appearances are
reported as excluded and never merged by name. Accepted recorded matches are the
input; screenshot drafts and unknown sources are excluded. All filters are applied
before both mirrored sides are calculated. The view supports player/player,
tryout/core-per-player average, own prior period, block/block, agent, map, and
ATT/DEF selections. The optional active-map-pool scope remains a view toggle and
defaults to all recorded/practice maps.

Every metric carries left/right value (or `null`), numerator/denominator where
applicable, sample counts, coverage, confidence, signed delta and an unknown reason.
Kills, deaths, assists, objectives and economy counts are normalized to covered
opportunities for fair comparison. K/D and KDA require paired components. FK and FD
retain separate coverage; opening success requires both. KAST exists only when its
covered denominator is positive and matches the fully covered screenshot rounds;
partial or zero-covered KAST remains unknown.
Scored team record and weapon observations are neutral context, not player blame.

## Rank, decisions, and export

Team rank requires a stable identity, the exact current context, at least three
samples and at least 50% comparable coverage. Neutral or unsupported metrics remain
unranked, small samples are labelled, and ties have a deterministic name/ID order.

Decision notes live in a new staff-only collection and never enter player, website,
shareable-backup, portable-package, or evaluation-export payloads. Status changes
are deliberate coach actions among Core, Stand-in, Tryout and Archived. Archival
uses the existing revocation path and preserves evidence and notes; archived
identities cannot be re-added or promoted.

The CSV evaluation sheet records the exact filters, calculation version, Cairo
generation time, identities/block labels, mirrored values, samples, coverage,
confidence, unknown reasons, excluded counts, supporting match IDs and evidence
limitations. CSV cells are quoted and spreadsheet-formula prefixes are neutralized.
It contains no screenshots, raw replay data, private notes, staff actor identities,
device details, credentials, or tokens.
