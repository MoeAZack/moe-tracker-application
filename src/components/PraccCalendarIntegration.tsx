import React, { useEffect, useState } from 'react';
import { CalendarSync, RefreshCw, Unlink } from 'lucide-react';
import { apiFetch } from '../utils/api';

type Status = { configured: boolean; url: string; lastAttemptAt: string | null; lastSyncedAt: string | null; lastError: string | null };
const empty: Status = { configured: false, url: '', lastAttemptAt: null, lastSyncedAt: null, lastError: null };
const cairoTime = (value: string | null) => value ? `${new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))} Cairo` : 'Never';

export default function PraccCalendarIntegration({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState<Status>(empty); const [url, setUrl] = useState(''); const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const load = async () => { const response = await apiFetch('/api/pracc/calendar'); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'PRACC settings could not load.'); setStatus(body); setUrl(body.url || ''); };
  useEffect(() => { void load().catch(error => setMessage(error.message)); }, []);
  const request = async (path: string, body: Record<string, unknown>, action: string) => {
    setBusy(action); setMessage('');
    try {
      const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (typeof result.configured === 'boolean') { setStatus(result); if (typeof result.url === 'string') setUrl(result.url); }
      if (!response.ok) throw new Error(result.error || 'PRACC calendar sync failed.');
      setMessage(action === 'disconnect' ? 'PRACC feed disconnected. Imported schedule entries were kept.' : `PRACC calendar synced · ${result.imported || 0} added · ${result.updated || 0} refreshed${result.cancelled ? ` · ${result.cancelled} cancelled` : ''}.`);
      await onRefresh();
    } catch (error: any) { setMessage(error.message || 'PRACC calendar sync failed.'); await load().catch(() => undefined); }
    finally { setBusy(''); }
  };
  return <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4" aria-labelledby="pracc-calendar-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h5 id="pracc-calendar-title" className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-cyan-200"><CalendarSync className="h-4 w-4" /> PRACC calendar feed</h5><p className="mt-1 text-xs leading-relaxed text-gray-400">Paste the private calendar link from PRACC. Matches are imported into Schedule &amp; Goals in Cairo time and updated by their PRACC event ID.</p></div><span className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${status.configured ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/5 text-gray-400'}`}>{status.configured ? 'Connected' : 'Not connected'}</span></div>
    <label className="mt-4 block text-[10px] font-black uppercase text-gray-400">Private `.ics` feed URL<input type="url" inputMode="url" autoComplete="off" spellCheck={false} value={url} onChange={event => setUrl(event.target.value)} placeholder="https://pracc.com/api/matches/…/calendar.ics" className="ui-field mt-1 w-full p-2.5 text-sm" /></label>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!!busy || !url.trim()} onClick={() => void request('/api/pracc/calendar/configure', { url: url.trim() }, 'configure')} className="ui-button ui-button-primary min-h-10 px-4 text-xs disabled:opacity-40">{busy === 'configure' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CalendarSync className="h-4 w-4" />} Save &amp; sync</button>{status.configured && <button type="button" disabled={!!busy} onClick={() => void request('/api/pracc/calendar/sync', { force: true }, 'sync')} className="ui-button min-h-10 px-4 text-xs disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sync now</button>}{status.configured && <button type="button" disabled={!!busy} onClick={() => void request('/api/pracc/calendar/disconnect', {}, 'disconnect')} className="ui-button min-h-10 px-4 text-xs text-rose-300 disabled:opacity-40"><Unlink className="h-4 w-4" /> Disconnect</button>}</div>
    {status.configured && <div className="mt-3 grid gap-2 text-[10px] text-gray-400 sm:grid-cols-2"><p><strong className="text-gray-300">Last successful sync:</strong> {cairoTime(status.lastSyncedAt)}</p><p><strong className="text-gray-300">Last checked:</strong> {cairoTime(status.lastAttemptAt)}</p></div>}
    {(message || status.lastError) && <p role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs ${(message || status.lastError || '').toLowerCase().includes('synced') || (message || '').includes('disconnected') ? 'border-emerald-400/20 bg-emerald-400/5 text-emerald-100' : 'border-amber-400/20 bg-amber-400/5 text-amber-100'}`}>{message || status.lastError}</p>}
    <p className="mt-3 text-[10px] leading-relaxed text-gray-500">The feed key is stored privately and is never included in player data or shared backups. Opening Schedule &amp; Goals checks for updates automatically, with a ten-minute cooldown.</p>
  </section>;
}
