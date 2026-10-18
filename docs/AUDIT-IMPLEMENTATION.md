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

Repository rules require a pull request, one approval, resolved review threads, and both Linux and Windows checks on `main`; repository administrators retain an explicit emergency bypass. Release tags cannot be created, moved, or deleted without that bypass. Dependabot security updates, secret scanning, push protection, and private vulnerability reporting are enabled.

## Next product increments

1. Round/event-linked local VOD playback with stored synchronization offsets.
2. Discord delivery for accepted summaries and assignments, including deduplication, quiet hours, delivery status, and permission-aware links.
3. Calendar export first, then optional provider synchronization with cancellation and conflict handling.
4. Versioned JSON/CSV import with mapping preview, duplicate detection, provenance, and partial-import explanations.
5. Versioned tactical boards and map assets linked to reviewed rounds.
6. Official Riot integration only after product registration, production approval, and player opt-in.

## External acceptance gates

- A public Windows code-signing certificate and repository signing secrets.
- A second physical Windows PC installation, capture, offline restart, pairing, sync, update, and rollback run.
- Third-party credentials or approval for Discord, calendar providers, hosted VOD, or Riot APIs.
