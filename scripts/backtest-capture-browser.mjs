import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const folder = process.argv[2];
const origin = process.argv[3];
if (!folder || !origin) throw new Error('Usage: node scripts/backtest-capture-browser.mjs <capture-folder> <app-origin>');
const root = process.cwd();
const js = path.join(root, 'dist', 'capture-backtest.js');
const html = path.join(root, 'dist', 'capture-backtest.html');
await build({ entryPoints: [path.join(root, 'scripts', 'capture-backtest-entry.ts')], outfile: js, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
await writeFile(html, '<!doctype html><script type="module" src="/capture-backtest.js"></script>');
const names = await readdir(folder);
const rounds = names.filter(name => /^round-\d+\.png$/i.test(name)).sort().map(name => ({ round: Number(name.match(/\d+/)?.[0]), name, base64: null }));
const payload = {
  scoreboard: (await readFile(path.join(folder, 'scoreboard.png'))).toString('base64'),
  performance: names.includes('performance.png') ? (await readFile(path.join(folder, 'performance.png'))).toString('base64') : null,
  headToHead: names.includes('head-to-head.png') ? (await readFile(path.join(folder, 'head-to-head.png'))).toString('base64') : null,
  rounds: await Promise.all(rounds.map(async item => ({ ...item, base64: (await readFile(path.join(folder, item.name))).toString('base64') }))),
};
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const probe = await fetch(`${origin}/capture-backtest.html?probe=${Date.now()}`);
  const probeText = await probe.text();
  if (!probe.ok || !probeText.includes('capture-backtest.js')) throw new Error(`Backtest harness was not served (${probe.status}, ${probeText.slice(0, 80)})`);
  const page = await browser.newPage();
  page.on('console', message => console.error(`[browser:${message.type()}] ${message.text()}`));
  page.on('pageerror', error => console.error(`[browser-error] ${error.message}`));
  await page.goto(`${origin}/capture-backtest.html?run=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__runCaptureBacktest === 'function', null, { timeout: 60_000 });
  const result = await page.evaluate(async data => await window.__runCaptureBacktest(data), payload);
  const output = path.join(root, 'release', `capture-backtest-${path.basename(folder)}.json`);
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, map: result.draft.match.map, score: [result.draft.match.ourScore, result.draft.match.theirScore], alliedPlayers: result.players.filter(player => player.include).map(player => player.extractedName), rounds: result.rounds.length, completeResults: result.rounds.filter(round => round.result === 'W' || round.result === 'L').length }));
} finally {
  await browser.close();
  await Promise.all([rm(js, { force: true }), rm(html, { force: true })]);
}
