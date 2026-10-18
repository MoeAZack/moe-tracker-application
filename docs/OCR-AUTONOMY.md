# OCR autonomy and acceptance

MoeTracker processes a complete post-match capture as a versioned local evidence pipeline:

1. Detect the Summary layout, score positions, player-row offset and round tiles.
2. Hash every image and reuse cached raw recognitions for the exact image, crop geometry and recognizer version.
3. Run field-specific local recognition. Uncertain numeric cells receive a second grayscale pass; disagreement remains unknown.
4. Reconcile printed round numbers, vote on repeated names, normalize maps against the configured pool and cross-check totals.
5. Save automatically only when five allied identities, map, score, starting side, every round result and every round evidence record are complete and internally consistent.
6. Leave exceptions in the capture inbox. Coach edits remain authoritative and are never overwritten by a later OCR run.

## Private correction learning

Version 0.1.39 records coach changes to accepted screenshot matches as local labels in IndexedDB. Labels contain the capture identifier, OCR region, predicted value, corrected value, layout, resolution and extractor version; screenshot bytes are not copied into the learning store. Player-name corrections become aliases immediately. A field correction rule becomes active only after three identical corrections for the same extractor version, layout and resolution, and remains exportable and auditable.

Every capture also records a shadow outcome (automatic or exception), cache hits, resolution, layout, confirmed-round coverage and exception reasons. Coaches can inspect and export this evidence under **Settings → OCR Health & Learning**. This is an explainable incremental model, not a claim that a neural model has been trained; a later offline trainer can join exported labels to the retained private capture by `captureId` and `sourceRegion`.

Accepted replay evidence retains a field-by-field reconciliation record against screenshot facts. Disagreements are marked as conflicts rather than being hidden. Automatic opponent recovery requires a unique overlap of at least three enemy names with a previously recorded opponent roster.

Cloud OCR is disabled by default. A coach may enable **Local first, Gemini only for unresolved captures** in Settings. Only the final scoreboard is sent after local attempts fail; round screenshots remain local. Cloud fields are merged only through a unique exact K/D/A link and must still pass the same automatic-acceptance gate.

## Corpus gate

`npm run test:ocr-corpus` validates the labelled corpus and prints its coverage gaps. `-- --require-complete` is the future release gate once private, consented screenshots fill every declared target. Private screenshots and player identifiers are not committed; the repository stores labels/coverage metadata and the reusable backtest harness.

Required expansion currently includes 1600×900, competitive layout, overtime, and Windows scaling at 125%, 150%, and 200%. Accuracy claims must be reported per field and must include false-accept rate, not only the percentage of populated cells.
