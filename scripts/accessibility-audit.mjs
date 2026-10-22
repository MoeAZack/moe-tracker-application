import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright-core';

async function port() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; server.close(); await once(server, 'close'); return value; }
const root = process.cwd(); const temporary = await mkdtemp(path.join(os.tmpdir(), 'moetracker-a11y-')); const serverPort = await port(); const origin = `http://127.0.0.1:${serverPort}`;
const server = spawn(process.execPath, ['build/server.cjs'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(serverPort), DB_PATH: path.join(temporary, 'db.json'), ADMIN_PASSWORD: 'accessibility-audit-secret', JWT_SECRET: 'accessibility-audit-jwt-secret-12345' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', value => { log += value; }); server.stderr.on('data', value => { log += value; }); let browser;
const results = [];
const check = (condition, message) => { if (!condition) throw new Error(`Accessibility audit: ${message}`); };

/** Installed-app surfaces: the renderer with a stubbed desktop bridge, signed in as the coach, on synthetic data. */
async function auditDesktopWorkspaces() {
  const session = await (await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'accessibility-audit-secret' }) })).json();
  check(session.key, 'desktop audit login failed.');
  const auth = { 'content-type': 'application/json', authorization: `Bearer ${session.key}` };
  const rounds = Array.from({ length: 6 }, (_, index) => ({ roundNo: index + 1, side: index < 3 ? 'Att' : 'Def', result: index % 2 ? 'L' : 'W', buy: 'Full', enemyBuy: 'Full' }));
  const saved = await fetch(`${origin}/api/save-match`, { method: 'POST', headers: auth, body: JSON.stringify({ match: { date: '2026-10-01', type: 'Scrim', opponent: 'Synthetic Opponent', map: 'Ascent', attW: 2, attL: 1, defW: 1, defL: 2 }, statsUpdate: { operation: 'preserve' }, rounds }) });
  check(saved.ok, `synthetic match seed failed (${saved.status}).`);
  const matchId = (await saved.json()).match.id;
  // Like the installed app: the page learns only who is signed in, and the
  // bearer token is added to requests outside the page.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { authorization: `Bearer ${session.key}` } });
  await context.addInitScript(value => {
    window.moeDesktop = {
      bootstrapSession: async () => value,
      getStatus: async () => ({ appVersion: 'a11y', mode: 'offline-first', deviceName: 'Accessibility audit', retentionDays: 30, startWithWindows: false, cloudUrl: '', replayCount: 0, pendingScoreboards: 0, latestReplay: null, localService: 'online', update: { state: 'current', version: null, percent: null, message: '' }, folders: {}, collector: {}, sync: { paired: false, server: null, pending: 0, received: 0 } }),
      onStatus: () => () => {}, listScoreboards: async () => [], syncNow: async () => ({}), checkForUpdates: async () => ({}),
    };
  }, { success: true, role: session.role, username: session.username, expiresAt: session.expiresAt || null });
  const page = await context.newPage();
  const open = async hash => { await page.goto(`${origin}/${hash}`, { waitUntil: 'domcontentloaded' }); await page.locator('#main-content').waitFor({ state: 'visible', timeout: 20_000 }); };
  await open('#/home');
  const nav = name => page.getByRole('button', { name, exact: true });

  // A destination opens its first section; Back returns to the previous screen (history entries are pushed, not replaced).
  await nav('Coaching').click(); await page.waitForURL(/#\/schedule/);
  check(await nav('Coaching').getAttribute('aria-current') === 'page' && await nav('Schedule & Goals').getAttribute('aria-current') === 'page', 'Coaching did not open its first section.');
  await nav('Coach Workspace').click(); await page.waitForURL(/#\/coach-workspace/);
  await audit(page, 'desktop coach workspace');
  await page.goBack({ waitUntil: 'commit' }).catch(() => null); await page.waitForURL(/#\/schedule/, { timeout: 5_000 }).catch(() => null);
  check(page.url().includes('#/schedule') && await nav('Schedule & Goals').getAttribute('aria-current', { timeout: 5_000 }).catch(() => null) === 'page', `Back did not return to Schedule & Goals (${page.url()}).`);
  await page.goBack({ waitUntil: 'commit' }).catch(() => null); await page.waitForURL(/#\/home/, { timeout: 5_000 }).catch(() => null);
  check(page.url().includes('#/home') && await nav('Home').getAttribute('aria-current', { timeout: 5_000 }).catch(() => null) === 'page', `Back did not return to Home (${page.url()}).`);
  // Returning to a destination reopens the section last used there.
  await nav('Coaching').click(); await nav('Coach Workspace').click(); await page.waitForURL(/#\/coach-workspace/);
  await nav('Home').click(); await page.waitForURL(/#\/home/); await nav('Coaching').click();
  check(page.url().includes('#/coach-workspace'), `Coaching did not reopen Coach Workspace (${page.url()}).`);

  // The selected round survives Replay Evidence and Coach Workspace links.
  for (const [path, name] of [['replay-evidence', 'Replay Evidence'], ['coach-workspace', 'Coach Workspace']]) {
    await open(`#/${path}?match=${matchId}&round=3`);
    await page.waitForTimeout(500);
    check(page.url().includes(`match=${matchId}`) && page.url().includes('round=3'), `${name} dropped the selected match or round (${page.url()}).`);
    check(await nav(name).getAttribute('aria-current') === 'page', `${name} link did not open ${name}.`);
    await audit(page, `desktop ${name.toLowerCase()} with selected round`);
  }

  // #/tryouts opens Tryout comparisons even though the nav entry is hidden by default.
  await open('#/tryouts'); await page.waitForTimeout(500);
  check(page.url().includes('#/tryouts'), `#/tryouts redirected to ${page.url()}.`);
  await audit(page, 'desktop tryout comparisons');

  // VOD Review with the integrated intelligence (evidence fusion) panel expanded.
  await open(`#/vod-review?match=${matchId}&round=3`);
  const intelligence = page.getByRole('button', { name: /Integrated match intelligence/ });
  await intelligence.click(); await page.getByText('Evidence fusion').waitFor();
  check(!/\{\s*"|"\s*:\s*[\[{"]/.test(await page.locator('[aria-labelledby="review-intelligence-title"]').innerText()), 'the evidence fusion panel shows raw JSON.');
  await audit(page, 'desktop vod review evidence fusion');

  // A destructive confirmation is an in-app modal: labelled, focused on Cancel, dismissed by Escape without acting.
  await open(`#/match-review?match=${matchId}`);
  await page.getByRole('button', { name: 'DELETE', exact: true }).click();
  const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
  check(await page.evaluate(() => document.activeElement?.textContent) === 'Cancel', 'the destructive confirmation did not start on Cancel.');
  await audit(page, 'desktop destructive confirmation dialog');
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  const after = await (await fetch(`${origin}/api/data`, { headers: auth })).json();
  check((after.matches || []).some(match => match.id === matchId), 'cancelling the confirmation still deleted the match.');
  await context.close();
}

async function audit(page, name) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  results.push({ name, violations: result.violations.map(item => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.length, targets: item.nodes.slice(0, 5).map(node => ({ target: node.target, html: node.html, summary: node.failureSummary })) })) });
}
try {
  let ready = false; const deadline = Date.now() + 20_000; while (Date.now() < deadline) { try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready) throw new Error(`Server did not become healthy: ${log.slice(-1000)}`);
  // A11Y_BROWSER points at a local Chromium (for example /opt/pw-browsers/chromium in CI containers without Playwright's headless shell).
  const executablePath = [process.env.A11Y_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport }); const page = await context.newPage(); await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await audit(page, `${viewport.name} player login`);
    await page.getByRole('tab', { name: 'Coach / access key' }).click(); await audit(page, `${viewport.name} coach login`);
    await page.locator('#access-key').fill('accessibility-audit-secret'); await page.getByRole('button', { name: 'Sign in' }).click(); await page.locator('#login-container').waitFor({ state: 'detached' });
    if (viewport.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
    await audit(page, `${viewport.name} authenticated summary`); await context.close();
  }
  await auditDesktopWorkspaces();
  const blocking = results.flatMap(result => result.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({ surface: result.name, ...item })));
  console.log(JSON.stringify({ standard: 'WCAG 2.2 A/AA automated axe-core audit', surfaces: results, blocking }, null, 2));
  if (blocking.length) throw new Error(`${blocking.length} serious/critical accessibility violations found.`);
} finally { await browser?.close(); server.kill(); await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); await rm(temporary, { recursive: true, force: true }); }
