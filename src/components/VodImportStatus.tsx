import React from 'react';
import { Film, LoaderCircle, X } from 'lucide-react';
import { overallVodPercent, useVodImportState, vodImportStore, VOD_STEPS } from '../utils/vodImportRunner';

// Window-wide status for the automatic VOD import, shown on every tab except the
// VOD tab itself (which renders the full progress panel).
export default function VodImportStatus({ hidden, onOpen }: { hidden?: boolean; onOpen: () => void }) {
  const state = useVodImportState();
  if (hidden || !state.progress || state.dismissed) return null;
  const { progress } = state; const overall = overallVodPercent(progress);
  const failed = progress.status === 'error'; const done = !state.running && progress.status === 'done';
  const label = state.running ? `Importing video · ${VOD_STEPS[progress.step] || 'Working'} · ${overall}%` : failed ? 'Video import stopped' : done ? 'Video import complete' : 'Video import ended';
  const tone = failed ? 'border-rose-300/25 bg-rose-400/10 text-rose-100' : done ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100' : 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100';
  return <div role="status" aria-live="polite" className={`mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 rounded-xl border px-4 py-2 text-xs ${tone}`}>
    {state.running ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /> : <Film className="h-4 w-4 shrink-0" />}
    <span className="font-semibold">{label}</span>
    <span className="min-w-0 flex-1 truncate text-slate-300">{failed ? progress.message : state.running ? `${progress.message} · keeps running while you use other tabs` : progress.message}</span>
    {state.running && <span className="h-1.5 w-24 overflow-hidden rounded-full bg-black/30" aria-hidden="true"><span className="block h-full bg-cyan-300" style={{ width: `${overall}%` }} /></span>}
    <button type="button" onClick={onOpen} className="ui-button min-h-8 px-3 text-xs">Open video import</button>
    {!state.running && <button type="button" aria-label="Dismiss video import status" onClick={() => vodImportStore.dismiss()} className="ui-button min-h-8 px-2 text-xs"><X className="h-3.5 w-3.5" /></button>}
  </div>;
}
