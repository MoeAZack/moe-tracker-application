# Desktop-primary release acceptance

Accepted 13 October 2026, 13:31 Cairo (`Africa/Cairo`).

## Accepted head

- Main commit: `1ebc91d` (PR #8)
- CI: exact-head `verify` passed
- Local verification: lint, type checking, production build, 52 test files and 418 tests passed
- Focused collector, synchronization, and portable-package backtest: 10 consecutive passes
- Local production-browser checks: OCR worker passed; reduced website passed at desktop and mobile widths
- Packaged Windows check: isolated hidden launch, local workspace creation, and single-instance behavior passed

## Windows artifact

- File: `Moe-Tracker-Application-0.1.0-Setup.exe`
- Size: 179,290,943 bytes
- SHA-256: `82D4FCE518C0A9BC6D43618E1B54DD0AA30F533EC402FA193D55A4717CFA321D`
- The real user workspace was not used or modified during acceptance.

## Production cutover

- Public portal: `https://moetracker-site.pages.dev`
- Pages deployment: `953cf5ea`
- API Worker version: `a0e0542d-8435-4acc-8eaa-be8ff04a0b0b`
- Live health, anonymous-auth boundary, reduced bundle, CSP, and desktop/mobile login surface passed.
- Previous Pages rollback deployment: `538cde1b-681d-4ea0-a100-880771432cf1`
- Previous Worker rollback version: `015e2c64-e9ea-409d-b875-affd7e6b6379`

## Deliberately gated

- Automatic updates are staged: background checks are enabled in packaged builds, but download is user-triggered and installation requires an explicit restart.
- Automated WCAG 2.2 A/AA auditing and cached post-update health rollback are implemented. A trusted signing certificate, signed public release, and independent physical-PC/assistive-technology acceptance remain external release gates.
