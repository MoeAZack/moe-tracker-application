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
const server = spawn(process.execPath, ['build/server.cjs'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(serverPort), USE_FIRESTORE: 'false', DB_PATH: path.join(temporary, 'db.json'), ADMIN_PASSWORD: 'accessibility-audit-secret', JWT_SECRET: 'accessibility-audit-jwt-secret-12345' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; server.stdout.on('data', value => { log += value; }); server.stderr.on('data', value => { log += value; }); let browser;
const results = [];
async function audit(page, name) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  results.push({ name, violations: result.violations.map(item => ({ id: item.id, impact: item.impact, help: item.help, nodes: item.nodes.length, targets: item.nodes.slice(0, 5).map(node => ({ target: node.target, html: node.html, summary: node.failureSummary })) })) });
}
try {
  let ready = false; const deadline = Date.now() + 20_000; while (Date.now() < deadline) { try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready) throw new Error(`Server did not become healthy: ${log.slice(-1000)}`);
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true });
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport }); const page = await context.newPage(); await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await audit(page, `${viewport.name} player login`);
    await page.getByRole('tab', { name: 'Coach / access key' }).click(); await audit(page, `${viewport.name} coach login`);
    await page.locator('#access-key').fill('accessibility-audit-secret'); await page.getByRole('button', { name: 'Sign in' }).click(); await page.locator('#login-container').waitFor({ state: 'detached' });
    if (viewport.name === 'mobile') await page.getByRole('button', { name: 'Open navigation' }).click();
    await audit(page, `${viewport.name} authenticated summary`); await context.close();
  }
  const blocking = results.flatMap(result => result.violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => ({ surface: result.name, ...item })));
  console.log(JSON.stringify({ standard: 'WCAG 2.2 A/AA automated axe-core audit', surfaces: results, blocking }, null, 2));
  if (blocking.length) throw new Error(`${blocking.length} serious/critical accessibility violations found.`);
} finally { await browser?.close(); server.kill(); await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]); await rm(temporary, { recursive: true, force: true }); }
