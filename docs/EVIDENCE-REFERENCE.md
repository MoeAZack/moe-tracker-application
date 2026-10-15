# Canonical evidence reference (S0.1)

Schema identifier: `moetracker.evidence-reference/v1` · Implementation: [`lib/evidenceReference.ts`](../lib/evidenceReference.ts) · Tests: [`tests/evidenceReference.test.ts`](../tests/evidenceReference.test.ts)

A derived claim (a summary value, a later review signal or assignment) links to its source through one small reference. The reference names existing identifiers; it never contains screenshot pixels, crops, replay payloads, file paths, VOD URLs, tokens, device credentials or private actor identifiers.

## Contract

| Field | Meaning | Existing source it reuses |
| --- | --- | --- |
| `schema` | Stable versioned identifier; any other value is rejected. | — |
| `scope.workspaceId` | Owning team workspace (`ws_…`). Required. | `db.workspace.id` (see compatibility) |
| `scope.ownerDeviceId` | Device that captured or synchronized the evidence, when known. | `engineAdapters.screenshot[*].sourceDeviceId`, replay associations, screenshot records |
| `state` | `draft`, `accepted` or `rejected`. Only accepted references carry `acceptedAt`. | match `reviewConfirmation`, `engineAdapters.replay[*].status`, `replayIntake.reviews[*].status` |
| `sourceTypes` | Sorted, de-duplicated: `screenshot`, `replay`, `vod`, `manual`, `live-logger`, `provider-import`, `unknown` (`unknown` must stand alone). | `Match.sourceMetadata.method` |
| `matchId` | Match identifier. | `Match.id` |
| `round` | `roundId` and/or `roundNumber` (1–99, overtime included). | `Round.id`, `Round.roundNo` |
| `captureSessionId` | Post-match capture session. | `capture-manifest.json` `captureId` → `Match.screenshotEvidence.captureId` |
| `screenshot` | `artifactId`, `imageSha256`, `captureKind` (`scoreboard`/`performance`/`head-to-head`/`round`), `cropRegionId`. | `replayIntake.screenshots[*]`, OCR region IDs |
| `replay` | `sha256` (required) and parser `evidenceSha256`. | replay SHA-256, `rawEvidenceHash` |
| `vod` | `vodReviewId`, `noteId`, `atSeconds`. | `VodReview.id`, `VodNote.id` |
| `producer` | `parser`, `ocr`, `capture` version labels. | `vrfkit@0.2.5`, `tesseract-local@tesseract-7/eng/parser-v1` |
| `capturedAt`, `acceptedAt` | ISO instants normalized to UTC; the UI presents them in Africa/Cairo. | `sourceMetadata.capturedAt`, `confirmedAt`, replay `acceptedAt` |
| `observedIdentities` | Up to 20 `{ playerId, observedName, agent, team }` snapshots taken at capture/acceptance time. | `PlayerStats.displayNameSnapshot`, `agent`, review mappings |
| `confidence` | Optional `confirmed`/`high`/`medium`/`low`. | `RoundScreenshotEvidence.confidence` |
| `fieldProvenance` | Optional map of field → `{ source, confidence (0–100 or null) }`. | `RoundScreenshotEvidence.fieldConfidence` |

## Rules enforced

- Missing optional data is `null` or an empty list. Nothing is defaulted to zero, guessed, or coerced from a string.
- A source type must name the evidence it claims (a replay needs its SHA-256; a screenshot needs a locator, capture session or match), and named evidence must appear in `sourceTypes`.
- Synthetic capture keys such as `name:alpha` are never treated as roster identities.
- Unknown fields, invalid identifiers, malformed hashes, out-of-range rounds and references over 32 KiB are rejected.
- `serializeEvidenceReference` is canonical (sorted keys, normalized hashes and instants), so `evidenceReferenceKey` is a stable SHA-256 for de-duplication.

## Resolution and team boundary

`resolveEvidenceReference(db, reference, { workspaceId })` rejects with `cross-workspace` unless the caller's workspace, the reference's workspace and the stored workspace are identical, and with `workspace-unidentified` when the store has no identity yet. It then re-checks storage: the match (active season first, then preserved season archives), round, capture session, replay, screenshot record and VOD note must exist and agree. A reference claiming `accepted` for evidence that storage holds as a draft fails with `state-mismatch`; retained screenshot review records are always drafts. Resolution returns identifiers, states and each observed identity alongside its current roster status. It never returns raw evidence and never rewrites the snapshot.

## Compatibility

- Existing matches, rounds, replay records and screenshot records are not rewritten. The `evidenceReferenceFor{Match,Round,Replay,ScreenshotRecord}` adapters derive references on demand from today's fields.
- An accepted match reference includes a replay only when that replay is itself accepted. A replay draft gets its own draft reference.
- Legacy matches without source metadata produce `sourceTypes: ['unknown']`. An accepted legacy row that never recorded an acceptance time keeps `acceptedAt: null`.
- The workspace identity (`db.workspace = { schemaVersion: 1, id, createdAt }`) is created on the first persisted write (JSON, Firestore and D1 paths) and is never replaced. Reads never create it, so an unsaved identity cannot change between requests. It survives season archive/reset and is not copied by portable-package import. A complete restore carries the restored workspace's own identity.

## Known limitations

- Each store mints its own workspace identity. A paired desktop and the cloud workspace currently have different identities, so a reference built on one does not resolve on the other until pairing shares the team identity.
- No route or screen creates or consumes references yet. S1 is the first consumer.
- `rejected` is supported by the contract, but no current workflow records a coach rejection. S2 review state supplies that.
- Local capture images stay on the capturing device and have no stored artifact ID. Accepted screenshot references therefore point at the capture session, round and capture kind rather than an image hash.
