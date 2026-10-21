import { _electron as electron } from 'playwright-core';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const existingProfile = process.argv.includes('--existing-profile');
const executableArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const executablePath = path.resolve(executableArgument || 'release/win-unpacked/Moe Tracker Application.exe');
const sandbox = await mkdtemp(path.join(os.tmpdir(), 'moetracker-ipc-'));
const roaming = path.join(sandbox, 'Roaming');
const local = path.join(sandbox, 'Local');
const documents = path.join(sandbox, 'Documents');
await Promise.all([mkdir(roaming, { recursive: true }), mkdir(local, { recursive: true }), mkdir(documents, { recursive: true })]);
let application;
try {
  application = await electron.launch({
    executablePath,
    args: existingProfile ? [] : [`--user-data-dir=${path.join(roaming, 'MoeTrackerAcceptance')}`],
    env: existingProfile ? process.env : { ...process.env, APPDATA: roaming, LOCALAPPDATA: local, MOETRACKER_DOCUMENTS_ROOT: documents },
    timeout: 45_000,
  });
  const window = await application.firstWindow({ timeout: 45_000 });
  await window.waitForFunction(() => Boolean(window.moeDesktop), null, { timeout: 30_000 });
  const result = await window.evaluate(async existing => {
    const bridge = window.moeDesktop;
    const status = await bridge.getStatus();
    const session = await bridge.bootstrapSession();
    const scoreboards = await bridge.listScoreboards();
    const jobs = await bridge.listIngestionJobs();
    const secrets = await bridge.getIntegrationSecretStatus();
    // The page never holds the bearer token; the main process adds it.
    const dataResponse = await fetch('/api/data');
    const storedKey = localStorage.getItem('team_tracker_key');
    const data = await dataResponse.json();
    const retention = existing ? { retentionDays: status.retentionDays } : await bridge.setRetentionDays(31);
    const paused = existing ? { paused: status.capture?.paused } : await bridge.setCapturePaused(true);
    const resumed = existing ? { paused: status.capture?.paused } : await bridge.setCapturePaused(false);
    const preferences = existing ? status.capture?.preferences : await bridge.setCapturePreferences({ profile: 'windowed', display: 'primary', notification: 'silent', offlineQueue: true });
    const backup = existing ? { backupId: 'pre-upgrade-verified' } : await bridge.createRecoveryBackup();
    return {
      version: status.appVersion,
      localService: status.localService,
      role: status.role,
      sessionRole: session.role,
      sessionFields: Object.keys(session).sort(),
      storedKey,
      dataStatus: dataResponse.status,
      scoreboards: scoreboards.length,
      jobs: jobs.length,
      encryptionAvailable: secrets.encryptionAvailable,
      retentionDays: retention.retentionDays,
      paused: paused.paused,
      resumed: resumed.paused,
      captureProfile: preferences.profile,
      backupCreated: Boolean(backup.backupId),
      data: { matches: data.matches?.length || 0, rounds: data.rounds?.length || 0, playerStats: data.playerStats?.length || 0, storageSchemaVersion: data._storage?.schemaVersion || null },
    };
  }, existingProfile);
  const expectedVersion = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version;
  const failures = [];
  if (result.version !== expectedVersion) failures.push(`version ${result.version} != ${expectedVersion}`);
  if (result.localService !== 'online') failures.push('local service is not online');
  if (result.role !== 'coach' || result.sessionRole !== 'coach') failures.push('fresh local coach session failed');
  if (result.sessionFields.includes('key') || result.storedKey) failures.push('the coach session token reached the renderer');
  if (result.dataStatus !== 200) failures.push(`main-process session header was not applied (/api/data HTTP ${result.dataStatus})`);
  if (!existingProfile && (result.retentionDays !== 31 || result.paused !== true || result.resumed !== false || result.captureProfile !== 'windowed')) failures.push('settings IPC round-trip failed');
  if (!result.backupCreated) failures.push('recovery-backup IPC failed');
  console.log(JSON.stringify({ passed: failures.length === 0, executablePath, existingProfile, result, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (application) await application.close().catch(() => {});
  await rm(sandbox, { recursive: true, force: true });
}
