import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cloud, Download, FolderOpen, HardDrive, Image, LoaderCircle, Play, RefreshCw, WifiOff } from 'lucide-react';

export default function DesktopCommandCenter() {
  const bridge = typeof window === 'undefined' ? undefined : window.moeDesktop;
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [packagePreview, setPackagePreview] = useState<any>(null);
  const [pairServer, setPairServer] = useState('https://moetracker-site.pages.dev');
  const [pairCode, setPairCode] = useState('');
  const [retentionDays, setRetentionDays] = useState(30);
  const refresh = async () => bridge && setStatus(await bridge.getStatus());
  useEffect(() => { bridge?.getStatus().then(value => { setStatus(value); setRetentionDays(value.retentionDays || 30); }).catch(error => setNotice(error.message)); }, []);
  if (!bridge) return null;
  const run = async (name: string, task: () => Promise<any>) => {
    setBusy(name); setNotice('');
    try { const result = await task(); setNotice(result.message || (result.path ? `Saved to ${result.path}` : 'Done.')); await refresh(); }
    catch (error: any) { setNotice(error.message || 'Action failed.'); }
    finally { setBusy(''); }
  };
  const mb = status?.latestReplay ? Math.round(status.latestReplay.size / 1024 / 1024) : 0;
  const previewPackage = async () => { setBusy('preview'); setNotice(''); try { const result = await bridge.previewTeamPackage(); if (!result.canceled) { setPackagePreview(result.preview); const additions = (Object.values(result.preview.collections || {}) as any[]).reduce((sum: number, item: any) => sum + Number(item.additions || 0), 0) + Number(result.preview.acceptedReplays?.additions || 0); setNotice(`Preview ready: ${additions} additions, ${result.preview.conflicts?.length || 0} conflicts.`); } } catch (error: any) { setNotice(error.message || 'Preview failed.'); } finally { setBusy(''); } };
  const pair = () => run('pair', async () => { const result = await bridge.pairDevice({ server: pairServer, code: pairCode }); setPairCode(''); return { ...result, message: `Paired with ${result.server}.` }; });
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
        <button type="button" disabled={!!busy} onClick={previewPackage} className="ui-button min-h-20 flex-col text-xs disabled:opacity-60"><Download className="h-5 w-5 text-violet-300" />Import package</button>
        {packagePreview && <button type="button" disabled={!!busy} onClick={() => run('import', async () => { const result = await bridge.importTeamPackage(); setPackagePreview(null); return result; })} className="ui-button ui-button-primary min-h-20 flex-col text-xs disabled:opacity-60"><CheckCircle2 className="h-5 w-5" />Apply preview</button>}
      </div>
    </div>
    {!status?.sync?.paired && <div className="mx-4 mb-4 rounded-xl border border-violet-300/15 bg-violet-300/[0.045] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-white"><Cloud className="h-4 w-4 text-violet-300" />Pair this device</div><p className="mt-1 text-xs text-slate-400">Enter the short code created by your coach or player account. The device credential is encrypted for this Windows user.</p><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><input aria-label="Team server" className="ui-field min-h-11 px-3 text-sm" value={pairServer} onChange={event => setPairServer(event.target.value)} /><input aria-label="Pairing code" className="ui-field min-h-11 px-3 font-mono text-sm uppercase tracking-widest" maxLength={10} value={pairCode} onChange={event => setPairCode(event.target.value.toUpperCase())} placeholder="PAIRING CODE" /><button type="button" disabled={!!busy || pairCode.length !== 10} onClick={pair} className="ui-button ui-button-primary min-h-11 px-4 text-sm disabled:opacity-60">Pair</button></div></div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-3 text-[11px] text-slate-400"><label className="inline-flex items-center gap-2">Raw replay retention<input aria-label="Raw replay retention days" type="number" min={1} max={365} value={retentionDays} onChange={event => setRetentionDays(Number(event.target.value))} onBlur={() => run('retention', () => bridge.setRetentionDays(retentionDays))} className="ui-field h-9 w-20 px-2 text-center" />days</label>{status?.sync?.paired && <button type="button" disabled={!!busy} onClick={() => run('mode', () => bridge.setSyncMode(status.mode === 'connected' ? 'offline-first' : 'connected'))} className="ui-button min-h-9 px-3 text-xs">{status.mode === 'connected' ? 'Use offline mode' : 'Enable connected sync'}</button>}<button type="button" onClick={() => run('folder', bridge.chooseReplayFolder)} className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"><RefreshCw className="h-3 w-3" />Add another replay folder</button>{notice && <span className="basis-full text-cyan-100">{notice}</span>}</div>
  </section>;
}
