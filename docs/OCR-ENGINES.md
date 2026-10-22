# OCR engines: Tesseract, PaddleOCR and ensemble

Settings → OCR health & learning → **Number reader** picks who reads scoreboard numbers on this PC (K/D/A, scores, first bloods, plants, defuses, round-screen loadouts/banks/distances). Names, maps and labels are always read by Tesseract. Everything runs offline from the app's own `/ocr-assets/`; no OCR request leaves the app.

| Setting | What reads numbers | When a number is kept |
| --- | --- | --- |
| Tesseract (default) | Tesseract 7, as before | Unchanged |
| PaddleOCR numbers | PP-OCRv4 recognition model in ONNX Runtime WebAssembly | Same parser rules and K/D/A confidence floor as Tesseract |
| Ensemble (both must agree) | Both engines read every number | Only when both read the same digits. Any disagreement, or one engine finding no number, leaves the cell empty. Confidence is the lower of the two. A K/D/A line the splitter can't cut into three numbers stays empty (Tesseract's whole-line fallback has no second opinion). |

The default is unchanged: with Tesseract selected the reads, source model string, recognition-cache keys and learned-rule scope are byte-for-byte what they were. Another engine gets its own source model (`…/parser-v1+numbers:ppocrv4-rec-digits-v1`, or `…+numbers:ensemble(tesseract,ppocrv4-rec-digits-v1)`), its own cache entries, and its own learned corrections: a rule learned from Tesseract's mistakes does not describe PaddleOCR's. If PaddleOCR cannot start, the adapter reads with Tesseract and reports `engine: 'tesseract'`, so drafts stay truthful.

Code: `lib/ocrEngines.ts` (engine ids, ensemble vote, PP-OCR preprocessing and digits-only CTC decode, browser loader), `lib/localOcrEngine.ts` (`createBrowserLocalTesseractAdapter({ engine })`), `src/utils/ocrEngineSetting.ts`, `src/components/OcrEngineSetting.tsx`.

## Measured on committed fixtures

`npm run ocr:engines` reads the 90 round numbers above the tiles in `tests/fixtures/timeline/*.png` (real VALORANT HUD digits, about 11 px tall at 1080p; labels in `round-numbers.json`), at 1080p and resampled to 900p and 720p, through the app's numeric preprocessing:

| Client | Tesseract (app's K/D/A read) | PaddleOCR v4 | Ensemble |
| --- | --- | --- | --- |
| 1080p | 75/90, 11 wrong (3 at/above floor 70) | 90/90, 0 wrong | 75/90, 0 wrong |
| 900p | 71/90, 6 wrong | 90/90, 0 wrong | 71/90, 0 wrong |
| 720p | 54/90, 12 wrong (1 at/above floor) | 90/90, 0 wrong | 54/90, 0 wrong |
| Time per number (CPU, 1 thread) | ~14 ms | ~20 ms (WASM) | ~34 ms |

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
| Fixed-font digit templates learned from accepted cells | A leave-one-fixture-out nearest-template test on the same fixtures read 90/90 at 1080p and 89/90 (1 abstain) at 720p with no wrong reads; trained at 1080p and tested at 720p: 86/90 with 4 abstains, 0 wrong. Needs labelled glyphs of the scoreboard's K/D/A font at each resolution, which only accepted scoreboards on the PC can provide. Recommended as the next voter, built on lib/ocrLearning.ts. |

## PC runs needed before the default could change

Run on the PC with corpus14 (`C:\Dev\tmp\ocr-regress\corpus14`) after `npm run build`; relay counts only.

1. Default unchanged: `node scripts/backtest-capture-browser.mjs <out>\tesseract <corpus folders>` then `npm run ocr:report -- <out>\tesseract --baseline <baseline-b1e8e12>` → expect 0 cell diffs.
2. Per engine: the same with `--engine paddle` and `--engine ensemble` into separate folders, each `npm run ocr:report -- <out>\<engine> --baseline <baseline-b1e8e12>`: K/D/A ground-truth accuracy, false accepts (must be 0), cell diffs vs baseline.
3. With the learned model: repeat 2 with `CORRECTION_MODEL_JSON` set. Expect the Tesseract-scoped rules not to fire for paddle/ensemble (their source model differs).
4. 1600x900: repeat 2 with `--resample 1600x900`.
5. Timing: the `seconds` field per session in each output, Tesseract vs paddle vs ensemble.
