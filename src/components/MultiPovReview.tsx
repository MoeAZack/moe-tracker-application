import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Pause, Play, Plus, RotateCcw, RotateCw, Save, SplitSquareHorizontal, Volume2, X } from 'lucide-react';
import type { VodReview as VodReviewRecord } from '../types';
import { MAX_POVS, alignForRound, driftCorrections, formatClock, formatOffset, matchPovs, matchTimeFor, offsetToAlign, videoTimeFor, type Pov } from '../../lib/multiPov';
import { videoElementPlayer, youtubeEmbedUrl, youtubePlayer, type PovPlayer } from '../utils/povPlayers';

type Props = {
  key?: React.Key;
  reviews: VodReviewRecord[];
  matchId: string;
  /** Round numbers known for this match, for the round picker. */
  rounds: number[];
  selectedRoundNo?: number | null;
  onRoundChange?: (roundNo: number) => void;
  onSaveOffset: (reviewId: string, vodUrl: string, offset: number) => Promise<boolean>;
  defaultOpen?: boolean;
};

const TICK_MS = 1000;

function PovTile({ pov, startAt, main, sound, onPlayer }: { pov: Pov; startAt: number; main: boolean; sound: boolean; onPlayer: (id: string, player: PovPlayer | null) => void }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerRef = useRef<(PovPlayer & { listen?: () => void }) | null>(null);
  // The embed URL is fixed when the tile mounts; later moves go through seek, not a reload.
  const [src] = useState(() => (pov.kind === 'youtube' && pov.videoId ? youtubeEmbedUrl(pov.videoId, startAt, typeof window === 'undefined' ? '' : window.location.origin) : pov.vodUrl));
  useEffect(() => {
    const player = pov.kind === 'youtube' && frameRef.current ? youtubePlayer(frameRef.current) : pov.kind === 'local' && videoRef.current ? videoElementPlayer(videoRef.current) : null;
    playerRef.current = player;
    if (player && pov.kind === 'local') player.seek(startAt);
    onPlayer(pov.id, player);
    return () => { player?.dispose(); onPlayer(pov.id, null); };
  }, [pov.id]);
  useEffect(() => { playerRef.current?.setMuted(!sound); }, [sound]);
  const title = `${pov.title}${main ? ' (main view)' : ''}`;
  if (pov.kind === 'youtube')
    return (
      <iframe
        ref={frameRef}
        title={title}
        src={src}
        onLoad={() => { playerRef.current?.listen?.(); playerRef.current?.setMuted(!sound); }}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-video w-full rounded-lg border-0 bg-black"
      />
    );
  if (pov.kind === 'local') return <video ref={videoRef} src={src} title={title} controls={main} muted={!sound} playsInline className="aspect-video w-full rounded-lg bg-black" />;
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/40 p-4 text-center text-xs text-slate-300">
      <p>This link cannot play inside the app. Only YouTube links and videos on this PC can be synced.</p>
      <a href={pov.vodUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan-300 hover:underline">
        Open the video <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

/**
 * Several videos of one match side by side on one clock. The first chosen view
 * is the main view: play, pause and scrub it (or use the buttons), and the
 * others follow. Round jumps use each video's own round anchor when it has one.
 */
export default function MultiPovReview({ reviews, matchId, rounds, selectedRoundNo, onRoundChange, onSaveOffset, defaultOpen = false }: Props) {
  const saved = useMemo(() => matchPovs(reviews, matchId), [reviews, matchId]);
  const [open, setOpen] = useState(defaultOpen);
  const [localPovs, setLocalPovs] = useState<Pov[]>([]);
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const [chosen, setChosen] = useState<string[]>(() => saved.filter(pov => pov.kind !== 'link').slice(0, 4).map(pov => pov.id));
  const [soundId, setSoundId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [roundNo, setRoundNo] = useState(selectedRoundNo ? String(selectedRoundNo) : '');
  const players = useRef<Record<string, PovPlayer | null>>({});
  const lastMainTime = useRef<number | null>(null);
  const stillTicks = useRef(0);
  // Videos buffer for a moment after play or a seek; don't read that as the coach pausing.
  const settleUntil = useRef(0);
  const settle = () => { settleUntil.current = Date.now() + 2500; stillTicks.current = 0; };

  const all = useMemo(() => [...saved, ...localPovs].map(pov => (offsets[pov.id] === undefined ? pov : { ...pov, offset: offsets[pov.id] })), [saved, localPovs, offsets]);
  const onScreen = useMemo(() => chosen.map(id => all.find(pov => pov.id === id)).filter((pov): pov is Pov => !!pov), [chosen, all]);
  const synced = onScreen.filter(pov => pov.kind !== 'link');
  const main = synced[0] || null;
  const sound = soundId && synced.some(pov => pov.id === soundId) ? soundId : main?.id || null;
  const knownRounds = useMemo(() => [...new Set([...rounds, ...all.flatMap(pov => Object.keys(pov.anchors).map(Number))])].filter(Boolean).sort((a, b) => a - b), [rounds, all]);

  useEffect(() => { setChosen(current => current.length ? current : saved.filter(pov => pov.kind !== 'link').slice(0, 4).map(pov => pov.id)); }, [saved]);
  useEffect(() => { if (selectedRoundNo) setRoundNo(String(selectedRoundNo)); }, [selectedRoundNo]);
  // Local videos live only in this window; let the browser free them when the panel goes away.
  const localUrls = useRef<string[]>([]);
  useEffect(() => () => { localUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  const each = (action: (player: PovPlayer, pov: Pov) => void) => { for (const pov of synced) { const player = players.current[pov.id]; if (player) action(player, pov); } };
  const positions = () => Object.fromEntries(synced.map(pov => [pov.id, players.current[pov.id]?.time() ?? null]));
  const mainMatchTime = () => { const time = main ? players.current[main.id]?.time() : null; return main && typeof time === 'number' ? matchTimeFor(main, time) : null; };

  // Followers track the main view. Pausing or playing the main view with its own controls carries the others with it.
  useEffect(() => {
    if (!open || !main) return;
    const timer = window.setInterval(() => {
      const mainTime = players.current[main.id]?.time() ?? null;
      if (mainTime === null) return;
      const step = lastMainTime.current === null ? null : mainTime - lastMainTime.current;
      lastMainTime.current = mainTime;
      setClock(matchTimeFor(main, mainTime));
      const settling = Date.now() < settleUntil.current;
      stillTicks.current = step !== null && Math.abs(step) <= 0.2 ? stillTicks.current + 1 : 0;
      if (!settling && step !== null && step > 0.2 && step < 2.5 && !playing) { setPlaying(true); each((player, pov) => { if (pov.id !== main.id) player.play(); }); }
      else if (!settling && stillTicks.current >= 2 && playing) { setPlaying(false); each((player, pov) => { if (pov.id !== main.id) player.pause(); }); }
      for (const correction of driftCorrections(synced, positions(), main.id)) players.current[correction.id]?.seek(correction.seekTo);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [open, main?.id, main?.offset, playing, synced.map(pov => `${pov.id}:${pov.offset}`).join('|')]);

  const playAll = () => { settle(); each(player => player.play()); setPlaying(true); };
  const pauseAll = () => { settle(); each(player => player.pause()); setPlaying(false); };
  const nudge = (seconds: number) => {
    const matchTime = mainMatchTime();
    if (matchTime === null) return setMessage('The main view has not loaded yet.');
    settle();
    each((player, pov) => player.seek(videoTimeFor(pov, matchTime + seconds)));
  };
  const jumpToRound = (value: string) => {
    setRoundNo(value);
    const round = Number(value);
    if (!round || !main) return;
    const aligned = alignForRound(synced, round, main.id);
    if (!aligned) return setMessage(`No video has round ${round} marked yet. Add a VOD note for round ${round} with its timestamp, or line the views up and use the clock.`);
    setOffsets(current => ({ ...current, ...aligned.offsets }));
    settle();
    each((player, pov) => player.seek(aligned.targets[pov.id]));
    setMessage('');
    onRoundChange?.(round);
  };
  const syncHere = (pov: Pov) => {
    const matchTime = mainMatchTime(); const time = players.current[pov.id]?.time();
    if (matchTime === null || typeof time !== 'number') return setMessage('Both videos need to be loaded before they can be lined up.');
    setOffsets(current => ({ ...current, [pov.id]: offsetToAlign(time, matchTime) }));
    setMessage(`${pov.title} now follows the main view from this moment.`);
  };
  const saveOffset = async (pov: Pov) => {
    if (!pov.reviewId) return;
    if (await onSaveOffset(pov.reviewId, pov.vodUrl, pov.offset)) setMessage(`Saved the sync for ${pov.title}.`);
  };
  const toggle = (id: string) => setChosen(current => (current.includes(id) ? current.filter(item => item !== id) : current.length < MAX_POVS ? [...current, id] : current));
  const makeMain = (id: string) => setChosen(current => [id, ...current.filter(item => item !== id)]);
  const addLocal = (files: FileList | null) => {
    const picked = [...(files || [])].slice(0, MAX_POVS);
    if (!picked.length) return;
    const added = picked.map((file, index) => {
      const url = URL.createObjectURL(file); localUrls.current.push(url);
      return { id: `local:${Date.now()}-${index}`, title: file.name, kind: 'local' as const, videoId: null, reviewId: null, vodUrl: url, offset: 0, anchors: {} };
    });
    setLocalPovs(current => [...current, ...added]);
    setChosen(current => [...current, ...added.map(pov => pov.id)].slice(0, MAX_POVS));
  };
  const removeLocal = (pov: Pov) => {
    URL.revokeObjectURL(pov.vodUrl); localUrls.current = localUrls.current.filter(url => url !== pov.vodUrl);
    setLocalPovs(current => current.filter(item => item.id !== pov.id)); setChosen(current => current.filter(id => id !== pov.id));
  };
  const savedOffset = (pov: Pov) => saved.find(item => item.id === pov.id)?.offset;
  const startFor = (pov: Pov) => { const matchTime = mainMatchTime(); return matchTime === null ? pov.offset : videoTimeFor(pov, matchTime); };

  if (!open)
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.025] p-4" aria-labelledby="multi-pov-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="multi-pov-title" className="text-base font-semibold">Watch POVs together</h3>
            <p className="mt-1 text-xs text-gray-400">
              {saved.length ? `${saved.length} video${saved.length === 1 ? '' : 's'} linked to this match.` : 'No video is linked to this match yet.'} Play up to {MAX_POVS} views side by side on one clock, and jump them all to a round.
            </p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="ui-button inline-flex items-center gap-1.5 min-h-10 px-4 text-sm">
            <SplitSquareHorizontal className="h-4 w-4" /> Open side-by-side review
          </button>
        </div>
      </section>
    );

  return (
    <section className="rounded-xl border border-cyan-300/15 bg-white/[0.025] p-4 space-y-4" aria-labelledby="multi-pov-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="multi-pov-title" className="text-base font-semibold">Watch POVs together</h3>
          <p className="mt-1 text-xs text-gray-400">The first view is the main view. Play, pause or scrub it and the others follow.</p>
        </div>
        <button type="button" onClick={() => { pauseAll(); setOpen(false); }} className="ui-button inline-flex items-center gap-1.5 min-h-10 px-3 text-sm">
          <X className="h-4 w-4" /> Close
        </button>
      </div>

      <fieldset>
        <legend className="text-xs font-semibold text-gray-400">Views on screen ({synced.length}/{MAX_POVS})</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {all.map(pov => (
            <label key={pov.id} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 text-xs">
              <input type="checkbox" checked={chosen.includes(pov.id)} disabled={!chosen.includes(pov.id) && chosen.length >= MAX_POVS} onChange={() => toggle(pov.id)} />
              <span className="max-w-[16rem] truncate">{pov.title}</span>
              {pov.kind === 'local' && <span className="text-gray-500">on this PC</span>}
              {pov.kind === 'link' && <span className="text-gray-500">link only</span>}
            </label>
          ))}
          <label className="ui-button inline-flex items-center gap-1.5 min-h-10 cursor-pointer px-3 text-xs">
            <Plus className="h-4 w-4" /> Add videos from this PC
            <input type="file" accept="video/*" multiple className="sr-only" onChange={event => { addLocal(event.target.files); event.target.value = ''; }} />
          </label>
        </div>
      </fieldset>

      {synced.length > 0 && (
        <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Playback for every view">
          <button type="button" onClick={playing ? pauseAll : playAll} className="ui-button inline-flex items-center gap-1.5 ui-button-primary min-h-10 px-4 text-sm">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {playing ? 'Pause all' : 'Play all'}
          </button>
          <button type="button" onClick={() => nudge(-10)} className="ui-button inline-flex items-center gap-1.5 min-h-10 px-3 text-sm" aria-label="Back 10 seconds">
            <RotateCcw className="h-4 w-4" /> 10s
          </button>
          <button type="button" onClick={() => nudge(10)} className="ui-button inline-flex items-center gap-1.5 min-h-10 px-3 text-sm" aria-label="Forward 10 seconds">
            <RotateCw className="h-4 w-4" /> 10s
          </button>
          <label className="text-xs text-gray-400">
            Jump to round
            <select value={roundNo} onChange={event => jumpToRound(event.target.value)} className="ui-field mt-1 block min-h-10 px-3 text-sm">
              <option value="">Choose a round</option>
              {knownRounds.map(round => (
                <option key={round} value={round}>
                  Round {round}
                  {synced.some(pov => pov.anchors[round] !== undefined) ? '' : ' (not marked)'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Sound from
            <select value={sound || ''} onChange={event => setSoundId(event.target.value)} className="ui-field mt-1 block min-h-10 px-3 text-sm">
              {synced.map(pov => (
                <option key={pov.id} value={pov.id}>
                  {pov.title}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-sm tabular-nums text-gray-300" aria-live="off">
            Match clock {clock === null ? '–' : formatClock(clock)}
          </span>
        </div>
      )}
      {message && <p role="status" className="text-xs text-amber-200">{message}</p>}

      {onScreen.length === 0 ? (
        <p className="text-xs text-gray-400">Choose at least one view, or add videos from this PC.</p>
      ) : (
        <div className={`grid gap-3 ${onScreen.length > 1 ? 'md:grid-cols-2' : ''} ${onScreen.length > 4 ? 'xl:grid-cols-3' : ''}`}>
          {onScreen.map(pov => {
            const isMain = pov.id === main?.id;
            const changed = pov.reviewId && savedOffset(pov) !== pov.offset;
            return (
              <article key={pov.id} className={`rounded-xl border p-2 ${isMain ? 'border-cyan-300/30' : 'border-white/10'}`}>
                <PovTile pov={pov} startAt={startFor(pov)} main={isMain} sound={pov.id === sound} onPlayer={(id, player) => { players.current[id] = player; }} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-semibold" title={pov.title}>
                    {pov.title}
                  </span>
                  {pov.id === sound && <Volume2 className="h-3.5 w-3.5 text-cyan-200" aria-label="Sound on" />}
                  {pov.kind !== 'link' && <span className="tabular-nums text-gray-400">Match start {formatOffset(pov.offset)}</span>}
                  {isMain ? (
                    <span className="rounded-full border border-cyan-300/30 px-2 py-0.5 text-cyan-200">Main view</span>
                  ) : pov.kind !== 'link' ? (
                    <>
                      <button type="button" onClick={() => syncHere(pov)} className="ui-button inline-flex items-center gap-1.5 min-h-8 px-2 text-xs">
                        Line up with main view here
                      </button>
                      <button type="button" onClick={() => makeMain(pov.id)} className="ui-button inline-flex items-center gap-1.5 min-h-8 px-2 text-xs">
                        Make main
                      </button>
                    </>
                  ) : null}
                  {changed && (
                    <button type="button" onClick={() => void saveOffset(pov)} className="ui-button inline-flex items-center gap-1.5 min-h-8 px-2 text-xs">
                      <Save className="h-3.5 w-3.5" /> Save sync
                    </button>
                  )}
                  {pov.kind === 'local' && (
                    <button type="button" onClick={() => removeLocal(pov)} className="ui-button inline-flex items-center gap-1.5 min-h-8 px-2 text-xs" aria-label={`Remove ${pov.title}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
