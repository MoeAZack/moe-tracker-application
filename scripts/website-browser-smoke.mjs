import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const browserPaths = [process.env.LOCAL_OCR_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
// The smoke signs in as a coach, so the coach's website tabs must all be present.
const retained = ['Home', 'Schedule & Goals', 'Match Review', 'VOD Submission', 'Economy', 'Map Analysis', 'Coach Workspace', 'Roster', 'Player Stats'];
const desktopOnly = ['Replay Evidence', 'VOD Review', 'Lineup Library', 'Live Logger', 'Compositions', 'Settings', 'Import scoreboard', 'Scrim Auto-Import'];

async function availablePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0;
  server.close(); await once(server, 'close'); return port;
}

async function signIn(page, origin) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Coach / access key' }).click();
  await page.locator('#access-key').fill('browser-smoke-admin-secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('#login-container').waitFor({ state: 'detached', timeout: 20_000 });
  await page.locator('nav').first().waitFor({ state: 'attached', timeout: 20_000 });
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'moetracker-website-smoke-'));
const port = await availablePort(); const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['build/server.cjs'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), DB_PATH: path.join(tempRoot, 'db.json'), ADMIN_PASSWORD: 'browser-smoke-admin-secret-123', JWT_SECRET: 'browser-smoke-jwt-secret-12345' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', chunk => { serverLog += String(chunk); }); server.stderr.on('data', chunk => { serverLog += String(chunk); });
let browser;
try {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!(await fetch(`${origin}/api/health`)).ok) throw new Error(`Production server did not become healthy: ${serverLog.slice(-1000)}`);
  const executablePath = browserPaths.find(candidate => existsSync(candidate));
  if (!executablePath) throw new Error('No local Chrome/Edge executable found.');
  browser = await chromium.launch({ executablePath, headless: true });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await signIn(page, origin);
    if (viewport.width < 800) await page.getByRole('button', { name: 'Open navigation' }).click();
    const navigation = (await page.locator('nav button').allTextContents()).join('\n');
    for (const label of retained) if (!navigation.includes(label)) throw new Error(`Expected website navigation is missing: ${label}`);
    for (const label of desktopOnly) if (navigation.includes(label)) throw new Error(`Desktop-only control leaked into website: ${label}`);
    const summary = await page.evaluate(async () => {
      const token = localStorage.getItem('team_tracker_key');
      const response = await fetch('/api/website-summary', { headers: { authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`summary returned ${response.status}`);
      return response.json();
    });
    for (const key of ['rounds', 'vetos', 'strats', 'stratRuns', 'seasonArchives', 'vodReviews', 'lineups']) if (!Array.isArray(summary[key]) || summary[key].length) throw new Error(`Website summary exposed ${key}.`);
    if (Object.keys(summary.secrets || {}).length) throw new Error('Website summary exposed secret capability flags.');
    await page.getByRole('button', { name: 'VOD Submission' }).click();
    await page.getByRole('heading', { name: 'Submit and analyze a personal VOD' }).waitFor({ state: 'visible' });
    await page.close();
  }
  console.log('Website production browser smoke passed at desktop and mobile widths with summary-only data.');
} finally {
  await browser?.close(); server.kill();
  await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5_000))]);
  await rm(tempRoot, { recursive: true, force: true });
}
