import type { Express } from 'express';
import { readDB, saveDB } from '../store';
import { applyPortablePackage, createPortablePackage, previewPortablePackage } from '../portablePackage';
import { createPrivateBackup } from '../privateBackup';
import { mergeAcceptedPlayerStat } from '../identitySnapshot';

export function registerPortablePackageRoutes(app: Express) {
  if (process.env.APP_DESKTOP === 'true') app.post('/api/desktop/sync-inbox', async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : []; if (items.length > 100) return res.status(413).json({ error: 'Sync inbox batch is too large.' });
      const db = await readDB(); db.engineAdapters ||= { schemaVersion: 1, idempotency: {}, replay: {}, ratings: { configs: {}, records: {}, formulaVersions: {}, baselineVersions: {} }, ranked: { providers: {}, accounts: {}, consents: {}, states: {} } }; db.engineAdapters.replay ||= {};
      const conflicts: Array<{ collection: string; id: string }> = []; let applied = 0;
      const merge = (collection: string, rows: any[]) => { db[collection] ||= []; const byId = new Map(db[collection].map((row: any) => [row.id, row])); for (const row of rows) { if (!row?.id) continue; const current = byId.get(row.id); if (!current) { db[collection].push(structuredClone(row)); byId.set(row.id, row); applied += 1; } else if (JSON.stringify(current) !== JSON.stringify(row)) conflicts.push({ collection, id: row.id }); } };
      for (const item of items) {
        if (item?.kind === 'accepted-screenshot-summary' && item.match?.id && item.match.id === item.screenshot?.matchId) {
          merge('matches', [item.match]); db.engineAdapters.screenshot ||= {}; const current = db.engineAdapters.screenshot[item.match.id];
          if (!current || Number(item.screenshot.revision || 0) > Number(current.revision || 0)) {
            db.playerStats ||= [];
            for (const incoming of Array.isArray(item.playerStats) ? item.playerStats : []) {
              const existing = db.playerStats.find((row: any) => row.id === incoming.id && row.matchId === item.match.id);
              if (existing) Object.assign(existing, mergeAcceptedPlayerStat(existing, structuredClone(incoming))); else db.playerStats.push(structuredClone(incoming));
            }
            db.engineAdapters.screenshot[item.match.id] = structuredClone(item.screenshot); applied += 1;
          }
          continue;
        }
        if (item?.kind !== 'accepted-match' || !item.match?.id || item.match.id !== item.replay?.matchId) continue;
        merge('matches', [item.match]); merge('playerStats', Array.isArray(item.playerStats) ? item.playerStats : []); merge('rounds', Array.isArray(item.rounds) ? item.rounds : []);
        const current = db.engineAdapters.replay[item.match.id]; if (!current) { db.engineAdapters.replay[item.match.id] = structuredClone(item.replay); applied += 1; } else if (JSON.stringify(current) !== JSON.stringify(item.replay)) conflicts.push({ collection: 'acceptedReplays', id: item.match.id });
      }
      if (applied) await saveDB(db); res.json({ applied, conflicts });
    } catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Sync inbox could not be applied.' }); }
  });
  if (process.env.APP_DESKTOP === 'true') app.post('/api/desktop/backup', async (req, res) => {
    if ((req as any).user?.role !== 'coach') return res.status(403).json({ error: 'Desktop recovery backup is coach-only.' });
    try { const backup = await createPrivateBackup({ reason: 'desktop-daily-recovery' }); res.status(201).json({ backupId: backup.id, createdAt: backup.manifest.createdAt, replayBlobCount: backup.manifest.replayBlobs.inventory.length }); }
    catch (error: any) { res.status(error?.status || 500).json({ error: error?.message || 'Desktop recovery backup failed.' }); }
  });
  app.post('/api/portable-package/export', async (req, res) => {
    if ((req as any).user?.role !== 'coach') return res.status(403).json({ error: 'Portable team export is coach-only.' });
    try { res.json(createPortablePackage(await readDB(), String(req.body?.sourceDeviceId || 'unknown-device'), new Date().toISOString(), { scope: req.body?.scope, id: req.body?.id })); }
    catch (error: any) { res.status(error?.status || 500).json({ error: error?.message || 'Portable package could not be created.' }); }
  });
  app.post('/api/portable-package/preview', async (req, res) => {
    if ((req as any).user?.role !== 'coach') return res.status(403).json({ error: 'Portable package preview is coach-only.' });
    try { res.json(previewPortablePackage(await readDB(), req.body)); }
    catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Portable package could not be previewed.' }); }
  });
  app.post('/api/portable-package/import', async (req, res) => {
    if ((req as any).user?.role !== 'coach') return res.status(403).json({ error: 'Portable package import is coach-only.' });
    try { const db = await readDB(); const result = applyPortablePackage(db, req.body); await createPrivateBackup({ reason: 'pre-portable-import' }); await saveDB(db); res.json(result); }
    catch (error: any) { res.status(error?.status || 400).json({ error: error?.message || 'Portable package could not be imported.' }); }
  });
}
