import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { notify } from '../utils/appDialogs';

type RemovedMatch = {
  id: string;
  matchId: string;
  removedAt: string;
  removedBy: string;
  summary: { date?: string; map?: string; opponent?: string; score?: string; rounds: number; playerStats: number };
};

interface Props {
  isLight: boolean;
  /** Changes whenever the match list changes, so a delete shows up here at once. */
  refreshKey: string;
  onRestored: () => Promise<void> | void;
}

/** Matches removed from the workspace, kept whole until the coach restores them. */
export default function RecentlyDeletedMatches({ isLight, refreshKey, onRestored }: Props) {
  const [entries, setEntries] = useState<RemovedMatch[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/removed-matches');
      // Players cannot see this list; leave it hidden for them.
      if (!response.ok) { setEntries(null); return; }
      setEntries((await response.json()).removedMatches || []);
    } catch { setEntries(null); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const restore = async (entry: RemovedMatch) => {
    setBusy(entry.id);
    try {
      const response = await apiFetch('/api/removed-matches/restore', { method: 'POST', body: JSON.stringify({ entryId: entry.id }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The match could not be restored.');
      await onRestored();
      await load();
      notify(`Restored the match${entry.summary.opponent ? ` against ${entry.summary.opponent}` : ''}.`);
    } catch (error: any) {
      notify(error?.message || 'The match could not be restored.', 'error');
    } finally { setBusy(null); }
  };

  if (!entries?.length) return null;
  return (
    <section aria-labelledby="recently-deleted-title" className={`rounded-xl border p-3 space-y-2 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-white/[0.03]'}`}>
      <div>
        <h4 id="recently-deleted-title" className="text-xs font-black uppercase tracking-widest">Recently deleted</h4>
        <p className="mt-0.5 text-xs text-slate-400">Deleted matches are kept here with their rounds and stats until you restore them.</p>
      </div>
      <ul className="space-y-1.5">
        {entries.map(entry => (
          <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0">
              <span className="block truncate font-bold">{[entry.summary.opponent, entry.summary.map, entry.summary.score].filter(Boolean).join(' · ') || 'Match'}</span>
              <span className="block text-slate-400 font-mono">{entry.summary.date ? `${entry.summary.date} · ` : ''}deleted {new Date(entry.removedAt).toLocaleString()}</span>
            </span>
            <button type="button" className="ui-button min-h-8 px-3 text-xs shrink-0" disabled={busy !== null} onClick={() => restore(entry)}>
              {busy === entry.id ? 'Restoring…' : 'Restore'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
