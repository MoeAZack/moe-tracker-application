import path from 'path';

const option = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const database = option('--db'); const backups = option('--backups');
if (!database || !backups || !process.env.PRIVATE_BACKUP_KEY) throw new Error('Stage 0 recovery requires database, backup directory and the device-protected backup key.');
process.env.DB_PATH = path.resolve(database);
process.env.PRIVATE_BACKUP_DIR = path.resolve(backups);
process.env.REPLAY_STORAGE_DIR = path.resolve(option('--replays') || path.join(path.dirname(database), 'private-replays'));
const backup = await import('../lib/privateBackup');
const made = await backup.createPrivateBackup({ reason: 'stage0-pre-upgrade' });
const validation = await backup.restorePrivateBackup(made.directory, { dryRun: true });
process.stdout.write(JSON.stringify({ backupId: made.id, createdAt: made.manifest.createdAt, storageSchemaVersion: made.manifest.storageSchemaVersion, encrypted: made.manifest.files[0].encrypted || false, sourceBytes: made.manifest.files[0].bytes, sourceSha256: made.manifest.files[0].sha256, dryRun: validation }, null, 2));
if (!validation.readyForRestore) process.exitCode = 1;
