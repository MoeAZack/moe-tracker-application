import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, FolderOpen, HardDrive, Image, LoaderCircle, Play, RefreshCw, WifiOff } from 'lucide-react';

export default function DesktopCommandCenter() {
  const bridge = window.moeDesktop;
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = async () => bridge && setStatus(await bridge.getStatus());
  useEffect(() => { refresh().catch(error => setNotice(error.message)); }, []);
  if (!bridge) return null;
  const run = async (name: string, task: () => Promise<any>) => {
    setBusy(name); setNotice('');
    try { const result = await task(); setNotice(result.message || (result.path ? `Saved to ${result.path}` : 'Done.')); await refresh(); }
    catch (error: any) { setNotice(error.message || 'Action failed.'); }
    finally { setBusy(''); }
  };
  const mb = status?.latestReplay ? Math.round(status.latestReplay.size / 1024 / 1024) : 0;
  return <section className="liquid-panel overflow-hidden rounded-2xl" aria-label="Desktop match intake">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
      <div><div className="flex items-center gap-2 text-sm font-semibold text-white"><HardDrive className="h-4 w-4 text-cyan-300" />This PC</div><p className="mt-1 text-xs text-slate-400">Local evidence workspace · {status?.deviceName || 'loading device'}</p></div>
      <div className="flex flex-wrap gap-2 text-[10px] font-semibold"><span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-emerald-200"><CheckCircle2 className="mr-1 inline h-3 w-3" />Local service online</span><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-1 text-cyan-200"><WifiOff className="mr-1 inline h-3 w-3" />Works offline</span></div>
    </div>
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
      <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.045] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">Latest detected replay</p>
        <p className="mt-2 truncate text-base font-semibold text-white">{status?.latestReplay?.name || 'Waiting for your next practice replay'}</p>
        <p className="mt-1 text-xs text-slate-400">{status?.latestReplay ? `${mb} MB · ${status.replayCount} replay${status.replayCount === 1 ? '' : 's'} available locally` : 'VALORANT Demos and Moe Tracker Replays are watched automatically.'}</p>
        <button type="button" disabled={!!busy} onClick={() => run('process', bridge.processMatch)} className="ui-button ui-button-primary mt-4 min-h-11 px-5 text-sm disabled:opacity-60">{busy === 'process' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Process latest match</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => run('screenshots', () => bridge.openFolder('screenshots'))} className="ui-button min-h-20 flex-col text-xs"><Image className="h-5 w-5 text-fuchsia-300" />Scoreboards</button>
        <button type="button" onClick={() => run('replays', () => bridge.openFolder('replays'))} className="ui-button min-h-20 flex-col text-xs"><FolderOpen className="h-5 w-5 text-cyan-300" />Replay inbox</button>
        <button type="button" disabled={!!busy} onClick={() => run('export', bridge.exportTeamPackage)} className="ui-button min-h-20 flex-col text-xs disabled:opacity-60"><HardDrive className="h-5 w-5 text-amber-300" />Portable export</button>
        <button type="button" disabled={!!busy} onClick={() => run('sync', bridge.syncNow)} className="ui-button min-h-20 flex-col text-xs disabled:opacity-60"><Cloud className="h-5 w-5 text-emerald-300" />Sync now</button>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-5 py-3 text-[11px] text-slate-400"><span>Raw replay retention: {status?.retentionDays || 30} days · configurable</span><button type="button" onClick={() => run('folder', bridge.chooseReplayFolder)} className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><RefreshCw className="h-3 w-3" />Add another replay folder</button>{notice && <span className="basis-full text-cyan-100">{notice}</span>}</div>
  </section>;
}
