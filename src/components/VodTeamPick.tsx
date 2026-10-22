import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useVodImportState, vodImportStore } from '../utils/vodImportRunner';

// Window-wide, so the import can ask from any tab. The scoreboard does not say
// which five rows are our team, so nobody is added until the coach picks them.
export default function VodTeamPick() {
  const { teamPick } = useVodImportState();
  const knownRows = () => teamPick ? teamPick.rows.filter(row => row.known).map(row => row.index) : [];
  const [picked, setPicked] = useState<number[]>(knownRows);
  useEffect(() => { setPicked(knownRows()); }, [teamPick]);
  if (!teamPick) return null;
  const toggle = (index: number) => setPicked(current => current.includes(index) ? current.filter(item => item !== index) : current.length < 5 ? [...current, index] : current);
  const number = (input: number | null) => input ?? '–';
  return <section role="dialog" aria-labelledby="vod-team-pick-title" className="mx-auto w-full max-w-7xl rounded-xl border border-amber-300/30 bg-amber-300/[0.07] p-4 text-sm">
    <div className="flex items-start gap-3">
      <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
      <div>
        <h2 id="vod-team-pick-title" className="font-bold">Which five are your team? Game {teamPick.game} of {teamPick.totalGames} · {teamPick.map} · {teamPick.score}</h2>
        <p className="mt-1 text-xs text-slate-300">The scoreboard does not show teams, so tick your five players. Names not on your roster are added as tryouts with their stats. Players you tick once are recognised in the next games of this video.</p>
      </div>
    </div>
    <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
      {teamPick.rows.map(row => {
        const checked = picked.includes(row.index);
        return <li key={row.index}>
          <label className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border px-3 ${checked ? 'border-amber-300/40 bg-amber-300/10' : 'border-white/10'}`}>
            <input type="checkbox" checked={checked} disabled={!checked && picked.length >= 5} onChange={() => toggle(row.index)} />
            <span className="min-w-0 flex-1 truncate font-semibold">{row.name}</span>
            <span className="shrink-0 font-mono text-xs text-slate-400">{row.agent ? `${row.agent} · ` : ''}{number(row.kills)}/{number(row.deaths)}/{number(row.assists)}</span>
            {row.known && <span className="shrink-0 text-xs text-emerald-300">on roster</span>}
          </label>
        </li>;
      })}
    </ul>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button type="button" className="ui-button ui-button-primary min-h-9 px-4 text-xs disabled:opacity-50" disabled={picked.length !== 5} onClick={() => vodImportStore.answerTeamPick(picked)}>These are our five ({picked.length}/5)</button>
      <button type="button" className="ui-button min-h-9 px-4 text-xs" onClick={() => vodImportStore.answerTeamPick(null)}>Save this game without names</button>
    </div>
  </section>;
}
