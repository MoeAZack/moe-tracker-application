import type { Express } from 'express';
import { startEmptyWorkspace, workspaceRecoveryStatus } from '../store';
import { listPrivateBackups, restorePrivateBackupById } from '../privateBackup';

/**
 * When the workspace database is missing or unreadable, the app refuses to
 * create an empty one over it. These routes let the coach choose instead:
 * restore a recovery backup, or start an empty workspace on purpose.
 */
export function registerWorkspaceRecoveryRoutes(app: Express) {
  const coachOnly = (req: any, res: any) => {
    if (req.user?.role === 'coach') return true;
    res.status(403).json({ error: 'Workspace recovery is coach-only.' });
    return false;
  };
  const unavailable = async (res: any) => {
    const current = await workspaceRecoveryStatus();
    if (current.status === 'ok') { res.status(409).json({ error: 'The workspace opens normally, so there is nothing to recover.' }); return null; }
    return current;
  };

  app.get('/api/workspace/recovery', async (req, res) => {
    if (!coachOnly(req, res)) return;
    try {
      const current = await workspaceRecoveryStatus();
      res.json({ ...current, backups: current.status === 'ok' ? [] : await listPrivateBackups() });
    } catch (error: any) { res.status(error?.status || 500).json({ error: error?.message || 'Workspace status could not be read.' }); }
  });

  app.post('/api/workspace/recovery/restore', async (req, res) => {
    if (!coachOnly(req, res)) return;
    try {
      if (!await unavailable(res)) return;
      res.json(await restorePrivateBackupById(String(req.body?.backupId || '')));
    } catch (error: any) { res.status(error?.status || 500).json({ error: error?.message || 'The backup could not be restored.' }); }
  });

  app.post('/api/workspace/recovery/start-empty', async (req, res) => {
    if (!coachOnly(req, res)) return;
    try {
      const current = await unavailable(res); if (!current) return;
      if (current.status !== 'missing') return res.status(409).json({ error: 'The unreadable database is still in place. Restart the app and try again.' });
      await startEmptyWorkspace();
      res.status(201).json({ started: true });
    } catch (error: any) { res.status(error?.status || 500).json({ error: error?.message || 'An empty workspace could not be started.' }); }
  });
}
