import React, { useEffect, useState } from 'react';
import { Activity, Download, RefreshCw, Trash2 } from 'lucide-react';
import type { RosterPlayer } from '../types';
import { downloadOcrLearningDataset, getOcrLearningState, resetOcrLearning, setOcrLearningEnabled } from '../utils/ocrLearningStore';
import { confirmDialog } from '../utils/appDialogs';

type LearningState = Awaited<ReturnType<typeof getOcrLearningState>>;
const percent = (value: number | null) => value === null ? 'No evidence' : `${Math.round(value * 100)}%`;

export default function OcrHealthPanel({ rosterPlayers, isLight }: { rosterPlayers: RosterPlayer[]; isLight: boolean }) {
  const [state, setState] = useState<LearningState | null>(null); const [loading, setLoading] = useState(false);
  const load = async () => { setLoading(true); try { setState(await getOcrLearningState(rosterPlayers)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [rosterPlayers]);
  if (!state) return <div className="p-6 text-sm text-slate-400">Loading local OCR evidence…</div>;
  const { health } = state;
  const card = isLight ? 'border-slate-200 bg-slate-50' : 'border-white/10 bg-black/20';
  const trained = (field: string, minimum: number) => (health.fields.find(item => item.field === field)?.count || 0) >= minimum;
  return <section className="space-y-5" aria-labelledby="ocr-health-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 id="ocr-health-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-wider"><Activity className="h-4 w-4 text-cyan-300"/>OCR health & learning</h4><p className="mt-1 text-xs text-slate-400">Private correction labels and shadow outcomes stored only in this browser profile. Learning uses repeated evidence from different captures and stays scoped to the same screen region.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setOcrLearningEnabled(!state.enabled); void load(); }} className="ui-button min-h-10 px-3 text-xs">{state.enabled ? 'Pause learning' : 'Enable learning'}</button><button type="button" onClick={async () => { if (!(await confirmDialog('Reset all local OCR correction labels? This cannot be undone.', { destructive: true, confirmLabel: 'Reset' }))) return; void resetOcrLearning().then(load); }} className="ui-button min-h-10 px-3 text-xs"><Trash2 className="mr-1 inline h-3 w-3"/>Reset labels</button><button type="button" onClick={() => void load()} disabled={loading} className="ui-button min-h-10 px-3 text-xs"><RefreshCw className={`mr-1 inline h-3 w-3 ${loading ? 'animate-spin' : ''}`}/>Refresh</button><button type="button" onClick={() => downloadOcrLearningDataset(state)} className="ui-button min-h-10 px-3 text-xs"><Download className="mr-1 inline h-3 w-3"/>Export labels</button></div></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[['Capture sessions', health.sessions], ['Automatic imports', `${health.automatic} · ${percent(health.automaticRate)}`], ['Cache reuse', percent(health.cacheHitRate)], ['Coach corrections', health.correctedFields]].map(([label, value]) => <article key={String(label)} className={`rounded-xl border p-4 ${card}`}><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</p><p className="mt-2 font-mono text-xl font-bold">{value}</p></article>)}
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <article className={`rounded-xl border p-4 ${card}`}><h5 className="text-xs font-bold uppercase tracking-wider">Local model readiness</h5><div className="mt-3 space-y-2 text-xs">{[
        ['Player alias model', health.learnedAliases > 0, `${health.learnedAliases} learned aliases`],
        ['VALORANT number correction model', ['kills','deaths','assists'].some(field => trained(field, 20)), 'Needs 20+ corrected numeric cells'],
        ['Agent correction model', trained('agent', 20), 'Needs 20+ corrected agent labels'],
      ].map(([label, ready, detail]) => <div key={String(label)} className="flex items-center justify-between gap-3"><span>{label}</span><span className={ready ? 'text-emerald-300' : 'text-amber-300'}>{ready ? 'Learning active' : String(detail)}</span></div>)}</div></article>
      <article className={`rounded-xl border p-4 ${card}`}><h5 className="text-xs font-bold uppercase tracking-wider">Top exception causes</h5><div className="mt-3 space-y-2 text-xs">{health.reasons.length ? health.reasons.slice(0, 8).map(item => <div key={item.reason} className="flex justify-between gap-3"><span className="break-all text-slate-400">{item.reason}</span><span className="font-mono">{item.count}</span></div>) : <p className="text-slate-500">No capture outcomes recorded yet.</p>}</div></article>
    </div>
    <article className={`rounded-xl border p-4 ${card}`}><h5 className="text-xs font-bold uppercase tracking-wider">Corrections by field</h5><div className="mt-3 flex flex-wrap gap-2">{health.fields.length ? health.fields.map(item => <span key={item.field} className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] text-cyan-100">{item.field}: {item.count}</span>) : <span className="text-xs text-slate-500">Edits to accepted OCR matches will appear here automatically.</span>}</div></article>
  </section>;
}
