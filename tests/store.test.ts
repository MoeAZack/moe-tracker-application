import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempDir = '';
afterEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('file store concurrency', () => {
  it('quarantines a corrupt existing database byte for byte and never seeds over it', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-corrupt-'));
    const dbPath = path.join(tempDir, 'db.json');
    const corrupted = '{"matches":[{"id":"valuable-record"}], broken';
    await fs.writeFile(dbPath, corrupted);
    vi.stubEnv('DB_PATH', dbPath);

    const { readDB } = await import('../lib/store');
    await expect(readDB()).rejects.toMatchObject({ status: 503, code: 'WORKSPACE_DATABASE_UNREADABLE' });
    const kept = (await fs.readdir(tempDir)).filter(name => name.startsWith('db.json.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(tempDir, kept[0]), 'utf8')).toBe(corrupted);
    // The next start finds no db.json, but the kept copy shows a workspace existed: no empty seed.
    await expect(readDB()).rejects.toMatchObject({ status: 503, code: 'WORKSPACE_DATABASE_MISSING' });
    await expect(fs.access(dbPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('quarantines a NUL-filled database left by an unclean shutdown', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-nul-'));
    const dbPath = path.join(tempDir, 'db.json');
    const nulFilled = Buffer.alloc(4096, 0);
    await fs.writeFile(dbPath, nulFilled);
    vi.stubEnv('DB_PATH', dbPath);

    const { readDB } = await import('../lib/store');
    await expect(readDB()).rejects.toMatchObject({ code: 'WORKSPACE_DATABASE_UNREADABLE' });
    const kept = (await fs.readdir(tempDir)).filter(name => name.startsWith('db.json.corrupt-'));
    expect(kept).toHaveLength(1);
    expect(Buffer.compare(await fs.readFile(path.join(tempDir, kept[0])), nulFilled)).toBe(0);
  });

  it('rejects a stale whole-database write instead of losing an update', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify({ settings: {}, matches: [] }));
    vi.stubEnv('DB_PATH', dbPath);
    
    const { readDB, saveDB } = await import('../lib/store');

    const first = await readDB();
    const stale = await readDB();
    first.matches.push({ id: 'first' });
    await saveDB(first);
    stale.matches.push({ id: 'stale' });

    await expect(saveDB(stale)).rejects.toMatchObject({ status: 409 });
    await expect(readDB()).resolves.toMatchObject({ matches: [{ id: 'first' }] });
  });

  it('rejects an oversized aggregate archive before writing any bytes', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-archive-size-'));
    const dbPath = path.join(tempDir, 'db.json');
    const original = JSON.stringify({ settings: {}, matches: [{ id: 'preserved' }], seasonArchives: [] });
    await fs.writeFile(dbPath, original);
    vi.stubEnv('DB_PATH', dbPath);
    
    const { readDB, saveDB } = await import('../lib/store');
    const { MAX_SEASON_ARCHIVES_BYTES } = await import('../lib/roster');
    const db = await readDB();
    db.seasonArchives = [{ id: 'too-large', body: 'x'.repeat(MAX_SEASON_ARCHIVES_BYTES) }];

    await expect(saveDB(db)).rejects.toMatchObject({ status: 413 });
    expect(await fs.readFile(dbPath, 'utf8')).toBe(original);
  });
});
