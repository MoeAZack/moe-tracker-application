import React, { useMemo, useState } from 'react';
import { CheckCircle2, Edit2, Plus, Trash2, XCircle } from 'lucide-react';
import { Strat, StratRun, TrackerData } from '../types';
import { buildResourceCatalog } from '../../lib/resourceCatalog';
import { buildStratRecords, STRAT_SIDES, stratSide } from '../../lib/stratbook';
import { DEFAULT_MINIMUM_METRIC_SAMPLES, metricSampleGate } from '../../lib/metricTrust';
import { knownResult } from '../../lib/analyticsEvidence';
import { percentageTextClass } from '../utils/percentageColor';
import { confirmDialog } from '../utils/appDialogs';

interface Props {
  data: TrackerData;
  theme: any;
  onUpsert: (sheet: string, row: any) => Promise<any>;
  onRemove: (sheet: string, id: string) => Promise<any>;
}

const SIDE_LABELS: Record<string, string> = { Att: 'Attack', Def: 'Defense', Retake: 'Retake' };

/** The one place to write, edit and review strategies. AI tools and Live Logger only add to it. */
export default function PlaybookStrategies({ data, theme, onUpsert, onRemove }: Props) {
  const isLight = data.settings.theme === 'daylight';
  const strats = data.strats || [];
  const runs = data.stratRuns || [];
  const minimumSamples = data.settings.stats?.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES;

  const maps = useMemo(() => {
    const names = new Map<string, string>();
    const add = (value: unknown) => { const display = String(value ?? '').trim(); if (display && !names.has(display.toLowerCase())) names.set(display.toLowerCase(), display); };
    buildResourceCatalog(data, 'map').forEach(entry => add(entry.name));
    (data.matches || []).forEach(match => add(match.map));
    strats.forEach(strat => add(strat.map));
    return [...names.values()];
  }, [data, strats]);

  const [selectedMap, setSelectedMap] = useState<string>(maps[0] || '');
  const [selectedSide, setSelectedSide] = useState<string>('All');
  const [editing, setEditing] = useState<Partial<Strat> | null>(null);
  const [runsFor, setRunsFor] = useState<Strat | null>(null);
  const [newRunResult, setNewRunResult] = useState('W');
  const [newRunReason, setNewRunReason] = useState('');

  const records = useMemo(() => buildStratRecords(strats, runs, data.rounds || [], data.matches || []), [strats, runs, data.rounds, data.matches]);
  const visible = strats.filter(strat => String(strat.map).trim().toLowerCase() === selectedMap.trim().toLowerCase() && (selectedSide === 'All' || stratSide(strat.side) === selectedSide));
  const runsForSelected = runsFor ? runs.filter(run => run.stratId === runsFor.id) : [];
  const panel = isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-white/5 border-white/10';
  const dialog = isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10';
  const field = 'w-full rounded border border-white/10 bg-black/20 p-2.5 text-xs text-white';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing?.name?.trim()) return;
    await onUpsert('Strats', { ...editing, name: editing.name.trim(), side: stratSide(editing.side) || 'Att' });
    setEditing(null);
  };
  const remove = async (strat: Strat) => {
    if (data.settings.confirmOnDelete && !(await confirmDialog(`Delete “${strat.name}” and its logged runs?`, { destructive: true, confirmLabel: 'Delete' }))) return;
    await onRemove('Strats', strat.id);
    if (runsFor?.id === strat.id) setRunsFor(null);
  };
  const addRun = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!runsFor) return;
    const run: Partial<StratRun> = { id: '', stratId: runsFor.id, matchId: '', date: new Date().toISOString().slice(0, 10), map: runsFor.map, side: stratSide(runsFor.side) || runsFor.side, result: newRunResult, reason: newRunReason.trim() };
    await onUpsert('StratRuns', run);
    setNewRunReason('');
  };
  const removeRun = async (id: string) => {
    if (data.settings.confirmOnDelete && !(await confirmDialog('Delete this logged run?', { destructive: true, confirmLabel: 'Delete' }))) return;
    await onRemove('StratRuns', id);
  };

  const rate = (wins: number, total: number, label: string) => {
    if (!total) return <span className="text-slate-500">{label}: none yet</span>;
    const percent = Math.round(wins / total * 100);
    const small = metricSampleGate(total, minimumSamples).confidence === 'low';
    return <span>{label}: <span className="font-semibold">{wins}–{total - wins}</span> · <span className={small ? 'text-slate-300' : percentageTextClass(percent)}>{percent}%</span>{small && <span className="ml-1 text-amber-300">(small sample)</span>}</span>;
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
      <div className={`h-fit space-y-4 rounded-xl border p-5 lg:col-span-1 ${panel}`}>
        <label className="block space-y-1 text-xs">
          <span className="font-semibold text-slate-400">Map</span>
          <select value={selectedMap} onChange={event => setSelectedMap(event.target.value)} className={field}>
            {maps.map(map => <option key={map} value={map}>{map}</option>)}
          </select>
        </label>
        <fieldset className="space-y-1 text-xs">
          <legend className="font-semibold text-slate-400">Side</legend>
          {['All', ...STRAT_SIDES].map(side => (
            <button key={side} type="button" aria-pressed={selectedSide === side} onClick={() => setSelectedSide(side)} className={`w-full rounded p-2 text-left font-semibold ${selectedSide === side ? 'border-l-4 border-[#ff4655] bg-[#ff4655]/10 text-[#ff4655]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
              {side === 'All' ? 'All sides' : SIDE_LABELS[side]}
            </button>
          ))}
        </fieldset>
        <button type="button" disabled={!selectedMap} onClick={() => setEditing({ id: '', map: selectedMap, side: selectedSide === 'All' ? 'Att' : selectedSide, name: '', notes: '', active: 'TRUE' })} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white hover:bg-white/10 disabled:opacity-50">
          <Plus className="h-4 w-4" aria-hidden="true" /> New strategy
        </button>
        <p className="text-xs leading-relaxed text-slate-400">AI tools can draft a strategy and save it here. Picking strategies in Live Logger or the round editor logs a run and tags the round.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-3 content-start">
        {visible.map(strat => {
          const record = records[strat.id];
          return (
            <article key={strat.id} className="flex flex-col justify-between rounded-xl border border-white/5 bg-white/5 p-5 shadow-lg">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">{strat.map} · {SIDE_LABELS[stratSide(strat.side)] || strat.side || 'Side not set'}</p>
                    <h3 className="text-base font-bold leading-snug">{strat.name}</h3>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" aria-label={`Edit ${strat.name}`} onClick={() => setEditing({ ...strat, side: stratSide(strat.side) || 'Att' })} className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"><Edit2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                    <button type="button" aria-label={`Delete ${strat.name}`} onClick={() => remove(strat)} className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  </div>
                </div>
                {strat.notes && <p className="whitespace-pre-line text-xs leading-relaxed text-slate-400">{strat.notes}</p>}
              </div>
              <div className="mt-4 flex items-end justify-between gap-3 border-t border-white/5 pt-3 text-xs text-slate-400">
                <div className="space-y-0.5">
                  <p>{rate(record.runWins, record.runWins + record.runLosses, 'Logged runs')}</p>
                  <p>{rate(record.taggedWins, record.taggedRounds, 'Tagged rounds')}</p>
                  {record.lastFailReason && <p>Last failure: {record.lastFailReason}</p>}
                </div>
                <button type="button" onClick={() => { setRunsFor(strat); setNewRunResult('W'); setNewRunReason(''); }} className="shrink-0 rounded border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/10">Runs</button>
              </div>
            </article>
          );
        })}
        {!visible.length && (
          <p className="col-span-full rounded-xl border border-dashed border-white/10 py-16 text-center text-sm text-slate-400">
            {maps.length ? `No strategies for ${selectedMap}${selectedSide === 'All' ? '' : ` on ${SIDE_LABELS[selectedSide].toLowerCase()}`} yet.` : 'Add a map to the map library before writing strategies.'}
          </p>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form role="dialog" aria-modal="true" aria-labelledby="strat-editor-title" onSubmit={save} className={`w-full max-w-md space-y-4 rounded-2xl border p-6 ${dialog}`}>
            <h2 id="strat-editor-title" className="border-b border-white/10 pb-3 text-lg font-bold">{editing.id ? 'Edit strategy' : 'New strategy'}</h2>
            <div className="grid grid-cols-2 gap-4">
              <label className="space-y-1 text-xs"><span className="font-semibold text-slate-400">Map</span>
                <select value={editing.map} onChange={event => setEditing({ ...editing, map: event.target.value })} className={field}>{maps.map(map => <option key={map} value={map}>{map}</option>)}</select>
              </label>
              <label className="space-y-1 text-xs"><span className="font-semibold text-slate-400">Side</span>
                <select value={editing.side} onChange={event => setEditing({ ...editing, side: event.target.value })} className={field}>{STRAT_SIDES.map(side => <option key={side} value={side}>{SIDE_LABELS[side]}</option>)}</select>
              </label>
            </div>
            <label className="block space-y-1 text-xs"><span className="font-semibold text-slate-400">Name</span>
              <input type="text" required placeholder="e.g. A fast hit off Neon stun" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} className={field} />
            </label>
            <label className="block space-y-1 text-xs"><span className="font-semibold text-slate-400">Setup and play</span>
              <textarea rows={6} placeholder="Positions, agents, utility timing, backup plan…" value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} className={field} />
            </label>
            <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
              <button type="button" onClick={() => setEditing(null)} className="rounded bg-slate-500/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-500/20">Cancel</button>
              <button type="submit" className={`rounded px-4 py-2 text-xs font-semibold text-white ${theme.primaryBg}`}>Save strategy</button>
            </div>
          </form>
        </div>
      )}

      {runsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="strat-runs-title" className={`w-full max-w-2xl space-y-4 rounded-2xl border p-6 ${dialog}`}>
            <div className="border-b border-white/10 pb-3">
              <h2 id="strat-runs-title" className="text-lg font-bold">Runs of {runsFor.name}</h2>
              <p className="text-xs text-slate-400">{runsFor.map} · {SIDE_LABELS[stratSide(runsFor.side)] || runsFor.side}</p>
            </div>
            <form onSubmit={addRun} className="grid grid-cols-1 items-end gap-3 rounded-xl border border-white/5 bg-black/20 p-3.5 sm:grid-cols-3">
              <label className="space-y-1 text-xs"><span className="font-semibold text-slate-400">Result</span>
                <select value={newRunResult} onChange={event => setNewRunResult(event.target.value)} className={field}><option value="W">Worked</option><option value="L">Failed</option></select>
              </label>
              <label className="space-y-1 text-xs"><span className="font-semibold text-slate-400">What happened</span>
                <input type="text" placeholder="e.g. missed block, late trade" value={newRunReason} onChange={event => setNewRunReason(event.target.value)} className={field} />
              </label>
              <button type="submit" className={`w-full rounded py-2 text-xs font-semibold text-white ${theme.primaryBg}`}>Log run</button>
            </form>
            <ul className="max-h-[250px] space-y-2 overflow-y-auto pr-1 text-xs">
              {runsForSelected.map(run => (
                <li key={run.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 p-2.5">
                  <div className="flex items-center gap-2">
                    {knownResult(run.result) === 'win' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Worked" /> : <XCircle className="h-4 w-4 shrink-0 text-rose-500" aria-label="Failed" />}
                    <div><span className="font-semibold">{run.date}</span>{run.reason && <p className="text-slate-400">{run.reason}</p>}</div>
                  </div>
                  <button type="button" aria-label={`Delete run from ${run.date}`} onClick={() => removeRun(run.id)} className="rounded p-1 text-slate-400 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                </li>
              ))}
              {!runsForSelected.length && <li className="py-6 text-center text-slate-400">No runs logged for this strategy yet.</li>}
            </ul>
            <div className="flex justify-end border-t border-white/10 pt-4">
              <button type="button" onClick={() => setRunsFor(null)} className="rounded bg-slate-500/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-500/20">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
