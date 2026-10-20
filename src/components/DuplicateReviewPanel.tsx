import { useState } from 'react';
import type { Match, TrackerData } from '../types';

interface Props {
  data: TrackerData;
  match: Match;
  isLight: boolean;
  onDecide?: (matchId: string, decision: 'keep-both' | 'discard-this') => Promise<void>;
  onOpenMatch?: (matchId: string) => void;
}

const score = (match: Match) => Number.isInteger(match.ourScore) && Number.isInteger(match.theirScore) ? `${match.ourScore}–${match.theirScore}` : '—';
const capture = (match: Match) => String((match as any).screenshotEvidence?.captureId || '').slice(0, 8) || '—';

/** Side-by-side review for a match quarantined as a second capture of a saved game. */
export default function DuplicateReviewPanel({ data, match, isLight, onDecide, onOpenMatch }: Props) {
  const [busy, setBusy] = useState(false);
  const review = match.duplicateReview;
  if (review?.status !== 'quarantined') return null;
  const candidates = review.candidateMatchIds.map(id => (data.matches || []).find(item => item.id === id)).filter((item): item is Match => !!item);
  const rows = (item: Match) => [
    ['Date', item.date || '—'], ['Map', item.map || '—'], ['Opponent', item.opponent || '—'], ['Score', score(item)],
    ['Rounds saved', String((data.rounds || []).filter(round => round.matchId === item.id).length)], ['Capture', capture(item)],
  ];
  const decide = async (decision: 'keep-both' | 'discard-this') => {
    if (decision === 'discard-this' && !confirm('Discard this copy and everything attached to it? The original match stays.')) return;
    setBusy(true);
    try { await onDecide?.(match.id, decision); } catch { /* the save handler already reported the reason */ } finally { setBusy(false); }
  };
  const columns = [{ label: 'This match', item: match }, ...candidates.map(item => ({ label: 'Already saved', item }))];
  return (
    <section role="alert" className={`rounded-xl border p-4 space-y-3 ${isLight ? 'border-amber-300 bg-amber-50 text-slate-800' : 'border-amber-400/30 bg-amber-400/[0.06]'}`}>
      <div>
        <h5 className="text-sm font-bold">Possible duplicate of a saved game</h5>
        <p className="mt-1 text-xs text-slate-400">The full scoreboard and the round-by-round kill order match a game you already saved. This match is left out of analytics until you decide.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr><th className="text-left font-semibold pr-3 py-1" scope="col">Field</th>{columns.map(({ label, item }) => <th key={item.id} className="text-left font-semibold pr-3 py-1" scope="col">{label}</th>)}</tr></thead>
          <tbody>{rows(match).map(([field], index) => <tr key={field}><th scope="row" className="text-left font-normal text-slate-400 pr-3 py-1">{field}</th>{columns.map(({ item }) => <td key={item.id} className="pr-3 py-1">{rows(item)[index][1]}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        {candidates.map(item => <button key={item.id} type="button" className="ui-button min-h-8 px-3 text-xs" onClick={() => onOpenMatch?.(item.id)}>Open saved game</button>)}
        <button type="button" disabled={busy || !onDecide} className="ui-button min-h-8 px-3 text-xs" onClick={() => decide('keep-both')}>Keep both</button>
        <button type="button" disabled={busy || !onDecide} className="ui-button min-h-8 px-3 text-xs text-rose-300" onClick={() => decide('discard-this')}>Discard this copy</button>
      </div>
    </section>
  );
}
