import React, { useMemo, useState } from 'react';
import { ListTodo } from 'lucide-react';
import type { CoachingAction, TrackerData } from '../types';
import { apiFetch } from '../utils/api';

const KIND_LABELS: Record<string, string> = {
  'player-feedback': 'Player feedback',
  'team-task': 'Team task',
  'vod-review': 'Rewatch this round',
  'strategy-board': 'Fix it on the strategy board',
};
const STATE_LABELS: Record<CoachingAction['state'], string> = {
  planned: 'Planned',
  assigned: 'Assigned',
  acknowledged: 'Seen by player',
  'in-progress': 'In progress',
  'review-next-block': 'Check next practice',
  resolved: 'Done',
  cancelled: 'Cancelled',
};

/** Round-anchored VOD second for this round, from the first saved review that marked it. */
export function roundVodSeconds(data: Pick<TrackerData, 'vodReviews'>, matchId: string, roundNo: number): number | null {
  for (const review of data.vodReviews || []) {
    if (review.matchId !== matchId) continue;
    const note = (review.notes || []).find(item => item.roundNo === roundNo && Number.isFinite(item.seconds));
    if (note) return note.seconds;
  }
  return null;
}

export const roundTasks = (actions: CoachingAction[] | undefined, matchId: string, roundNo: number) =>
  (actions || []).filter(action => action.sourceRound?.matchId === matchId && action.sourceRound.roundNo === roundNo);

/** Turn what the coach saw in a round into a task for players or the team, without leaving the round. */
export default function RoundTaskForm({ data, matchId, roundNo, onCreated }: { data: TrackerData; matchId: string; roundNo: number; onCreated: () => Promise<void> | void }) {
  const roster = useMemo(() => (data.rosterPlayers || []).filter(player => !player.retiredAt), [data.rosterPlayers]);
  const existing = roundTasks(data.coachingActions, matchId, roundNo);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('player-feedback');
  const [ownerIds, setOwnerIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const toggle = (id: string) => setOwnerIds(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));
  const create = async () => {
    if (!title.trim()) return setNotice('Write what the task is first.');
    setBusy(true);
    setNotice('');
    try {
      const response = await apiFetch('/api/coaching/round-tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchId, roundNo, title: title.trim(), kind, ownerIds, vodSeconds: roundVodSeconds(data, matchId, roundNo) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The task could not be created.');
      setTitle('');
      setOwnerIds([]);
      setNotice(ownerIds.length ? `Task created and sent to ${ownerIds.length === 1 ? 'the player' : `${ownerIds.length} players`}.` : 'Task created for the staff list.');
      await onCreated();
    } catch (error: any) {
      setNotice(error.message || 'The task could not be created.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="rounded-lg border border-white/10 bg-black/15 p-3" open={existing.length > 0 || undefined}>
      <summary className="cursor-pointer text-xs font-semibold text-slate-200">
        <ListTodo className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
        Tasks from this round{existing.length ? ` (${existing.length})` : ''}
      </summary>
      {existing.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {existing.map(action => (
            <li key={action.id} className="flex flex-wrap gap-2 text-slate-300">
              <span className="font-semibold text-slate-100">{action.title}</span>
              <span className="text-slate-400">
                {action.ownerIds.length ? action.ownerIds.map(id => roster.find(player => player.id === id)?.displayName || 'Former player').join(', ') : 'Staff'} · {STATE_LABELS[action.state]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
        <input
          aria-label={`Task from round ${roundNo}`}
          value={title}
          maxLength={160}
          onChange={event => setTitle(event.target.value)}
          placeholder="What should change? e.g. hold the trade on B main"
          className="ui-field min-h-10 min-w-0 px-3 text-xs"
        />
        <select aria-label={`Task type for round ${roundNo}`} value={kind} onChange={event => setKind(event.target.value)} className="ui-field min-h-10 px-3 text-xs">
          {Object.entries(KIND_LABELS).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="mt-2">
        <legend className="text-xs text-slate-400">For (none = staff only)</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {roster.map(player => (
            <label key={player.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs">
              <input type="checkbox" checked={ownerIds.includes(player.id)} onChange={() => toggle(player.id)} />
              {player.displayName}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void create()} className="ui-button inline-flex min-h-10 items-center gap-1.5 px-3 text-xs">
          <ListTodo className="h-3.5 w-3.5" /> {busy ? 'Creating…' : 'Create task'}
        </button>
        {notice && (
          <p role="status" className="text-xs text-cyan-200">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
