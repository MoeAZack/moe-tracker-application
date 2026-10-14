const { app, safeStorage } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');

app.whenReady().then(async () => {
  try {
    const port = Number(process.argv[2]);
    if (!Number.isInteger(port)) throw new Error('Pass the installed local-service port.');
    const file = path.join(process.env.APPDATA, 'moe-tracker-application', 'Local Workspace', 'desktop-config.json');
    const config = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (!safeStorage.isEncryptionAvailable() || !config.adminCredential) throw new Error('Protected desktop credential is unavailable.');
    const key = safeStorage.decryptString(Buffer.from(config.adminCredential, 'base64'));
    const login = await fetch(`http://127.0.0.1:${port}/api/login-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) });
    const session = await login.json();
    if (!login.ok) throw new Error(`Login failed (${login.status}).`);
    const response = await fetch(`http://127.0.0.1:${port}/api/desktop/backup`, { method: 'POST', headers: { authorization: `Bearer ${session.key}` } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Backup failed (${response.status}).`);
    console.log(JSON.stringify({ success: true, backupId: result.backupId, replayBlobCount: result.replayBlobCount }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { app.quit(); }
});
