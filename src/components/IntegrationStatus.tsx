import React, { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { engineAdapterUiSummary } from '../../lib/uiIntegration';

interface Entry { configured: boolean; note?: string; }
type StatusMap = Record<string, Entry>;
const LABELS: Record<string, string> = { gemini: 'Gemini AI', discord: 'Discord', pracc: 'PRACC Calendar', replay: 'Replay Evidence', shadowRating: 'Shadow Rating' };
const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value : [];

export function CoachEngineReadiness({ role, engineState }: { role: string | null; engineState: any }) {
  if (role !== 'coach' && role !== 'owner') return null;
  const replay = asArray<any>(engineState?.replay);
  const ratings = Object.values(engineState?.ratings?.records || {}) as any[];
  const configs = Object.values(engineState?.ratings?.configs || {}) as any[];
  return <div className="border-t border-white/5 pt-2.5 space-y-2" aria-label="Persisted engine readiness"><p className="text-xs font-bold uppercase tracking-widest text-gray-500">Coach evidence readiness</p><div className="grid gap-2 sm:grid-cols-2"><ReadinessCard title="Replay" detail={`${replay.length} active · ${replay.filter(item => item.status === 'review-required').length} awaiting review`} /><ReadinessCard title="Shadow rating" detail={`${ratings.length} recomputed · ${ratings.filter(item => item.calibrationStatus === 'calibrated').length} calibrated`} /></div>{ratings.length > 0 && <details><summary className="cursor-pointer text-xs text-gray-300">Inspect rating contributions and coverage</summary><div className="mt-2 space-y-2">{ratings.map(record => <div key={record.recordKey} className="rounded-md border border-white/10 bg-black/10 p-2 text-xs"><p className="font-semibold text-gray-200">{record.result?.context?.playerId || 'Unknown player'} · {record.status}</p><p className="text-gray-500">Coverage {record.result?.coverage?.ratio === null || record.result?.coverage?.ratio === undefined ? 'unknown' : `${Math.round(record.result.coverage.ratio * 100)}%`} · calibration {record.calibrationStatus || 'unknown'} · authoritative score unavailable</p><ul className="mt-1 text-gray-400">{asArray<any>(record.result?.metrics).map(metric => <li key={metric.metric}>{metric.metric}: {metric.included ? metric.weightedContribution ?? 'computed' : 'excluded'}</li>)}</ul></div>)}</div></details>}{configs.length > 0 && <details><summary className="cursor-pointer text-xs text-gray-300">Current versioned weight configuration</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-gray-500">{JSON.stringify(configs.map(config => ({ key: config.key, calibrationStatus: config.calibrationStatus, weights: config.formula?.weights })), null, 2)}</pre></details>}</div>;
}

export function CoachEngineAuthoring({ role, engineState, onChanged }: { role: string | null; engineState: any; onChanged: (state: any) => void }) {
  const [ratingConfig, setRatingConfig] = useState(''); const [ratingPreview, setRatingPreview] = useState(''); const [ratingInput, setRatingInput] = useState('');
  const [output, setOutput] = useState(''); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  if (role !== 'coach' && role !== 'owner') return null;
  const refresh = async () => { const response = await apiFetch('/api/engine-adapters'); if (response.ok) onChanged(await response.json()); };
  const submit = async (route: string, source: string, decorate: (parsed: any) => any = value => value) => {
    setError(''); setOutput(''); setPending(true);
    try {
      const parsed = JSON.parse(source); const body = decorate(parsed);
      const response = await apiFetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Engine update failed.');
      setOutput(JSON.stringify(result, null, 2)); await refresh(); return true;
    } catch (cause: any) { setError(cause.message || 'Enter complete valid JSON.'); return false; } finally { setPending(false); }
  };
  const records = Object.values(engineState?.ratings?.records || {}) as any[];
  return <section className="border-t border-white/5 pt-2.5 space-y-2" aria-label="Coach engine authoring"><p className="text-xs font-bold uppercase tracking-widest text-gray-500">Coach setup & recomputation</p><details><summary className="cursor-pointer text-xs font-semibold text-gray-300">Shadow rating configuration and recompute</summary><div className="mt-2 space-y-2"><JsonField id="rating-config" label="Formula, baseline, validation input and expectedRevision JSON" value={ratingConfig} onChange={setRatingConfig} /><button disabled={pending || !ratingConfig.trim()} onClick={() => submit('/api/engine-adapters/ratings/config', ratingConfig, value => ({ ...value, requestId: crypto.randomUUID() }))} className="rounded-md border border-white/10 px-2 py-1 text-xs">Save explicitly uncalibrated config</button><JsonField id="rating-preview" label="Weight preview JSON: configKey, input, candidateFormula" value={ratingPreview} onChange={setRatingPreview} /><button disabled={pending || !ratingPreview.trim()} onClick={() => submit('/api/engine-adapters/ratings/preview', ratingPreview)} className="rounded-md border border-white/10 px-2 py-1 text-xs">Preview weights</button><JsonField id="rating-input" label="Recompute JSON: configKey, input, expectedRevision" value={ratingInput} onChange={setRatingInput} /><button disabled={pending || !ratingInput.trim()} onClick={() => submit('/api/engine-adapters/ratings/recompute', ratingInput, value => ({ ...value, requestId: crypto.randomUUID() }))} className="rounded-md border border-white/10 px-2 py-1 text-xs">Recompute on server</button>{records.filter(record => record.status === 'review-required').map(record => <button key={record.recordKey} disabled={pending} onClick={() => submit('/api/engine-adapters/ratings/accept', JSON.stringify({ recordKey: record.recordKey, expectedRevision: record.revision }), value => ({ ...value, requestId: crypto.randomUUID() }))} className="mr-2 rounded-md bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">Accept {record.result?.context?.playerId || record.recordKey}</button>)}</div></details>{output && <pre aria-live="polite" className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-black/20 p-2 text-xs text-emerald-300">{output}</pre>}{error && <p role="alert" className="text-xs text-rose-400">{error}</p>}</section>;
}

function JsonField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) { return <label htmlFor={id} className="block text-xs text-gray-400">{label}<textarea id={id} value={value} onChange={event => onChange(event.target.value)} className="mt-1 h-24 w-full rounded-md border border-white/10 bg-black/20 p-2 font-mono text-xs" /></label>; }

function ReadinessCard({ title, detail }: { title: string; detail: string }) { return <div className="rounded-md border border-white/10 bg-black/10 p-2"><p className="text-xs font-semibold text-gray-200">{title}</p><p className="mt-0.5 text-xs text-gray-500">{detail}</p></div>; }

export default function IntegrationStatus({ role = null }: { role?: string | null }) {
  const [status, setStatus] = useState<StatusMap | null>(null); const [engineState, setEngineState] = useState<any>(null);
  useEffect(() => { let alive = true; Promise.all([apiFetch('/api/integrations-status'), apiFetch('/api/engine-adapters')]).then(async ([integrations, engines]) => { const engineJson = engines.ok ? await engines.json() : null; if (alive) setEngineState(engineJson); return { ...(integrations.ok ? await integrations.json() : {}), ...(engineJson ? engineAdapterUiSummary(engineJson) : {}) }; }).then(json => { if (alive) setStatus(json); }).catch(() => {}); return () => { alive = false; }; }, []);
  if (!status) return null;
  const entries = Object.entries(status) as [string, Entry][]; const configuredCount = entries.filter(([, value]) => value.configured).length;
  return <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-2.5"><div className="flex items-center justify-between"><span className="text-xs uppercase font-bold tracking-widest text-gray-500">Evidence & integrations</span><span className="text-xs font-mono text-gray-500">{configuredCount}/{entries.length} configured</span></div><div className="grid grid-cols-2 gap-1.5">{entries.map(([key, value]) => <div key={key} className="flex items-center gap-1.5" title={`${value.configured ? 'Configured; runtime success not verified' : 'Unavailable or not configured'} — ${value.note || ''}`}><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${value.configured ? 'bg-emerald-400' : 'bg-gray-600'}`} /><span className={`text-xs font-mono truncate ${value.configured ? 'text-gray-300' : 'text-gray-600'}`}>{LABELS[key] || key}</span></div>)}</div><CoachEngineReadiness role={role} engineState={engineState} /><CoachEngineAuthoring role={role} engineState={engineState} onChanged={setEngineState} /></div>;
}
