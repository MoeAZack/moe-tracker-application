# Product audit implementation register

Last updated: 18 Oct 2026 (Africa/Cairo)

This register separates shipped code, automated verification, physical acceptance, and external dependencies. A feature is not called released merely because code exists.

## Ordered delivery

| Order | Workstream | State | Acceptance evidence |
|---|---|---|---|
| 1 | Coaching correctness | Implemented | Practice chronology comes from match dates; metric direction, unit, context, and minimum samples are explicit; missing or old evidence stays inconclusive; regression tests cover these boundaries. |
| 2 | Player coaching actions | Implemented | Players may only acknowledge or start their own team-visible assignments; unsuccessful writes are visible in the UI; HTTP tests exercise the real middleware. |
| 3 | Desktop session continuity | Implemented | Desktop sessions renew before expiry and retry once after an authenticated 401 without interrupting tray capture. |
| 4 | Account protection | Implemented | New player passwords require 10 characters; password sessions remain revocable; IP and account throttles persist in D1, Firestore, or the private local runtime store. |
| 5 | Shared review context | Implemented | Block, map, source, and evidence-confidence context is applied to summary cards, review signals, and linked actions. |
| 6 | Honest analytics | Implemented | The lineup view reports descriptive observations and coverage instead of an invented predictive compatibility score. |
| 7 | Desktop security boundary | Implemented | External navigation and child windows are denied; sensitive desktop operations validate the sender origin. |
| 8 | Storage honesty | Implemented | The application write ceiling is displayed separately from the provider storage baseline. |
| 9 | Release ordering and Windows CI | Implemented; certificate gate open | Release order is build/sign, signature check, clean install check, then publish. Normal CI includes Windows capture and workflow tests. |
| 10 | Review usability | Implemented | Failed loads show Retry, corrections use a bounded evidence/reason panel, and layout controls live behind Edit layout. |
| 11 | Repository readiness | Implemented | Security reporting, contribution guidance, installation notes, release-state documentation, and an explicit license decision are present. |
| 12 | Audit closure pass | Implemented | Legacy action checks migrate to policy v2 with immutable history; evidence coverage is percentage-based; stale observations cannot satisfy actions; private action IDs remain private; API credentials use an exact-origin boundary; every privileged IPC handler shares one sender check; D1 throttling increments atomically. |
| 13 | Player VOD submissions | Implemented | Local OCR retains no raw image on the server; five unique active roster identities are mandatory; evidence can link to an existing screenshot/replay match or create a new match; only unknown stat fields are filled and every contribution retains its VOD submission provenance. |

Repository rules require a pull request, one approval, resolved review threads, and both Linux and Windows checks on `main`; repository administrators retain an explicit emergency bypass. Release tags cannot be created, moved, or deleted without that bypass. Dependabot security updates, secret scanning, push protection, and private vulnerability reporting are enabled.

## Next product increments

The two October product audits are consolidated into this order. Trust and traceability stay ahead of new breadth.

1. **Analytics trust and safe ingestion (0.1.51).** Reconcile duplicate player rows per match, preserve mixed historical/current screenshot coverage, keep unavailable metrics unknown, expose identity confidence, separate match acceptance from round completeness, prevent sampled VOD timing from claiming complete trade/KAST/ultimate evidence, and add cancel/timeout/disk guards to long VOD analysis.
2. **Connected player profiles (0.1.52).** Every player row opens one profile with source identities, aliases, evidence-linked match history, source/correction coverage, and coach-only reversible identity relinking. Metric evidence remains inside the expanded profile so the summary table stays compact.
3. **Unified match review (0.1.53).** One persisted match/round context now follows the coach across scoreboard, round log, replay, VOD, economy, and coaching surfaces. Replay evidence auto-focuses the selected match, VOD notes inherit the selected round, and economy calculations scope to the same context while unsupported evidence remains unavailable.
4. **Practice-to-progress (0.1.54).** Manual and PRACC calendar sessions attach to coach-confirmed recorded matches and goals through one persisted practice block. The calendar then reports attendance, accepted findings, evidence health, and goal completion together; same-day/opponent matches are suggested without silently linking uncertain data.
5. **Release and adoption (0.1.55 internal readiness complete; external gates open).** Settings now explains the zero-confirmation evidence workflow, reports local service/capture/recovery/sync readiness, creates an encrypted recovery point on demand, and labels public signing plus independent second-PC acceptance as external gates. Signed Windows publishing and the physical second-PC run remain deliberately unclaimed.
6. Discord delivery for accepted summaries and assignments, including deduplication, quiet hours, delivery status, and permission-aware links.
7. Calendar export first, then optional provider synchronization with cancellation and conflict handling.
8. Versioned JSON/CSV import with mapping preview, duplicate detection, provenance, and partial-import explanations.
9. Versioned tactical boards and map assets linked to reviewed rounds.
10. Official Riot integration only after product registration, production approval, and player opt-in.

## External acceptance gates

- A public Windows code-signing certificate and repository signing secrets.
- A second physical Windows PC installation, capture, offline restart, pairing, sync, update, and rollback run.
- Third-party credentials or approval for Discord, calendar providers, hosted VOD, or Riot APIs.
