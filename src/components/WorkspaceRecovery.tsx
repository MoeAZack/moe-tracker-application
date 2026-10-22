import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { confirmDialog, notify } from '../utils/appDialogs';

type Backup = { id: string; createdAt: string; reason: string };
type Status = { status: 'ok' } | { status: 'missing' | 'unreadable'; message: string; backups: Backup[] };

const reasonLabel = (reason: string) => reason.startsWith('pre-match-removal') ? 'before a match was deleted'
  : reason === 'pre-reset-metrics' ? 'before a metrics reset'
    : reason.startsWith('pre-restore') ? 'before a restore'
      : reason.startsWith('desktop-daily') || reason.startsWith('scheduled') ? 'automatic' : reason;

interface Props {
  /** Called once the workspace opens again. */
  onRecovered: () => Promise<void> | void;
}

/**
 * Shown when the workspace database is missing or unreadable. The app never
 * creates an empty workspace over a lost one on its own; the coach chooses
 * to restore a recovery backup or to start empty.
 */
export default function WorkspaceRecovery({ onRecovered }: Props) {
  const [state, setState] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await apiFetch('/api/workspace/recovery');
    if (response.ok) setState(await response.json());
  };
  useEffect(() => { void load().catch(() => {}); }, []);

  const act = async (route: string, body: unknown, success: string) => {
    setBusy(true);
    try {
      const response = await apiFetch(route, { method: 'POST', body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Recovery failed.');
      notify(success);
      await onRecovered();
    } catch (error: any) {
      notify(error?.message || 'Recovery failed.', 'error');
      await load().catch(() => {});
    } finally { setBusy(false); }
  };

  if (!state || state.status === 'ok') return null;
  return (
    <section role="alert" aria-labelledby="workspace-recovery-title" className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-5 space-y-4 text-left">
      <div>
        <h2 id="workspace-recovery-title" className="text-base font-bold">The workspace could not be opened</h2>
        <p className="mt-1 text-sm text-slate-300">{state.status === 'missing' ? 'The workspace file is missing, but this computer had a workspace before.' : 'The workspace file is damaged. It was moved aside unchanged.'} Nothing was created over it. Restore a recovery backup, or start an empty workspace.</p>
      </div>
      {state.backups.length ? (
        <ul className="space-y-2">
          {state.backups.slice(0, 10).map(backup => (
            <li key={backup.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{new Date(backup.createdAt).toLocaleString()} <span className="text-slate-400">({reasonLabel(backup.reason)})</span></span>
              <button type="button" className="ui-button min-h-9 px-3 text-xs" disabled={busy} onClick={() => act('/api/workspace/recovery/restore', { backupId: backup.id }, 'Workspace restored from the backup.')}>Restore this backup</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-slate-400">No recovery backups were found on this computer.</p>}
      {state.status === 'missing' && (
        <button type="button" className="ui-button min-h-9 px-3 text-xs text-rose-300" disabled={busy} onClick={async () => {
          if (!(await confirmDialog('Start an empty workspace? Your recovery backups stay on this computer and can still be restored later.', { destructive: true, confirmLabel: 'Start empty' }))) return;
          await act('/api/workspace/recovery/start-empty', {}, 'An empty workspace was started.');
        }}>Start an empty workspace</button>
      )}
    </section>
  );
}
