# Release runbook

Rewritten 22 October 2026, Africa/Cairo. The earlier Cloud Run and Firebase
release path was retired; its workflow and Google identities no longer exist.
Merging to `main` never ships anything by itself. There are two separate
deliveries: the Windows installer and the website.

## Windows installer

The owner decided not to buy a code-signing certificate, so releases are
unsigned. Consequences, all deliberate:

- Windows SmartScreen warns on first run.
- Automatic updates stay blocked: `desktop/update-trust.cjs` fails closed and
  `update-trust.json` keeps `publisherNames` empty. Do not add names.
- `.github/workflows/release-windows.yml` requires a signature, so it stays red
  and never publishes. It is kept for the day signing exists.

Steps for a version:

1. Merge the reviewed changes. CI on `main` must be green, including the
   `windows-lifecycle` install, upgrade and rollback job.
2. On the owner's PC, from a clean checkout at the exact commit, set
   `YOUTUBE_DL_SKIP_DOWNLOAD=1` (as CI does), then run `npm ci`,
   `npm run check` and `npm run desktop:installer`.
3. Run `npm run verify:candidate`. Expect `localCandidateReady: true` and
   `publicReady: false` (unsigned).
4. Record the installer SHA-256. Run the upgrade check on a copy of the owner's
   workspace (`scripts/workspace-upgrade-check.mts`), never on the live one.
5. Publish only with the owner's explicit permission for that version: tag
   `v<version>` on the exact commit and attach the installer and
   `SHA256SUMS.txt` only. The release notes say it is unsigned, explain the
   SmartScreen warning and that automatic updates are off.

## Website

The canonical address is `https://moezack.pages.dev`. `moetracker-site.pages.dev`
and `moetracker.moeazack.workers.dev` redirect pages there but keep serving
`/api`, because installed desktops sync through `moetracker-site`.

Deploys run from the owner's PC after `wrangler login`:

- `npm run cf:migrate:remote` when a D1 migration was added.
- `npm run cf:worker:deploy` for the API worker.
- `npm run cf:pages:deploy` for the static site (both Pages projects).

Each deploy stamps the commit, so `/api/health` and `/build.json` name the same
revision. Check both after deploying.
