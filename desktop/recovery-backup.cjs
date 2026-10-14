const fsp = require('node:fs/promises');
const path = require('node:path');

async function hasRecentRecoveryBackup(directory, newerThan) {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await fsp.readFile(path.join(directory, entry.name, 'manifest.json'), 'utf8'));
      if (manifest?.format === 'moetracker-private-backup/v1' && Date.parse(manifest.createdAt || '') >= newerThan) return true;
    } catch { /* Ignore incomplete or unrelated folders. */ }
  }
  return false;
}

module.exports = { hasRecentRecoveryBackup };
