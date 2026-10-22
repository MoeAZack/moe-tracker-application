import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { TrackerData } from '../types';
import { buildReviewInbox, groupReviewInbox, type InboxTarget } from '../../lib/reviewInbox';
import { apiFetch } from '../utils/api';

interface Props { data: TrackerData; desktopMode: boolean; onOpen: (target: InboxTarget) => void }

/** Everything waiting for a coach, from every source, in one list. */
export default function ReviewInbox({ data, desktopMode, onOpen }: Props) {
  const [pending, setPending] = useState<{ captures: number; replays: number }>({ captures: 0, replays: 0 });
  useEffect(() => {
    if (!desktopMode) return;
    let alive = true;
    const refresh = async () => {
      const captures = await window.moeDesktop?.getStatus().then(status => status.pendingScoreboards || 0).catch(() => 0) ?? 0;
      const replays = await apiFetch('/api/replay-intake/uploads').then(async response => response.ok ? response.json() : [])
        .then((uploads: any[]) => uploads.filter(upload => upload?.reviewStatus !== 'accepted' && upload?.parserStatus === 'parsed-review-required').length).catch(() => 0);
      if (alive) setPending({ captures, replays });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [desktopMode]);
  // Practice summaries are sent from the desktop app, where the session links live.
  const groups = useMemo(() => groupReviewInbox(buildReviewInbox(data, pending).filter(item => desktopMode || item.kind !== 'summary')), [data, pending, desktopMode]);

  const entry = (title: string, detail: string) => <>
    <span className="text-xs font-semibold text-white">{title}</span>
    <span className="text-xs text-gray-400">{detail}</span>
  </>;

  return <section className="liquid-subtle rounded-xl p-4" aria-label="Review inbox">
    <div className="flex items-center gap-2 text-sm font-semibold text-white"><Inbox className="h-4 w-4 text-cyan-300" />Inbox<span className="text-xs font-normal text-gray-400">{groups.length ? `${groups.length} to do` : 'Nothing waiting for review'}</span></div>
    {groups.length > 0 && <ul className="mt-3 space-y-2">
      {groups.map(group => <li key={group.id}>{group.items.length === 1
        ? <button type="button" onClick={() => onOpen(group.items[0].target)} className="ui-button flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left">{entry(group.title, group.detail)}</button>
        : <details className="rounded-lg border border-white/10 px-3 py-2">
          <summary className="flex cursor-pointer flex-col items-start gap-0.5">{entry(group.title, group.detail)}</summary>
          <ul className="mt-2 space-y-1">
            {group.items.map(item => <li key={item.id}><button type="button" onClick={() => onOpen(item.target)} className="ui-button flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left">{entry(item.title, item.detail)}</button></li>)}
          </ul>
        </details>}</li>)}
    </ul>}
  </section>;
}
