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

## Measuring a change: field report and cell diff

Any OCR change is measured the same way, on the private corpus, on the coach's PC:

1. Run the backtest at the current main (the baseline) and at the change (the candidate):
   `node scripts/backtest-capture-browser.mjs <out-dir> <Scrim-* folders…>`
2. Compare them: `npm run ocr:report -- <candidate-dir> --baseline <baseline-dir>`.
   The report lists every cell that changed and exits 1 if any did. A change that claims "no regressions" needs zero cell diffs; a change meant to improve reading lists exactly the cells it fixed.
3. The same report gives per-field accuracy against the labels: for each field, how many cells were read correctly, how many were read wrong (**false accepts**: a value the app would save unless a coach catches it), how many were left empty for the coach, and the false-accept rate (wrong ÷ values given). It also splits these by resolution, Windows scale and layout, so a gap at 1600×900 or 150 % shows on its own.

Hand labels live in `tests/fixtures/capture-ground-truth.json`. More labels come for free from matches that were captured and also have an accepted replay: `node scripts/replay-joined-labels.mjs <db.json> <labels.json>` writes one label session per such match (score, round results, each allied player's agent and K/D/A from the replay, plus first bloods, first deaths, plants and defuses where the replay read them; those come from the replay values recorded when the replay was reconciled with the screenshot, because a saved row falls back to the screenshot value where the replay had none), and `--labels <labels.json>` grades the run against them. Those labels come from the team's own database, so the script refuses to write them inside the repository. A replay-joined label has no in-game name, so each one is paired with the output row nearest its K/D/A; a tie is left unpaired and reported rather than guessed.

### Resolutions the corpus lacks

`node scripts/backtest-capture-browser.mjs <out-dir> <Scrim-* folders…> --resample 1600x900` redraws every capture at 1600×900 (smoothed) before the unchanged pipeline reads it, and the field report groups that run under the resolution the pipeline read. This gives a labelled 1600×900 accuracy and false-accept figure from the existing sessions. It approximates a real 1600×900 client, which renders text natively rather than scaled, so real captures at that resolution are still the release evidence. Windows display scaling cannot be simulated this way: fullscreen Valorant renders at the game resolution whatever the Windows scale, so 125 %, 150 % and 200 % need real captures.

Below 1920×1080 (full 16:9 scoreboards only) each K/D/A number is read a second time from the same crop enlarged 1.5× more. When the second read is a different number the whole K/D/A line stays empty for the coach. When the two reads agree, the number carries the lower of their two confidences, so the usual K/D/A confidence floor (70) has to be cleared by both reads. A second read that finds no number does not overrule the first. Both reads are kept in the player's `rawMetrics.kdaReads` (digits and confidences only) so a run shows why a line was dropped. The first 1600×900 run turned a correct deaths value into a wrong one; requiring two agreeing reads at confidence 80 stopped that but dropped 12 correct cells, so only a contradicting read abstains now. The next run still accepted one wrong deaths value whose reads agreed at 74 and 45: the floor had looked at the first read only, and now looks at both. Each of the three numbers is then held to that floor on its own: a number whose two reads agree but fall under 70 is left empty while the other two are kept, instead of emptying the whole line (recognition `valorant-fields-v5`, cache `scoreboard-result/v5`). At 1920×1080 and above the read is unchanged.
