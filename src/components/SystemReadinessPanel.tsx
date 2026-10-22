import React, { useEffect, useState } from 'react';
import { Film, RefreshCw, ShieldAlert } from 'lucide-react';
import { replayIntegrationReadiness, shadowRatingReadiness } from '../../lib/uiIntegration';
import { apiFetch } from '../utils/api';

export default function SystemReadinessPanel({ theme }: { theme: any }) {
  const [engineState, setEngineState] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch('/api/engine-adapters').then(async response => response.ok ? response.json() : null).then(setEngineState).catch(() => setEngineState(null)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const replay = replayIntegrationReadiness(engineState);
  const shadow = shadowRatingReadiness(engineState);
  const items = [
    { icon: Film, title: 'Replay evidence', status: replay.status === 'ready' ? 'Ready' : 'Needs attention', detail: replay.detail },
    { icon: ShieldAlert, title: 'Performance model', status: shadow.status === 'ready' ? 'Experimental' : 'Inactive', detail: `${shadow.detail} No authoritative score is shown.` },
  ];

  return <section className={`rounded-2xl border p-5 ${theme.cardBg} ${theme.border}`} aria-labelledby="system-readiness-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400">System</p><h2 id="system-readiness-title" className="mt-1 text-lg font-semibold">Data &amp; analysis readiness</h2><p className="mt-1 text-xs text-slate-400">Technical availability belongs here so the daily dashboard stays focused.</p></div><button type="button" onClick={load} disabled={loading} className="ui-button min-h-10 px-3 text-xs disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">{items.map(item => { const Icon = item.icon; return <article key={item.title} className={`rounded-xl border p-4 ${theme.border}`}><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-cyan-300" />{item.title}</span><span className="rounded-full border border-white/10 px-2 py-1 text-xs font-bold uppercase tracking-wider text-slate-300">{item.status}</span></div><p className="mt-3 text-xs leading-relaxed text-slate-400">{item.detail}</p></article>; })}</div>
  </section>;
}
