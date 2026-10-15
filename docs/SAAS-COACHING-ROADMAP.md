# MoeTracker coaching SaaS roadmap

Status: approved product direction; implementation not started  
Roadmap owner: MoeTracker product owner  
Last updated: 14 October 2026, Africa/Cairo

## Autonomous start command

The standalone owner command **`ready roadmap`** starts one autonomous roadmap
slice. The agent selects the smallest dependency-ready unchecked ID from the
earliest active milestone, implements and tests that single point, updates its
status only with acceptance evidence, commits and pushes it, then stops with the
next ready ID. The detailed execution and blocker rules are defined in
[`AUTONOMY.md`](./AUTONOMY.md).

## Product position

MoeTracker turns private post-match screens and available replay evidence into a
shared coaching record, including when VALORANT match history is hidden or a
replay cannot be parsed.

The product must complete one coaching loop:

1. Collect a practice block.
2. Show what repeatedly happened and how reliable the evidence is.
3. Open the exact supporting match, round, screenshot, or replay moment.
4. Record a coaching decision and assign the follow-up.
5. Check the same behavior in a later practice block.

Competitive product research informed the workflow categories in this roadmap.
MoeTracker will use its own terminology, visual system, data contracts, and
implementation. No private competitor access, copied interface, or undocumented
data source is required.

## Non-negotiable product rules

- Accepted evidence is the source of truth. Draft captures never change team metrics.
- Missing evidence remains unknown. It is never converted to zero, a loss, or a player fault.
- Every derived claim exposes its sample, coverage, source, and confidence.
- Screenshot observation does not claim positioning, utility usage, a purchase, or a trade when the screen cannot prove it.
- Player blame is never inferred from team-only evidence.
- Private scrims, notes, assignments, and identities remain scoped to the owning team.
- Riot authentication material stays local and is never synchronized with match data.
- Collection is post-match only. No live competitive assistance, injection, memory inspection, or anti-cheat bypass is permitted.
- Desktop operation remains useful offline; cloud synchronization is durable, idempotent, and resumable.
- Coach/manager mutations and player read-only boundaries must be enforced by the server, not only hidden in the UI.
- The optional active-map-pool scope applies consistently across dashboard, map, composition, economy, and comparison views; all recorded/practice maps remain the default.
- Every release retains accessible keyboard operation, visible focus, semantic tables, reduced motion, 200% zoom usability, and readable contrast.

## Delivery order

| Milestone | Outcome | Depends on | Priority |
| --- | --- | --- | --- |
| S0 | Stable analytics and evidence contracts | Current v0.1.22 baseline | Gate |
| S1 | Practice-block summary | S0 | Now |
| S2 | Evidence-linked review inbox | S1 | Now |
| S3 | Assignment and verification loop | S2 | Now |
| S4 | Player and tryout comparisons | S0 | Next |
| S5 | Configurable coach dashboard | S1, S2, S4 | Next |
| S6 | Tray-first capture sidekick | Existing capture pipeline | Next |
| S7 | Team notifications and Discord | S2, S3, stable sync | Later |
| S8 | Replay-backed spatial intelligence | Reliable current-patch parser | Research |
| S9 | Licensed public opponent intelligence | Stable private SaaS | Deferred |

S1 through S3 form the first complete SaaS coaching loop and must be finished
before expanding into public scouting or spatial replay analysis.

## S0 — Analytics and evidence contract gate

### Goal

Make later workflow features consume one stable, explainable analytics contract
instead of recalculating percentages independently in each screen.

### Work items

- **S0.1 Canonical evidence reference** — Define a reference containing team,
  match, round, capture session, screenshot/replay artifact, source type,
  acceptance state, parser/capture version, and captured-at time. Contract:
  [`EVIDENCE-REFERENCE.md`](./EVIDENCE-REFERENCE.md).
- **S0.2 Derived-metric envelope** — Standardize `value`, numerator,
  denominator, coverage, confidence, unknown reason, source references, and
  calculation version. Contract: [`DERIVED-METRIC.md`](./DERIVED-METRIC.md).
- **S0.3 Signal registry** — Create stable identifiers (contract:
  [`SIGNAL-REGISTRY.md`](./SIGNAL-REGISTRY.md)) for pistol conversion,
  anti-eco loss, full-buy loss, low-buy win, first-death recovery, opening
  conversion, advantage collapse, multikill, composition result, and incomplete
  evidence.
- **S0.4 Optional active-map-pool scope** — Centralize the view-only projection
  so users can switch current-performance surfaces between all recorded/practice
  maps (default) and the configured active pool while historical evidence is
  preserved. Contract: [`ANALYTICS-MAP-SCOPE.md`](./ANALYTICS-MAP-SCOPE.md).
- **S0.5 Identity snapshot policy** — Keep the observed name and agent attached
  to historical evidence even after roster status changes or archival.
- **S0.6 Migration/versioning** — Version aggregate builders and make existing
  accepted matches reproducibly recomputable.

### Acceptance gate

- The same sample produces identical values on Dashboard, Map Analysis,
  Economy, Compositions, player views, and exports.
- Unknown or partial fields include a machine-readable reason.
- All signal types have fixture tests for complete, partial, contradictory, and
  empty evidence.
- Recomputing analytics does not duplicate accepted matches or review signals.

## S1 — Practice-block summary

### Goal

After captures are accepted, give the coach one compact answer to: “What happened
in this block, and what should we inspect first?”

### Work items

- **S1.1 Block model** — Group matches by explicit block when supplied, with a
  Cairo-date/time fallback and a coach control to merge, split, or rename blocks.
- **S1.2 Block header** — Opponents, maps, match/round coverage, roster statuses,
  result, capture sources, and evidence health.
- **S1.3 Opening summary** — ATT/DEF pistol, anti-eco, and bonus conversion;
  first-three-round performance for each side; FK/FD and recovery after first death.
- **S1.4 Economy summary** — Low-buy wins, full-buy losses, anti-eco losses,
  weapon observations, and known/unknown buy coverage.
- **S1.5 Roster summary** — Player K/D/A, ACS/ADR/HS when supported, FK/FD,
  KAST coverage, agents, objectives, multikills, and recent-form deltas.
- **S1.6 Composition and map summary** — Composition usage/results, side splits,
  active-map-pool context, and map-specific warnings.
- **S1.7 Priority selection** — Rank a maximum of three review priorities using
  severity, recurrence, evidence confidence, and coach-configurable thresholds.
- **S1.8 Drill-through** — Every value opens the filtered accepted matches and
  rounds that produced it.
- **S1.9 Export** — Produce a shareable coach summary without raw private files or
  unsupported conclusions.

### UX placement

- Dashboard: latest block card and unresolved-priority count.
- Match Log: block grouping and “Open block summary”.
- Map Analysis/Economy/Compositions: “View supporting block” links.

### Acceptance gate

- A newly accepted multi-match capture updates the block exactly once.
- A 24-round regulation match and overtime match both aggregate correctly.
- ATT and DEF opening metrics are visibly separate.
- Inactive maps are excluded from current summaries but remain available in history.
- Every priority can be traced to accepted evidence in two interactions or fewer.
- Empty and partial blocks render useful coverage guidance without fabricated rates.

## S2 — Evidence-linked coaching inbox

### Goal

Convert reliable anomalies and review opportunities into a manageable queue,
instead of leaving them scattered across analytics screens.

### Work items

- **S2.1 Review-signal generator** — Create idempotent signals from the S0
  registry when evidence is accepted or recomputed.
- **S2.2 Inbox card** — Signal type, severity, map/side/round, short explanation,
  metric sample, confidence, evidence source, affected team/player when proven,
  and created/reviewed timestamps in Cairo time.
- **S2.3 Queue filters** — Block, map, side, economy, player, agent, composition,
  source, confidence, status, and signal type.
- **S2.4 Evidence viewer** — Open the screenshot crop, round row, match detail,
  replay moment, VOD marker, or manual coach note supporting the signal.
- **S2.5 Review state** — `new`, `reviewing`, `accepted`, `dismissed`, `needs evidence`,
  and `converted to action`, with coach identity and audit history.
- **S2.6 Corrections** — A coach can correct classification without overwriting
  the original observation; recomputation records the correction source.
- **S2.7 Deduplication** — Re-import, sync retry, parser retry, and update rollback
  cannot create duplicate signals.
- **S2.8 Review thresholds** — Team-level preferences control recurrence and
  minimum samples while safe defaults remain available.

### First supported signals

1. Pistol loss and failed/successful follow-up conversion.
2. Full-buy loss.
3. Anti-eco loss.
4. Low-buy win.
5. First-death collapse or recovery.
6. Repeated player first deaths when player identity is proven.
7. Complete-event multi-player advantage collapse.
8. Composition/map underperformance with a visible minimum sample.
9. Incomplete, contradictory, or low-confidence evidence requiring review.

### Acceptance gate

- Signal generation is deterministic and versioned.
- Team-only evidence never names a responsible player.
- Dismissal records a reason and survives synchronization/recomputation.
- Players cannot mutate coach review status unless their role is explicitly granted.
- Queue counts reconcile with block summaries and underlying evidence.

## S3 — Assignment and next-block verification

### Goal

Carry a reviewed finding into real team work and determine whether it improved.

### Work items

- **S3.1 Action creation** — Convert an accepted review signal into player
  feedback, team task, VOD review, strategy-board item, map-plan item, schedule
  objective, or next-block check.
- **S3.2 Preserved provenance** — Store the source signal and immutable evidence
  references with every action.
- **S3.3 Ownership** — Assign one or more players, coach, analyst, or team unit;
  include due block/date, priority, and private/staff/team visibility.
- **S3.4 Action states** — `planned`, `assigned`, `acknowledged`, `in progress`,
  `review next block`, `resolved`, and `cancelled`, with an audit trail.
- **S3.5 Next-block check** — Define the metric and success threshold that will
  be evaluated against later accepted evidence.
- **S3.6 Recurrence linking** — A later signal links to the open action rather
  than silently creating a separate coaching thread.
- **S3.7 Outcome view** — Show baseline, later sample, change, confidence, and
  whether the coach marked the issue resolved.
- **S3.8 Workload controls** — Avoid flooding players; show per-player active
  actions and coach-configurable limits.

### Acceptance gate

- Creating an action never alters the underlying match evidence.
- Opening an action reaches its originating screenshot/round/replay reference.
- A future block can satisfy, regress, or remain inconclusive; inconclusive is
  not treated as failure.
- Archiving a tryout removes active access while preserving staff-owned history.
- Notifications honor visibility and role boundaries.

## S4 — Player and tryout comparisons

### Goal

Support roster decisions with matched samples instead of raw leaderboard totals.

### Work items

- **S4.1 Comparison selector** — Player vs player, tryout vs core average,
  player vs own previous period, block vs block, agent split, map split, and
  ATT vs DEF.
- **S4.2 Mirrored metrics** — K/D/A, K/D, KDA, ACS, ADR, HS, FK/FD, opening
  success, KAST, objectives, multikills, economy outcomes, weapon observations,
  and team record.
- **S4.3 Signed deltas** — Show direction, magnitude, samples, and confidence;
  do not color non-directional metrics as good/bad.
- **S4.4 Context matching** — Offer fair filters for map, side, agent/role,
  composition, opponent category, and date window.
- **S4.5 Team rank** — Rank only metrics with sufficient comparable coverage and
  label small samples.
- **S4.6 Decision notes** — Allow private staff notes and a deliberate status
  change among Core, Stand-in, Tryout, and Archived.
- **S4.7 Export** — Create an evaluation sheet that states evidence limitations.

### Acceptance gate

- No player is ranked on an unsupported or unmatched denominator.
- KAST is calculated only from fully covered rounds and never defaults to 100%.
- FK and FD show their evidence coverage separately.
- Historical rows retain the name/agent observed at match time after status changes.
- Player removal remains archival and revokes active access without deleting evidence.

## S5 — Configurable coach dashboard

### Goal

Let each staff workflow surface the most useful metrics without turning the
application into an unstructured analytics builder.

### Initial presets

- Practice block review
- Tryout evaluation
- Opening rounds
- Economy discipline
- Map pool
- Composition review
- Player development
- Evidence health

### Work items

- **S5.1 Card catalog** — Only registered cards with explicit data contracts,
  empty states, role requirements, and accessible labels may be placed.
- **S5.2 Layout controls** — Pin, unpin, reorder, resize within bounded choices,
  reset to preset, and minimize sections.
- **S5.3 Saved views** — Personal staff view and optional team-shared view with
  ownership and versioning.
- **S5.4 Global context** — Date/block, active maps, roster status, source, and
  evidence-confidence filters apply consistently to every compatible card.
- **S5.5 Guided custom card** — Later add Goal → Breakdown → Metric → Finish for
  approved datasets only; preview the real sample before saving.
- **S5.6 Export** — Per-card CSV/image export with filters and coverage recorded.

### Acceptance gate

- The default dashboard remains useful without configuration.
- No layout can hide critical sync, evidence-health, or unresolved-review state.
- Saved layouts synchronize without overwriting another staff member’s personal view.
- Keyboard reordering and reset are available.
- Mobile/web summary uses a deliberate responsive layout, not the desktop grid compressed.

## S6 — Tray-first lightweight capture

### Goal

Make reliable collection possible for players who should not need to operate the
full coaching application.

### Work items

- **S6.1 Capture mode** — Offer a focused tray experience from the signed main
  installer; evaluate a separate binary only if maintenance and signing remain shared.
- **S6.2 Device identity** — One-time, expiring pairing code; clear team name,
  device name, role, and upload destination.
- **S6.3 Status model** — Waiting for VALORANT, match detected, capture ready,
  capturing, review required, uploading, synchronized, paused, and actionable error.
- **S6.4 Capture preferences** — Fullscreen/windowed profiles, display selection,
  supported resolution/scaling, notification choice, startup, and offline queue.
- **S6.5 Automatic review transition** — Close the helper window after success
  and open the review surface automatically; never silently accept uncertain fields.
- **S6.6 Diagnostics** — Open captures/logs, export support bundle, copy plain
  error summary, retry, pause, disconnect, and health-check current permissions.
- **S6.7 Safety** — No input while a live round is active; visible pause; no hidden
  interaction; no process injection; post-match navigation only.

### Acceptance gate

- Tested at 1920×1080 fullscreen, fullscreen-windowed, and supported windowed mode.
- Handles 24-round regulation and overtime scrolling without missing round one.
- Supports layouts with and without Performance.
- Captures all ten scoreboard rows or reports exactly which rows are uncertain.
- Survives offline use, restart, update, rollback, and device re-pairing.
- Second physical Windows-PC acceptance remains a release requirement.

## S7 — Team notifications and Discord

### Goal

Deliver small, actionable updates without exposing private evidence or creating noise.

### Work items

- **S7.1 Notification events** — Capture accepted, block ready, action assigned,
  action due, evidence needs review, sync failed, and next practice reminder.
- **S7.2 Preferences** — Per-team and per-user channel, event, quiet-hours, and
  mention controls using Africa/Cairo scheduling.
- **S7.3 Discord pairing** — One-time code, server/channel allowlist, revocation,
  minimum scopes, and secret rotation.
- **S7.4 Bounded commands** — Latest block, latest results, assigned actions,
  schedule, and evidence-health summary; private replies by default where supported.
- **S7.5 Digest** — Coach-configurable block summary containing links into the
  authorized workspace, not raw screenshots or private tokens.
- **S7.6 Delivery audit** — Store event, destination identifier, status, retry,
  and redacted failure reason.

### Acceptance gate

- No player receives staff-only notes or another team’s data.
- Duplicate sync events produce one notification.
- Disconnect immediately invalidates the integration.
- Messages remain useful without requiring the desktop application to be open.
- Failed delivery never blocks capture acceptance or local analytics.

## S8 — Replay-backed spatial intelligence research

### Entry gate

Do not begin product implementation until the parser supports the current
VALORANT patch reliably and the replay/update compatibility contract has passed
multiple patch changes.

### Research questions

- Can positions, facing, health/armor, weapon, kills, plants, defuses, and utility
  states be extracted deterministically with timestamp coverage?
- Can source coverage and parser version be stored per event?
- Can a 2D replay remain useful when an ability or state is unknown?
- What storage, processing, redaction, and retention costs apply?
- Can replay artifacts be shared without distributing private raw replay files?

### Possible slices after the gate

1. Event timeline and seek controls.
2. Player paths and kill markers.
3. VOD timestamp alignment.
4. Utility/state rendering.
5. Trade context and territory control.
6. Cross-match heatmaps with coverage thresholds.

### Explicit limitation

Screenshots cannot substitute for spatial replay evidence. MoeTracker must not
infer exact positioning, vision, utility duration, pressure, or territory from
post-match scoreboard screens.

## S9 — Licensed public opponent intelligence

### Status

Deferred until the private coaching workflow is reliable, retention/security
policies are complete, and a lawful sustainable data source is approved.

### Potential scope

- Public team search and snapshots.
- Map pool, compositions, roster form, and available public VOD references.
- Team-to-team comparison with samples and evidence windows.
- Opponent profile carried into private picks/bans and match planning.
- Evidence-weighted ranking only with a published methodology and minimum samples.

### Explicit deferrals

- No unauthorized scraping or dependence on an unstable unofficial endpoint.
- No public exposure of private scrim data.
- No prediction product until source quality, calibration, and user value are proven.
- No tournament simulator before the private coaching loop is complete.

## Cross-cutting SaaS work

### Roles and tenancy

- Team and organization ownership, invitations, revocation, and membership audit.
- Manager, coach, analyst, captain, player, and read-only role capabilities.
- Server-enforced team scoping for every data and export route.
- Multiple-roster support only after single-team behavior is proven.

### Plans and limits

Package workflow depth rather than making accepted evidence disappear:

- **Free** — One team, screenshot/replay import, core match/map/player metrics,
  short history, and a usable first review loop.
- **Team** — Complete eligible history, review inbox, assignments, comparisons,
  dashboard layouts, team operations, and integrations.
- **Organization/Custom** — Multiple teams, shared ownership, advanced roles,
  retention controls, private deployment, SSO, and scoped integrations.

Exact prices, limits, and billing are separate product decisions. Plan downgrades
must never silently delete team evidence.

### Trust, support, and operations

- In-app support ticket or exported support bundle with version, health, logs,
  capture manifest, and explicit user-selected screenshots.
- Security and privacy pages that clearly separate local Riot material from
  synchronized match evidence.
- Data export, archive, deletion, retention, and account-revocation workflows.
- Public patch notes tied to the installed version and update channel.
- Automatic post-update health verification and last-known-good rollback.
- Signed installer before broad public distribution.

### Observability

- Redacted structured errors with stable error codes.
- Capture, OCR, acceptance, sync, aggregate, signal, notification, and update health.
- No raw credentials, pairing secrets, or private screenshot contents in telemetry.
- Coach-visible evidence-health status and developer support diagnostics remain separate.

## Definition of done for every milestone

A milestone is not complete until all applicable items pass:

1. Data contract and migration are versioned and reversible.
2. Role and team boundaries are covered by authorization tests.
3. Unknown, partial, contradictory, empty, and duplicate evidence fixtures pass.
4. Desktop offline behavior and cloud retry/idempotency pass.
5. Keyboard, screen-reader semantics, focus, contrast, zoom, and responsive layouts pass.
6. Existing active-map-pool and archived-player rules remain consistent.
7. Targeted tests pass during development; the full suite passes once on the final head.
8. Windows installer upgrade, health verification, and rollback are exercised in proportion to risk.
9. Release notes state what is automated, what is coach-confirmed, and what remains unsupported.
10. The feature links every calculated claim to its evidence and sample.

## First implementation slice

Begin with **S0.1–S0.3**, then implement **S1.1–S1.3** behind one internal
practice-block route and fixture set. Do not start S5, S7, S8, or S9 in parallel.

The first review checkpoint should demonstrate:

- two accepted matches grouped into one named block;
- ATT/DEF pistol, anti-eco, and bonus conversion;
- first-three-round performance for both sides;
- FK/FD and first-death recovery with explicit coverage;
- drill-through from a summary value to its accepted source rows; and
- no change to current match, player, economy, or map totals.
