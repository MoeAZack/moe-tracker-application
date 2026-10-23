# OCR engines: Tesseract, PaddleOCR and ensemble

Settings → OCR health & learning → **Number reader** picks who reads the **full scoreboard's K/D/A numbers** on this PC. Every other number (plants, defuses, first kills and deaths, scores, the round screens' banks, loadouts and kill distances, performance, head-to-head and the player table) and all names, maps and labels are read by Tesseract in every mode, exactly as with the default. Everything runs offline from the app's own `/ocr-assets/`; no OCR request leaves the app.

Why only K/D/A: on the PC corpus (15 scrims, 1080p) PaddleOCR read every labelled K/D/A cell right, but on the other scoreboard columns it left most cells empty that Tesseract read (plants, defuses, first kills), and it changed about 10,000 round-screen values. Those crops (tiny single digits, icons next to numbers, coloured backgrounds) are not what it was measured on, so it doesn't read them (`numberReaderFor` in `lib/ocrEngines.ts`).

| Setting | What reads numbers | When a number is kept |
| --- | --- | --- |
| Tesseract (default) | Tesseract 7, as before | Unchanged |
| PaddleOCR numbers | Scoreboard K/D/A: PP-OCRv4 recognition model in ONNX Runtime WebAssembly. Everything else: Tesseract | Same parser rules and K/D/A confidence floor as Tesseract |
| Ensemble (must agree) | Scoreboard K/D/A: Tesseract, PaddleOCR and, once they know the digits, learned templates of the game font. Everything else: Tesseract | At least two voters read the same digits and no voter read anything else. A voter that finds nothing abstains; any different number from any voter leaves the cell empty. Confidence is the lowest of the votes. With two voters this is plain "both must agree". A K/D/A line the splitter can't cut into three numbers stays empty (Tesseract's whole-line fallback has no second opinion). |

### Learned digit templates (third voter)

`lib/glyphTemplates.ts`. Nothing ships pre-trained. In Ensemble mode a K/D/A number teaches the templates when PaddleOCR reads it at calibrated confidence ≥ 96 (probability ≈ 0.97) and Tesseract did not read a different number. Each digit glyph becomes a 12×16 normalised vector, kept per scoreboard image height (1080p and 900p glyphs differ), at most 12 per digit, newest first. A digit votes once it has 3 examples; a number is read only when every glyph's best digit correlates ≥ 0.8 and leads the next digit by ≥ 0.05, otherwise the templates abstain. Stored in this PC's browser profile (`moetracker.glyph-templates/v1`), shown and resettable under Number reader. The capture backtest carries them from one session to the next in folder order.

**Learning from your corrections.** When a reviewed import is saved (and OCR learning is on), every K/D/A cell the coach corrected or kept teaches the templates the saved value for that row's glyphs. A correction is exactly a digit both engines got wrong or missed, so this teaches what agreement alone can't. A value whose digit count doesn't match the glyphs found is skipped.

**Pre-training from past scrims.** `node scripts/backtest-capture-browser.mjs <out> <capture folders> --engine ensemble --save-templates <file>` writes the templates learned over the whole run. The script refuses a path inside the repository: the file is learned from private captures and stays on that PC. Settings → Number reader → **Import digit templates** merges such a file into this PC's templates (per-digit caps still apply, the file's examples become the newest).

### Confidence calibration

PaddleOCR's confidence is the weakest digit's softmax probability, not Tesseract's 0..100 score. `calibratedPaddleConfidence` maps probability 0.75 to 70 (the K/D/A floor and the learned-rule ceiling), 0.75..1 onto 70..100 and 0..0.75 onto 0..70. On the committed fixtures (540 reads: 270 numbers in both framings the app uses) every wrong PaddleOCR read had probability ≤ 0.67. Template confidence is the weakest glyph's correlation × 100 (≥ 80 whenever they vote).

The default is unchanged: with Tesseract selected the reads, source model string, recognition-cache keys and learned-rule scope are byte-for-byte what they were. Another engine gets its own source model (`…/parser-v1+numbers:ppocrv4-rec-digits-v1`, or `…+numbers:ensemble(tesseract,ppocrv4-rec-digits-v1)`), its own cache entries, and its own learned corrections: a rule learned from Tesseract's mistakes does not describe PaddleOCR's. If PaddleOCR cannot start, the adapter reads with Tesseract and reports `engine: 'tesseract'`, so drafts stay truthful.

Code: `lib/ocrEngines.ts` (engine ids, ensemble vote, PP-OCR preprocessing and digits-only CTC decode, browser loader), `lib/localOcrEngine.ts` (`createBrowserLocalTesseractAdapter({ engine })`), `src/utils/ocrEngineSetting.ts`, `src/components/OcrEngineSetting.tsx`.

## Measured on committed fixtures

`npm run ocr:engines` reads the 90 round numbers above the tiles in `tests/fixtures/timeline/*.png` (real VALORANT HUD digits, about 11 px tall at 1080p; labels in `round-numbers.json`), at 1080p and resampled to 900p and 720p, through the app's numeric preprocessing:

| Client | Tesseract (app's K/D/A read) | PaddleOCR v4 | Ensemble, 2 voters | Ensemble + templates, first pass | Ensemble + templates, warm |
| --- | --- | --- | --- | --- | --- |
| 1080p | 75/90, 11 wrong (3 at/above floor 70) | 90/90, 0 wrong | 75/90, 0 wrong | 77/90, 0 wrong | 79/90, 0 wrong |
| 900p | 71/90, 6 wrong | 90/90, 0 wrong | 71/90, 0 wrong | 77/90, 0 wrong | 81/90, 0 wrong |
| 720p | 54/90, 12 wrong (1 at/above floor) | 90/90, 0 wrong | 54/90, 0 wrong | 67/90, 0 wrong | 75/90, 0 wrong |
| Time per number (CPU, 1 thread) | ~13 ms | ~19 ms (WASM) | ~32 ms | same | same |

"First pass" starts with no templates and learns as it goes; "warm" reads the same numbers again with what was learned (the state after a few scrims). Ensemble never takes a number Tesseract read differently, so Tesseract's wrong reads cap it below PaddleOCR alone. That is the price of "no false accept". On held-out fixtures (leave one image out) the templates alone made no wrong read (`tests/glyphTemplates.test.ts`).

`tests/ocrEngines.test.ts` holds PaddleOCR to ≥ 88/90 per resolution and zero wrong reads at or above the K/D/A floor on these fixtures.

These are round-number digits, not the scoreboard's K/D/A cells: same font family, smaller. The scoreboard corpus is private and runs on the PC (below).

## Candidates considered

| Candidate | Verdict |
| --- | --- |
| **PaddleOCR PP-OCRv4 rec** (via ONNX Runtime Web) | **Shipped as the second engine.** Apache-2.0 model from the MIT `@gutenye/ocr-models` npm package; runs in the renderer next to Tesseract under the same CSP. 10.8 MB model + 14.2 MB WebAssembly. Best accuracy and the only candidate whose wrong reads all fell below the confidence floor. |
| PaddleOCR PP-OCRv3 en / latin, v5 mobile, v6 tiny, v6 small | Measured in a scratch benchmark. v6 small was perfect at 900p/720p but read 7 as 1 with 0.75–0.86 confidence at 1080p (confident false reads); v5 mobile 66/90 at 1080p; v3 worse at 720p. Not npm-published, so harder to pin. |
| ScoreSight (OBS scoreboard OCR) | Python/Qt app. Uses PaddleOCR PP-OCR ONNX models plus custom-trained Tesseract models for LED/7-segment scoreboards. Its approach matches what is shipped here; the app itself can't be embedded. |
| owocr (GameSentenceMiner) | Python wrapper over many engines. Its offline engines that matter here are Windows OneOCR (Snipping Tool's DLL: not redistributable; Windows 11 only), WinRT OCR (below), RapidOCR (= PaddleOCR ONNX, shipped here), EasyOCR, Manga OCR (Japanese). Its online engines (Google Lens, Bing) break the offline rule. |
| Windows.Media.Ocr (WinRT OCR) | Built into Windows 10/11, zero install size, needs the English language pack. Needs a PowerShell or native bridge from Electron's main process; can't be measured off Windows. Candidate for a third ensemble voter after a PC measurement. |
| EasyOCR / TrOCR-style transformers | PyTorch: Python runtime, hundreds of MB, slow on CPU. Not redistributable in an unsigned installer without Python. |
| Fixed-font digit templates | **Shipped as Ensemble's third voter** (above), learned on the PC from very sure PaddleOCR reads. They also learn from coach-corrected K/D/A cells and can be pre-trained from past captures (above). |

## Making PaddleOCR or Ensemble the default

Only after the PC runs below. Proposed bar: on corpus14 at 1080p and resampled 1600x900, the candidate has 0 false accepts and at least as many correct K/D/A cells as Tesseract, with and without the learned model. Then switch `DEFAULT_OCR_ENGINE` in one small PR. PCs that already chose an engine keep their choice. A default change resets learned corrections for numbers (new source model), so the PR should say so in the release notes.

## PC runs needed before the default could change

Run on the PC with corpus14 (`C:\Dev\tmp\ocr-regress\corpus14`) after `npm run build`; relay counts only.

1. Default unchanged: `node scripts/backtest-capture-browser.mjs <out>\tesseract <corpus folders>` then `npm run ocr:report -- <out>\tesseract --baseline <baseline-b1e8e12>` → expect 0 cell diffs.
2. Per engine: the same with `--engine paddle` and `--engine ensemble` into separate folders (ensemble's templates carry across the sessions in folder order), each `npm run ocr:report -- <out>\<engine> --baseline <baseline-b1e8e12>`: K/D/A ground-truth accuracy, false accepts (must be 0), cell diffs vs baseline, and `baseline.outcomeChanges`: `abstained->correct` / `abstained->falseAccept` are the cells the engine read where Tesseract left them empty, right and wrong (PaddleOCR and the templates learned from it are correlated voters, so this is where Ensemble could agree on a wrong number), and `correct->falseAccept` must be 0.
3. With the learned model: repeat 2 with `CORRECTION_MODEL_JSON` set. Expect the Tesseract-scoped rules not to fire for paddle/ensemble (their source model differs).
4. 1600x900: repeat 2 with `--resample 1600x900`.
5. Timing: the `seconds` field per session in each output, Tesseract vs paddle vs ensemble.
