import React, { useEffect, useMemo, useState } from 'react';
import { Check, Clipboard, PenLine, X } from 'lucide-react';
import type { TrackerData } from '../types';
import { buildPracticeRecap, recapText } from '../../lib/practiceRecap';
import { apiFetch } from '../utils/api';

const RESULT_STYLE = { W: 'text-emerald-300', L: 'text-rose-300', D: 'text-slate-300' } as const;

function Section({ title, items, empty }: { title: string; items: React.ReactNode[]; empty: string }) {
  return (
    <section>
      <h3 className="text-xs font-black uppercase tracking-widest text-slate-400">{title}</h3>
      {items.length ? <ul className="mt-2 space-y-1 text-sm text-slate-200">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="mt-2 text-xs text-slate-400">{empty}</p>}
    </section>
  );
}

/**
 * The practice summary for one session, built from its linked matches, the
 * coach's accepted findings, tasks from its rounds and VOD notes. The coach
 * copies it into the team chat; copying marks it sent.
 */
export default function PracticeSummary({ data, scheduleId, light = false, onClose, onRefresh }: { data: TrackerData; scheduleId: string; light?: boolean; onClose: () => void; onRefresh: () => Promise<void> }) {
  const recap = useMemo(() => buildPracticeRecap(data, scheduleId), [data, scheduleId]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const markShared = async (shared: boolean) => {
    const response = await apiFetch('/api/practice-sessions/summary-shared', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scheduleId, shared }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The summary could not be marked.');
    await onRefresh();
  };
  const copy = async () => {
    if (!recap) return;
    setBusy(true); setMessage('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Copying is not available here. Select the text below and copy it instead.');
      await navigator.clipboard.writeText(recapText(recap));
      await markShared(true);
      setMessage('Copied. Paste it into the team chat.');
    } catch (error: any) { setMessage(error.message || 'The summary could not be copied.'); } finally { setBusy(false); }
  };
  const toggleSent = async () => {
    if (!recap) return;
    setBusy(true); setMessage('');
    try { await markShared(!recap.sharedAt); } catch (error: any) { setMessage(error.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/85 p-4" role="dialog" aria-modal="true" aria-labelledby="practice-summary-title">
      <div className={`mx-auto max-w-3xl space-y-5 rounded-xl border p-5 ${light ? 'border-slate-200 bg-white text-slate-800' : 'border-white/10 bg-[#0f1923] text-white'}`}>
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-violet-300">Practice summary</p>
            <h2 id="practice-summary-title" className="mt-1 text-lg font-bold">{recap ? `${recap.title} · ${recap.date}` : 'Practice summary'}</h2>
            {recap && <p className="mt-1 text-sm text-slate-300">{recap.headline}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close practice summary" className="ui-button min-h-9 px-2"><X className="h-4 w-4" /></button>
        </div>
        {!recap ? (
          <p className="text-sm text-slate-400">Link this session to its matches first. The summary is built from them.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2 text-xs">
              {recap.matches.map(match => (
                <li key={match.matchId} className="rounded-lg border border-white/10 px-3 py-1.5">
                  {match.map} vs {match.opponent}: {match.score ? <span className={`font-semibold ${RESULT_STYLE[match.result || 'D']}`}>{match.result} {match.score}</span> : <span className="text-slate-400">no score</span>}
                </li>
              ))}
            </ul>
            <div className="grid gap-5 sm:grid-cols-2">
              <Section title="Went well" items={recap.wentWell} empty="Nothing stood out with enough rounds behind it." />
              <Section title="Work on" items={recap.workOn} empty="Nothing stood out with enough rounds behind it." />
            </div>
            <Section title="From the review" items={recap.findings} empty="No accepted findings yet. Accept findings in Coach Workspace and they show here." />
            {recap.findingsToTriage > 0 && <p className="-mt-3 text-xs text-amber-200">{recap.findingsToTriage} finding{recap.findingsToTriage === 1 ? '' : 's'} from this practice still to accept or dismiss in Coach Workspace.</p>}
            <Section
              title="Tasks"
              items={recap.tasks.map(task => (
                <span key={task.id} className={task.open ? '' : 'text-slate-400 line-through'}>
                  {task.title}
                  <span className="text-xs text-slate-400">{task.owners.length ? ` · ${task.owners.join(', ')}` : ' · team'}{task.roundNo !== null ? ` · round ${task.roundNo}${task.map ? ` on ${task.map}` : ''}` : ''}</span>
                </span>
              ))}
              empty="No tasks yet. Make them from a round in match review."
            />
            <Section title="Players" items={recap.players.map(row => <span key={row.player}>{row.player}{row.agents.length ? <span className="text-xs text-slate-400"> ({row.agents.join(', ')})</span> : null}: <span className="text-slate-300">{row.line}</span></span>)} empty="No player rows recorded." />
            <Section
              title="VOD notes (staff only, not copied)"
              items={recap.notes.map(note => (
                <span key={`${note.reviewTitle}-${note.timeLabel}-${note.text}`}>
                  <span className="text-xs text-slate-400">{note.reviewTitle} · {note.timeLabel}{note.roundNo !== null ? ` · round ${note.roundNo}` : ''} </span>
                  {note.text || 'Drawing'}{note.drawing && <PenLine aria-label="has a drawing" className="ml-1 inline h-3.5 w-3.5 text-cyan-300" />}
                </span>
              ))}
              empty="No VOD notes on these matches."
            />
            {recap.evidence.health !== 'complete' && (
              <p className="text-xs text-amber-200">Based on {recap.evidence.acceptedMatches} of {recap.evidence.matches} matches and {recap.evidence.knownRounds} of {recap.evidence.rounds} rounds with a known result.</p>
            )}
            <details className="rounded-lg border border-white/10 p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-slate-300">Text that gets copied</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-slate-300">{recapText(recap)}</pre>
            </details>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <button type="button" disabled={busy} onClick={() => void copy()} className="ui-button ui-button-primary inline-flex min-h-10 items-center gap-2 px-4 text-sm">
                <Clipboard className="h-4 w-4" /> Copy for the team
              </button>
              <button type="button" disabled={busy} onClick={() => void toggleSent()} className="ui-button inline-flex min-h-10 items-center gap-2 px-3 text-sm">
                {recap.sharedAt ? 'Mark as not sent' : <><Check className="h-4 w-4" /> Mark as sent</>}
              </button>
              <p className="text-xs text-slate-400" role="status">{message || (recap.sharedAt ? `Sent ${new Date(recap.sharedAt).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' })} Cairo` : 'Not sent yet')}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
