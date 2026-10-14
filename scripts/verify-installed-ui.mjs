import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const port = process.argv[2];
if (!port) throw new Error('Pass the installed local-service port.');
const origin = `http://127.0.0.1:${port}`;
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'moe-tracker-application', 'Local Workspace', 'desktop-config.json'), 'utf8'));
const login = await fetch(`${origin}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: config.adminPassword }) });
if (!login.ok) throw new Error(`Login failed (${login.status}).`);
const session = await login.json();
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const evidenceDir = path.join(process.cwd(), 'release', 'ui-verification'); await mkdir(evidenceDir, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('console', message => { if (message.type() === 'error') console.error(`[browser] ${message.text()}`); });
  page.on('pageerror', error => console.error(`[browser-error] ${error.message}`));
  await page.addInitScript(value => {
    window.moeDesktop = {
      bootstrapSession: async () => value,
      getStatus: async () => ({ appVersion: '0.1.8', mode: 'offline-first', deviceName: 'Verification PC', retentionDays: 30, startWithWindows: false, cloudUrl: '', replayCount: 0, pendingScoreboards: 0, latestReplay: null, localService: 'online', update: { state: 'current', version: null, percent: null, message: '' }, folders: {}, collector: {}, sync: { paired: false, server: null, pending: 0, received: 0 } }),
      onStatus: () => () => {}, listScoreboards: async () => [], syncNow: async () => ({}), checkForUpdates: async () => ({}),
    };
  }, session);
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Dashboard' }).waitFor({ state: 'visible', timeout: 20_000 });
  const checks = {};
  const capture = async (name, expected) => {
    await page.waitForTimeout(500);
    const body = await page.locator('body').innerText();
    checks[name] = expected.every(text => body.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
    await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
  };
  await capture('dashboard', ['v0.1.8', 'Ready for the next review', 'Start post-match capture']);
  await page.locator('summary[aria-label^="Team sync for"]').click();
  await capture('team-sync', ['Pair another team PC', 'Create team code']);
  await page.locator('summary[aria-label^="Team sync for"]').click();
  await page.getByRole('button', { name: 'Matches Log' }).click();
  await capture('matches', ['Scrims & Matches Log', 'No matches recorded']);
  await page.getByRole('button', { name: 'Economy' }).click();
  await capture('economy', ['Economy Analytics', 'Economy evidence by match']);
  await page.getByRole('button', { name: 'Settings' }).click();
  await capture('settings', ['Workspace Team Configurations', 'External API & Webhook Endpoints', 'Official GRID.GG API key']);
  await page.getByRole('button', { name: 'Device, Sync & Storage' }).click();
  await capture('settings-device', ['This PC & Team Sync', 'Pair PC', 'Device, Sync & Storage']);
  console.log(JSON.stringify({ checks, evidenceDir }));
} finally { await browser.close(); }
