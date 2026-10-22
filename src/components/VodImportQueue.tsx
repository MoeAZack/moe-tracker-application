import React from 'react';
import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, X } from 'lucide-react';
import { vodImportStore, type VodQueueItem, type VodQueueStatus } from '../utils/vodImportRunner';

const STATUS: Record<VodQueueStatus, { label: string; tone: string; Icon: typeof Clock3 }> = {
  waiting: { label: 'Waiting', tone: 'text-slate-300', Icon: Clock3 },
  running: { label: 'Importing', tone: 'text-cyan-200', Icon: LoaderCircle },
  done: { label: 'Done', tone: 'text-emerald-200', Icon: CheckCircle2 },
  error: { label: 'Stopped', tone: 'text-rose-200', Icon: CircleAlert },
  removed: { label: 'Removed', tone: 'text-slate-400', Icon: X },
};

/** The list of queued VOD imports. Hidden until there is more than one, since a single import already has its progress panel. */
export default function VodImportQueue({ queue }: { queue: VodQueueItem[] }) {
  if (queue.length < 2 && !queue.some(item => item.status === 'waiting')) return null;
  const finished = queue.filter(item => item.status !== 'waiting' && item.status !== 'running').length;
  const waiting = queue.filter(item => item.status === 'waiting').length;
  return (
    <section aria-label="Video import queue" className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-white">
          Video queue · {queue.length} video{queue.length === 1 ? '' : 's'}
          {waiting ? ` · ${waiting} waiting` : ''}
        </h4>
        {finished > 0 && (
          <button type="button" onClick={() => vodImportStore.clearFinished()} className="ui-button min-h-8 px-3 text-xs">
            Clear finished
          </button>
        )}
      </div>
      <ol className="mt-2 grid gap-2">
        {queue.map((item, index) => {
          const { label, tone, Icon } = STATUS[item.status];
          return (
            <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs">
              <span className="text-slate-400">{index + 1}.</span>
              <span className="min-w-0 flex-1 truncate text-slate-100" title={item.label}>
                {item.label}
              </span>
              <span className="text-slate-400">
                {item.games.length ? `${item.games.length} of ${item.expectedGames} game${item.expectedGames === 1 ? '' : 's'} saved` : `${item.expectedGames} game${item.expectedGames === 1 ? '' : 's'}`}
              </span>
              <span className={`inline-flex items-center gap-1 font-semibold ${tone}`}>
                <Icon className={`h-3.5 w-3.5 ${item.status === 'running' ? 'animate-spin' : ''}`} aria-hidden="true" />
                {label}
              </span>
              {item.status === 'waiting' && (
                <button type="button" aria-label={`Remove ${item.label} from the queue`} onClick={() => vodImportStore.remove(item.id)} className="ui-button min-h-8 px-2 text-xs">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {item.status === 'error' && item.message && <p className="w-full text-rose-200/90">{item.message}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
