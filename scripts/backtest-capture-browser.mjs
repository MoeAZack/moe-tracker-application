// Offline capture backtest: runs the shared capture pipeline in headless
// Chromium over one or more Scrim-* folders and writes the extracted drafts.
//   node scripts/backtest-capture-browser.mjs <out-dir> <capture-folder>... [--resample 1600x900]
// --resample redraws every capture at that size first, to measure a resolution the corpus lacks.
// Requires `npm run build` first (serves dist/ with the OCR/agent/weapon assets).
// Optional: CHROMIUM_PATH (defaults to Playwright's bundled browser),
// ROSTER_JSON (path to [{id?, displayName}]), CORRECTION_MODEL_JSON (a learned
// correction model, as exported from Settings → OCR Health & Learning, to measure its effect).
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const resampleIndex = args.indexOf('--resample');
const resampleText = resampleIndex >= 0 ? args.splice(resampleIndex, 2)[1] : null;
const resampleMatch = resampleText ? /^(\d{3,4})x(\d{3,4})$/.exec(resampleText) : null;
if (resampleText && !resampleMatch) throw new Error('--resample takes WIDTHxHEIGHT, for example 1600x900.');
const resample = resampleMatch ? { width: Number(resampleMatch[1]), height: Number(resampleMatch[2]) } : null;
const [outDir, ...folders] = args;
if (!outDir || !folders.length) throw new Error('Usage: node scripts/backtest-capture-browser.mjs <out-dir> <capture-folder>...');
const root = process.cwd();
const dist = path.join(root, 'dist');
if (!existsSync(path.join(dist, 'ocr-assets'))) throw new Error('Run `npm run build` first so dist/ocr-assets exists.');
const js = path.join(dist, 'capture-backtest.js');
const html = path.join(dist, 'capture-backtest.html');
await build({ entryPoints: [path.join(root, 'scripts', 'capture-backtest-entry.ts')], outfile: js, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning' });
await writeFile(html, '<!doctype html><meta charset="utf-8"><script type="module" src="/capture-backtest.js"></script>');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    const url = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    const file = path.normalize(path.join(dist, url));
    if (!file.startsWith(dist)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath, headless: true });
const rosterPlayers = process.env.ROSTER_JSON ? JSON.parse(await readFile(process.env.ROSTER_JSON, 'utf8')) : [];
const correctionFile = process.env.CORRECTION_MODEL_JSON ? JSON.parse(await readFile(process.env.CORRECTION_MODEL_JSON, 'utf8')) : undefined;
const correctionModel = correctionFile?.model ?? correctionFile; // the export holds { model, … }; a bare model works too
await mkdir(outDir, { recursive: true });
try {
  for (const folder of folders) {
    const names = await readdir(folder);
    const captures = [];
    for (const name of names.sort()) {
      const round = name.match(/^round-(\d+)\.png$/i);
      const kind = round ? 'round' : name === 'scoreboard.png' ? 'scoreboard' : name === 'performance.png' ? 'performance' : name === 'head-to-head.png' ? 'head-to-head' : null;
      if (!kind) continue;
      captures.push({ kind, ...(round ? { round: Number(round[1]) } : {}), name, mediaType: 'image/png', base64: (await readFile(path.join(folder, name))).toString('base64') });
    }
    const page = await browser.newPage();
    page.on('pageerror', error => console.error(`[${path.basename(folder)} page-error] ${error.message}`));
    await page.goto(`${origin}/capture-backtest.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__runCaptureBacktest === 'function', null, { timeout: 60_000 });
    const started = Date.now();
    const result = await page.evaluate(async data => await window.__runCaptureBacktest(data), { captures, rosterPlayers, resample, correctionModel });
    await page.close();
    const output = path.join(outDir, `${path.basename(folder)}.json`);
    await writeFile(output, JSON.stringify({ folder: path.basename(folder), seconds: Math.round((Date.now() - started) / 1000), ...result }, null, 2));
    console.log(`${path.basename(folder)}: ${result.meta.map} ${result.meta.ourScore}-${result.meta.theirScore} · ${result.rounds.length} rounds · ${Math.round((Date.now() - started) / 1000)}s`);
  }
} finally {
  await browser.close();
  server.close();
  await Promise.all([rm(js, { force: true }), rm(html, { force: true })]);
}
