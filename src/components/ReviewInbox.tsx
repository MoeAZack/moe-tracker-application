import { useEffect, useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { TrackerData } from '../types';
import { buildReviewInbox, type InboxTarget } from '../../lib/reviewInbox';
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
  const items = useMemo(() => buildReviewInbox(data, pending), [data, pending]);

  return <section className="liquid-subtle rounded-xl p-4" aria-label="Review inbox">
    <div className="flex items-center gap-2 text-sm font-semibold text-white"><Inbox className="h-4 w-4 text-cyan-300" />Inbox<span className="text-xs font-normal text-gray-400">{items.length ? `${items.length} waiting` : 'Nothing waiting for review'}</span></div>
    {items.length > 0 && <ul className="mt-3 space-y-2">
      {items.map(item => <li key={item.id}><button type="button" onClick={() => onOpen(item.target)} className="ui-button flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left">
        <span className="text-xs font-semibold text-white">{item.title}</span>
        <span className="text-[11px] text-gray-400">{item.detail}</span>
      </button></li>)}
    </ul>}
  </section>;
}
