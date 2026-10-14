import { useCallback, useEffect, useState } from 'react';
import { Check, Clipboard, Cloud, Link2, RefreshCw, TriangleAlert } from 'lucide-react';
import { apiFetch } from '../utils/api';

type DesktopSyncStatus = Awaited<ReturnType<NonNullable<typeof window.moeDesktop>['getStatus']>>;

interface TeamSyncIndicatorProps {
  teamName: string;
  role: string | null;
  desktopMode: boolean;
}

const cairoTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit'
}).format(new Date(value));

export default function TeamSyncIndicator({ teamName, role, desktopMode }: TeamSyncIndicatorProps) {
  const [status, setStatus] = useState<DesktopSyncStatus | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!window.moeDesktop) return;
    try {
      setStatus(await window.moeDesktop.getStatus());
      setError(null);
    } catch {
      setError('Sync status unavailable');
    }
  }, []);

  useEffect(() => {
    if (!desktopMode) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [desktopMode, refresh]);

  const createCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch('/api/replay-intake/pairing-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not create a team code.');
      setCode({ code: result.code, expiresAt: result.expiresAt });
    } catch (caught: any) {
      setError(caught?.message || 'Could not create a team code.');
    } finally {
      setBusy(false);
    }
  };

  const paired = !desktopMode || Boolean(status?.sync.paired);
  const pending = status?.sync.pending || 0;
  const label = error ? 'Needs attention' : !paired ? 'Not paired' : pending ? `${pending} waiting to sync` : 'Team data in sync';

  return (
    <details className="team-sync-indicator">
      <summary className="team-sync-summary" aria-label={`Team sync for ${teamName}: ${label}. Show details.`}>
        <span className={`team-sync-dot ${error || !paired ? 'is-warning' : pending ? 'is-pending' : 'is-ready'}`} aria-hidden="true" />
        <span className="team-sync-copy"><strong>{teamName}</strong><small>{label}</small></span>
        <Cloud className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div className="team-sync-popover liquid-panel">
        <div className="flex items-start gap-3">
          {error || !paired ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" /> : <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />}
          <div><p className="text-sm font-semibold">{teamName} workspace</p><p className="mt-1 text-xs text-slate-400">{desktopMode ? (paired ? `This PC is paired${status?.sync.server ? ` with ${status.sync.server}` : ''}.` : 'Pair this PC so its captures reach the shared team workspace.') : 'You are viewing the shared team workspace.'}</p></div>
        </div>
        {desktopMode && status && <dl className="team-sync-values"><div><dt>Waiting to upload</dt><dd>{pending}</dd></div><div><dt>Received from team</dt><dd>{status.sync.received}</dd></div><div><dt>Mode</dt><dd>{status.mode === 'connected' ? 'Connected' : 'Offline-first'}</dd></div></dl>}
        {role === 'coach' && !desktopMode && <div className="team-code-box">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold">Pair another team PC</p><p className="mt-1 text-[11px] text-slate-400">Create a one-time code and enter it on that PC. It expires after 10 minutes.</p></div><Link2 className="h-4 w-4 shrink-0 text-cyan-300" /></div>
          {!code ? <button type="button" className="ui-button mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 px-3 text-xs" disabled={busy} onClick={() => void createCode()}>{busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{busy ? 'Creating…' : 'Create team code'}</button> : <div className="mt-3"><button type="button" className="team-code-value" onClick={async () => { await navigator.clipboard.writeText(code.code); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }} aria-label="Copy team pairing code"><span>{code.code}</span>{copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}</button><p className="mt-1 text-center text-[10px] text-amber-200">Expires {cairoTime(code.expiresAt)} Cairo</p></div>}
        </div>}
        {role === 'coach' && desktopMode && !paired && <div className="team-code-box"><p className="text-xs font-semibold">Connect this PC</p><p className="mt-1 text-[11px] leading-5 text-slate-400">Open the shared MoeTracker website as coach, create the team code there, then enter it in Settings → Device, Sync &amp; Storage on this PC.</p></div>}
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
      </div>
    </details>
  );
}
