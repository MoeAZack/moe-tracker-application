import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, FolderOpen, Image, LoaderCircle, PauseCircle, Play, PlayCircle, ScanLine, Trash2, WifiOff, X } from 'lucide-react';
import { confirmDialog } from '../utils/appDialogs';

export default function DesktopCommandCenter({ onOpenReplay, onOpenCapture }: { onOpenReplay?: () => void; onOpenCapture?: () => void }) {
  const bridge = typeof window === 'undefined' ? undefined : window.moeDesktop;
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [captureRounds, setCaptureRounds] = useState<number | ''>('');
  const [dismissedAttention, setDismissedAttention] = useState('');
  const refresh = async () => bridge && setStatus(await bridge.getStatus());
  useEffect(() => {
    let active = true;
    const update = () => bridge?.getStatus().then(value => { if (active) setStatus(value); }).catch(error => { if (active) setNotice(error.message); });
    void update(); const interval = window.setInterval(update, 5_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  if (!bridge) return null;
  const run = async (name: string, task: () => Promise<any>) => {
    setBusy(name); setNotice('');
    try { const result = await task(); setNotice(result.message || (result.path ? `Saved to ${result.path}` : 'Done.')); await refresh(); }
    catch (error: any) { const message = error.message || 'Action failed.'; const diagnostic = await bridge.reportDiagnostic({ action: name, message }).catch(() => null); setNotice(`${message}${diagnostic?.code ? ` Error code: ${diagnostic.code}` : ''}`); }
    finally { setBusy(''); }
  };
  const mb = status?.latestReplay ? Math.round(status.latestReplay.size / 1024 / 1024) : 0;
  const pendingScoreboards = Number(status?.pendingScoreboards || 0);
  const replays = status?.replays || [];
  const hasAttention = pendingScoreboards > 0 || Number(status?.sync?.pending || 0) > 0;
  const attentionKey = `${pendingScoreboards}:${Number(status?.sync?.pending || 0)}:${Boolean(status?.sync?.paired)}`;
  return <section className="desktop-intake overflow-hidden rounded-2xl" aria-labelledby="desktop-intake-title">
    <header className="desktop-intake-header">
      <div className="min-w-0">
        <p className="desktop-intake-eyebrow">Match intake</p>
        <h2 id="desktop-intake-title" className="mt-1 text-lg font-semibold text-white">Ready for the next review</h2>
        <p className="mt-1 truncate text-xs text-slate-400">{status?.deviceName || 'Loading this PC'} · Moe Tracker v{status?.appVersion || __APP_VERSION__} · evidence stays available offline</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="desktop-status desktop-status-online"><CheckCircle2 className="h-3 w-3" />Service online</span>
        <span className="desktop-status"><WifiOff className="h-3 w-3" />Offline ready</span>
        {status?.sync?.paired && <span className="desktop-status"><Cloud className="h-3 w-3" />Team linked</span>}
        <span className="desktop-status">{status?.capture?.paused ? <PauseCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}{status?.capture?.state?.replaceAll('-', ' ') || 'checking capture'}</span>
      </div>
    </header>

    <div className="grid items-stretch gap-3 p-4 xl:grid-cols-2">
      <article className={`desktop-next-action flex h-full min-w-0 flex-col ${pendingScoreboards ? 'desktop-next-action-review' : ''}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="desktop-action-icon">{pendingScoreboards ? <ScanLine className="h-5 w-5" /> : <Play className="h-5 w-5" />}</span>
          <div className="min-w-0 flex-1">
            <p className="desktop-intake-eyebrow">{pendingScoreboards ? 'Action needed' : 'Latest replay'}</p>
            <h3 className="mt-1 truncate text-xl font-semibold text-white">{pendingScoreboards ? `${pendingScoreboards} captured match${pendingScoreboards === 1 ? '' : 'es'} ready to review` : status?.latestReplay?.name || 'Waiting for match evidence'}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{pendingScoreboards ? 'Confirm the detected players, score, and rounds. Accepted data will feed player, economy, and map metrics.' : status?.latestReplay ? `${mb} MB · ${status.replayCount} replay${status.replayCount === 1 ? '' : 's'} available on this PC.` : 'Finish a match and Moe Tracker will detect replay or scoreboard evidence here.'}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {pendingScoreboards ? <button type="button" onClick={onOpenCapture || onOpenReplay} className="ui-button ui-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm"><Image className="h-4 w-4" />Review captured match</button> : <button type="button" disabled={!!busy || !status?.latestReplay} onClick={() => run('process', bridge.processMatch)} className="ui-button ui-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm disabled:opacity-50">{busy === 'process' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Process latest replay</button>}
              {pendingScoreboards > 0 && status?.latestReplay && <button type="button" disabled={!!busy} onClick={() => run('process', bridge.processMatch)} className="ui-button min-h-11 px-4 text-xs disabled:opacity-50"><Play className="h-4 w-4" />Process replay instead</button>}
              <button type="button" disabled={!!busy} onClick={() => run('capture-pause', () => bridge.setCapturePaused(!status?.capture?.paused))} className="ui-button min-h-11 px-4 text-xs disabled:opacity-50">{status?.capture?.paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}{status?.capture?.paused ? 'Resume capture' : 'Pause capture'}</button>
            </div>
          </div>
        </div>
          {replays.length > 0 && <div className="desktop-replay-list mt-5 border-t border-white/10 pt-3"><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Replay files on this PC</p><span className="text-xs text-slate-500">{replays.length} total</span></div><ul className="max-h-36 space-y-1 overflow-y-auto pr-1">{replays.map((replay: any) => <li key={replay.path} className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.07] bg-black/10 px-3 py-2"><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-slate-200">{replay.name}</span><span className="text-xs text-slate-500">{Math.max(1, Math.round(replay.size / 1024 / 1024))} MB</span></span><button type="button" aria-label={`Delete replay ${replay.name}`} disabled={!!busy} onClick={async () => { if ((await confirmDialog(`Move ${replay.name} to the Recycle Bin?`, { destructive: true, confirmLabel: 'Move to Recycle Bin' }))) void run('delete-replay', () => bridge.deleteReplay(replay.path)); }} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-rose-300/15 text-rose-300 hover:border-rose-300/35 hover:bg-rose-300/10 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></li>)}</ul></div>}
      </article>

      <aside className="desktop-capture-card flex h-full min-w-0 flex-col" aria-label="Screenshot capture workflow">
        <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm font-semibold text-white"><Image className="h-4 w-4 text-fuchsia-300" />Screenshot capture</span><span className="text-2xl font-semibold tabular-nums text-white">{pendingScoreboards}</span></div>
        <ol className="mt-4 space-y-2 text-xs text-slate-300">
          <li><span>1</span>Open the completed match Timeline</li>
          <li><span>2</span>Start capture and return to VALORANT</li>
          <li><span>3</span>Review uncertain fields, then accept</li>
        </ol>
        <label className="mt-4 block text-xs text-slate-400">Rounds · leave blank for automatic<input aria-label="Numbered rounds shown in Timeline; blank detects automatically" type="number" min={1} max={32} value={captureRounds} placeholder="Automatic" onChange={event => setCaptureRounds(event.target.value === '' ? '' : Number(event.target.value))} className="ui-field mt-1 h-10 w-full px-2 text-center text-sm text-white" /></label>
        <p className="mt-2 text-xs leading-4 text-slate-400">Round count, Standard and Performance layouts are detected automatically. Enter a count only to override detection.</p>
        <button type="button" disabled={!!busy || (captureRounds !== '' && (!Number.isInteger(captureRounds) || captureRounds < 1 || captureRounds > 32))} onClick={() => run('capture', () => bridge.startScrimCapture({ roundCount: captureRounds === '' ? 0 : captureRounds }))} className="ui-button ui-button-primary mt-3 flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs disabled:opacity-50"><Image className="h-4 w-4" />Start post-match capture</button>
        <button type="button" onClick={() => run('screenshots', () => bridge.openFolder('screenshots'))} className="capture-folder-button"><span><FolderOpen className="h-4 w-4" />Open capture folder</span></button>
      </aside>
    </div>

    {hasAttention && dismissedAttention !== attentionKey && <div className="mx-4 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-xs text-amber-100" role="status"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" /><span className="min-w-0 flex-1">{pendingScoreboards > 0 && <span className="mr-4">{pendingScoreboards} capture{pendingScoreboards === 1 ? '' : 's'} awaiting review</span>}{Number(status?.sync?.pending || 0) > 0 && <span>{status?.sync?.paired ? `${status.sync.pending} change${status.sync.pending === 1 ? '' : 's'} waiting to sync` : `${status.sync.pending} change${status.sync.pending === 1 ? '' : 's'} saved locally · pair this PC in Settings to share them`}</span>}</span><button type="button" aria-label="Dismiss alert" onClick={() => setDismissedAttention(attentionKey)} className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-amber-200 hover:bg-white/10"><X className="h-4 w-4" /></button></div>}

    {notice && <div className="mx-4 mb-4 flex items-center gap-3 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.05] px-4 py-3 text-xs text-cyan-100" role="status"><span className="min-w-0 flex-1">{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')} className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button></div>}
  </section>;
}
