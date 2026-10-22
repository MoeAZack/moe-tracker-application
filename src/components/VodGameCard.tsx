import { useState } from 'react';
import type { VodBatchGame } from '../utils/vodImportRunner';
import { vodImportStore } from '../utils/vodImportRunner';
import { saveVodGameEdit } from '../utils/vodGameEdit';

const parseScore = (value: string) => (value.trim() === '' ? null : Number(value));

// One imported game. Clicking it opens a small editor for the map, opponent
// and score; the saved match updates at once, even while the import runs on.
export default function VodGameCard({
  game,
  index,
  mapNames,
  apiFetch,
  onSaved,
}: {
  game: VodBatchGame;
  index: number;
  mapNames: string[];
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onSaved?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [map, setMap] = useState(game.map === 'Unknown map' ? '' : game.map);
  const [opponent, setOpponent] = useState('');
  const [scores, setScores] = useState(() => {
    const match = game.score.match(/^(\d+)–(\d+)$/);
    return { ours: match?.[1] || '', theirs: match?.[2] || '' };
  });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const save = async () => {
    setBusy(true);
    setNote('');
    try {
      const { patch, learned } = await saveVodGameEdit(game, { map, opponent, ourScore: parseScore(scores.ours), theirScore: parseScore(scores.theirs) }, apiFetch);
      vodImportStore.updateGame(index, patch);
      setNote(learned.length ? 'Saved. This map read is remembered for your next VOD.' : 'Saved.');
      setOpen(false);
      await onSaved?.();
    } catch (error: any) {
      setNote(error?.message || 'The correction could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const editable = !!game.matchId;
  return (
    <article className="rounded-xl border border-emerald-300/15 bg-emerald-300/5 p-3">
      <button
        type="button"
        className="w-full text-left disabled:cursor-default"
        disabled={!editable}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title={editable ? 'Correct the map, opponent or score' : undefined}
      >
        <p className="text-sm font-semibold text-emerald-200">
          Game {index + 1} · {game.map}
          {editable && <span className="ml-2 text-xs font-normal text-cyan-200 underline">{open ? 'Close' : 'Edit'}</span>}
        </p>
        <p className="mt-1 text-xs text-slate-300">
          {game.score} · {game.status}
        </p>
      </button>
      {open && (
        <div className="mt-3 grid gap-2 text-xs">
          <label className="grid gap-1">
            <span className="text-slate-300">Map</span>
            <select aria-label={`Map for game ${index + 1}`} className="rounded-md border border-white/10 bg-black/30 px-2 py-1" value={map} onChange={event => setMap(event.target.value)}>
              <option value="">Pick the map</option>
              {mapNames.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-slate-300">Opponent (optional)</span>
            <input aria-label={`Opponent for game ${index + 1}`} className="rounded-md border border-white/10 bg-black/30 px-2 py-1" value={opponent} onChange={event => setOpponent(event.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <span className="text-slate-300">Score</span>
            <input aria-label={`Our score for game ${index + 1}`} inputMode="numeric" className="w-14 rounded-md border border-white/10 bg-black/30 px-2 py-1" value={scores.ours} onChange={event => setScores(value => ({ ...value, ours: event.target.value }))} />
            <span>–</span>
            <input aria-label={`Their score for game ${index + 1}`} inputMode="numeric" className="w-14 rounded-md border border-white/10 bg-black/30 px-2 py-1" value={scores.theirs} onChange={event => setScores(value => ({ ...value, theirs: event.target.value }))} />
          </div>
          {game.status.includes('players not named') && <p className="text-slate-400">Players come from the end-of-game scoreboard; this VOD did not show one for this game.</p>}
          <button type="button" className="ui-button min-h-8 px-3 text-xs" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save correction'}
          </button>
        </div>
      )}
      {note && <p role="status" className="mt-2 text-xs text-cyan-200">{note}</p>}
    </article>
  );
}
