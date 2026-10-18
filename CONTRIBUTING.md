# Contributing

1. Create a focused branch and keep unrelated changes out of the pull request.
2. Preserve evidence provenance and unknown values. Missing data must never become zero or be presented as confirmed.
3. Add regression tests and run `npm run check` before opening a pull request.
4. For capture or desktop changes, also run `npm run test:scrim-capture` on Windows.
5. Never commit replay files, screenshots, access keys, signing material, team exports, or private data.
6. State the user journey, risk, test evidence, and any physical or third-party acceptance gate still open.

Security findings follow [SECURITY.md](SECURITY.md), not the public issue tracker.

