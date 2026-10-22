import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium } from 'playwright-core';

async function freePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const value = server.address().port; server.close(); await once(server, 'close'); return value; }
const root = process.cwd(); const temporary = await mkdtemp(path.join(os.tmpdir(), 'moetracker-release-ui-')); const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8'));
const server = spawn(process.execPath, ['build/server.cjs'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(temporary, 'db.json'), ADMIN_PASSWORD: 'release-ui-audit-secret-12345', JWT_SECRET: 'release-ui-audit-jwt-secret-12345' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', chunk => { log += chunk; }); server.stderr.on('data', chunk => { log += chunk; }); let browser;
const evidence = { schema: 'moetracker.release-ui-audit/v1', version: packageJson.version, generatedAt: new Date().toISOString(), timezone: 'Africa/Cairo', zoom: [], forcedColors: null, blocking: [] };

async function axe(page, surface) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const violations = result.violations.map(item => ({ surface, id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.length, details: item.nodes.map(node => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })) }));
  evidence.blocking.push(...violations.filter(item => item.impact === 'serious' || item.impact === 'critical'));
  return violations;
}

async function desktopBootstrap(context, session) {
  // Like the installed app: the page learns only who is signed in, and the
  // bearer token is added to requests outside the page.
  await context.setExtraHTTPHeaders({ authorization: `Bearer ${session.key}` });
  await context.addInitScript(value => {
    window.moeDesktop = {
      bootstrapSession: async () => value,
      getStatus: async () => ({ appVersion: value.version, mode: 'offline-first', deviceName: 'Release audit', retentionDays: 30, startWithWindows: false, cloudUrl: '', replayCount: 0, pendingScoreboards: 0, latestReplay: null, localService: 'online', update: { state: 'current', version: null, percent: null, message: '' }, folders: {}, collector: {}, sync: { paired: false, server: null, pending: 0, received: 0 } }),
      onStatus: () => () => {}, listScoreboards: async () => [], syncNow: async () => ({}), checkForUpdates: async () => ({}),
    };
  }, { success: true, role: session.role, username: session.username, expiresAt: session.expiresAt || null, version: packageJson.version });
}

try {
  let ready = false; const deadline = Date.now() + 20_000; while (Date.now() < deadline) { try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready) throw new Error(`Release UI server did not become healthy: ${log.slice(-1000)}`);
  const login = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'release-ui-audit-secret-12345' }) }); if (!login.ok) throw new Error(`Release audit login failed (${login.status}).`); const session = await login.json();
  const executablePath = [process.env.A11Y_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync); browser = await chromium.launch({ executablePath, headless: true });
  for (const zoom of [100, 125, 150, 200]) {
    const scale = zoom / 100; const viewport = { width: Math.floor(1440 / scale), height: Math.floor(900 / scale) }; console.log(`[release-ui] ${zoom}% (${viewport.width}x${viewport.height})`); const context = await browser.newContext({ viewport }); await desktopBootstrap(context, session); const page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.locator('#main-content').waitFor({ state: 'visible', timeout: 20_000 });
    await page.keyboard.press('Tab'); const skipText = await page.locator(':focus').textContent(); if (!skipText?.includes('Skip to main content')) throw new Error(`${zoom}%: skip link is not the first keyboard stop.`); await page.keyboard.press('Enter'); if (await page.locator(':focus').getAttribute('id') !== 'main-content') throw new Error(`${zoom}%: skip link did not focus main content.`);
    const mobileNavigation = viewport.width < 1024;
    if (mobileNavigation) { const menu = page.getByRole('button', { name: 'Open navigation' }); await menu.focus(); await page.keyboard.press('Enter'); await page.getByRole('button', { name: 'Schedule & Goals', exact: true }).waitFor(); }
    const schedule = page.getByRole('button', { name: 'Schedule & Goals', exact: true }); await schedule.focus(); await page.keyboard.press('Enter');
    await page.getByText('Schedule Calendar', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
    const active = mobileNavigation ? 'page' : await schedule.getAttribute('aria-current').catch(() => null); const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth })); const motion = await page.locator('.animate-fadeIn').first().evaluate(element => getComputedStyle(element).animationDuration).catch(() => '0s'); const violations = await axe(page, `${zoom}% release workspace`);
    evidence.zoom.push({ zoom, viewport, skipLink: true, keyboardNavigation: active === 'page', overflow, reducedMotionDuration: motion, violations }); await context.close();
  }
  const contrastContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, forcedColors: 'active', colorScheme: 'dark' }); await desktopBootstrap(contrastContext, session); const contrastPage = await contrastContext.newPage(); await contrastPage.goto(origin, { waitUntil: 'domcontentloaded' }); await contrastPage.getByRole('button', { name: 'Home', exact: true }).waitFor(); const violations = await axe(contrastPage, 'Windows forced colors'); evidence.forcedColors = { active: await contrastPage.evaluate(() => matchMedia('(forced-colors: active)').matches), violations }; await contrastContext.close();
  const failedLayout = evidence.zoom.filter(item => item.overflow.document > 2 || item.overflow.body > 2 || !item.keyboardNavigation); const evidenceDir = path.join(root, 'release', 'release-evidence'); await mkdir(evidenceDir, { recursive: true }); const output = path.join(evidenceDir, `ui-audit-${packageJson.version}.json`); await writeFile(output, JSON.stringify(evidence, null, 2));
  if (failedLayout.length || evidence.blocking.length || !evidence.forcedColors?.active) throw new Error(`Release UI gate failed: ${failedLayout.length} layout/keyboard failures, ${evidence.blocking.length} blocking accessibility violations. Evidence: ${output}`);
  console.log(JSON.stringify({ passed: true, output, zoom: evidence.zoom.map(item => ({ zoom: item.zoom, viewport: item.viewport, violations: item.violations.length })), forcedColors: evidence.forcedColors.active, blocking: evidence.blocking.length }, null, 2));
} finally { await browser?.close(); server.kill(); await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); await rm(temporary, { recursive: true, force: true }); }
