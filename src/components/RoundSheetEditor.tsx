import { roundFlag } from '../utils/roundFlag';
import { Match, Round, TrackerData } from '../types';
import { Save } from 'lucide-react';

interface Props {
  selectedMatch: Match;
  activeRounds: Partial<Round>[];
  setActiveRounds: (rows: Partial<Round>[]) => void;
  setRoundEditorOpen: (open: boolean) => void;
  handleSaveRounds: () => Promise<void>;
  data: TrackerData;
  players: string[];
  buyTypes: string[];
  winReasons: string[];
  sites: string[];
  isLight: boolean;
  theme: any;
}

/** Match Review's round-by-round sheet editor. */
export default function RoundSheetEditor({ selectedMatch, activeRounds, setActiveRounds, setRoundEditorOpen, handleSaveRounds, data, players, buyTypes, winReasons, sites, isLight, theme }: Props) {
  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className={`w-full max-w-6xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4 max-h-[90vh] overflow-y-auto`}>
        <div className="flex justify-between items-center border-b border-white/10 pb-3">
          <div>
            <h4 className="text-lg font-black tracking-tight uppercase">Round Log Sheets</h4>
            <p className="text-xs text-gray-400 font-mono">Vs. {selectedMatch.opponent} on {selectedMatch.map}</p>
          </div>
          <button
            onClick={() => setRoundEditorOpen(false)}
            className="text-gray-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>

        {/* Scrollable table grid */}
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto pr-1">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-white/10 text-gray-500 uppercase font-bold sticky top-0 bg-[#0f1923] z-10">
                <th className="py-2 px-1">Round</th>
                <th className="py-2 px-1">Side</th>
                <th className="py-2 px-1">Buy</th>
                <th className="py-2 px-1">Enemy Buy</th>
                <th className="py-2 px-1 text-center">Result</th>
                <th className="py-2 px-1">Win/Loss Reason</th>
                <th className="py-2 px-1 text-center">Planted</th>
                <th className="py-2 px-1 text-center">Site</th>
                <th className="py-2 px-1 text-center text-[#ff4655]">Throw?</th>
                <th className="py-2 px-1 text-gray-300">Overpeeker / Throwers</th>
                <th className="py-2 px-1 text-gray-300">Error Reason</th>
                <th className="py-2 px-1 text-gray-300">Strategies Run</th>
                <th className="py-2 px-2">Round Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {activeRounds.map((r, index) => (
                <tr key={index} className="hover:bg-white/5">
                  <td className="py-2 px-1 font-bold text-gray-400 text-xs">#{r.roundNo}</td>
                  <td className="py-1 px-1">
                    <select
                      value={r.side}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].side = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white"
                    >
                      <option value="">Unknown</option>
                      <option value="Attack">Attack</option>
                      <option value="Defense">Defense</option>
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <select
                      value={r.buy}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].buy = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white"
                    >
                      <option value="">Unknown</option>
                      {buyTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <select
                      value={r.enemyBuy}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].enemyBuy = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white"
                    >
                      <option value="">Unknown</option>
                      {buyTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <select
                      value={r.result}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].result = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className={`bg-black text-xs font-black p-1 rounded ${r.result === 'W' ? 'text-emerald-400' : r.result === 'L' ? 'text-rose-400' : 'text-gray-400'}`}
                    >
                      <option value="">Unknown</option>
                      <option value="W">W</option>
                      <option value="L">L</option>
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <select
                      value={r.winBy}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].winBy = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white"
                    >
                      <option value="">Unknown</option>
                      {winReasons.map(rs => <option key={rs} value={rs}>{rs}</option>)}
                    </select>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <select
                      aria-label={`Round ${r.roundNo} plant status`}
                      value={roundFlag(r.plant) === true ? 'TRUE' : roundFlag(r.plant) === false ? 'FALSE' : ''}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].plant = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white"
                    >
                      <option value="">Unknown</option>
                      <option value="TRUE">Yes</option>
                      <option value="FALSE">No</option>
                    </select>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <select
                      value={r.site}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].site = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white font-bold"
                    >
                      <option value="">Unknown</option>
                      {sites.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="py-1 px-1 text-center">
                    <select
                      aria-label={`Round ${r.roundNo} discipline status`}
                      value={roundFlag(r.isThrow) === true ? 'TRUE' : roundFlag(r.isThrow) === false ? 'FALSE' : ''}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].isThrow = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white"
                    >
                      <option value="">Unknown</option>
                      <option value="FALSE">Clean</option>
                      <option value="TRUE">Throw</option>
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <div className="relative group">
                      <input
                        type="text"
                        value={r.thrownBy || ''}
                        onChange={(e) => {
                          const updated = [...activeRounds];
                          updated[index].thrownBy = e.target.value;
                          setActiveRounds(updated);
                        }}
                        placeholder="Select/type..."
                        className="bg-black text-xs p-1 rounded text-white w-[100px] border border-white/10"
                      />
                      <div className="hidden group-hover:block hover:block absolute left-0 bottom-full bg-slate-900 border border-slate-700 p-2.5 rounded shadow-xl z-50 space-y-1.5 w-[140px]">
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Quick Select</p>
                        {players.map(p => {
                          const currentList = r.thrownBy ? r.thrownBy.split(', ').filter(Boolean) : [];
                          const isChecked = currentList.includes(p);
                          return (
                            <label key={p} className="flex items-center gap-1.5 cursor-pointer text-xs text-white hover:text-rose-400">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  let newList;
                                  if (isChecked) {
                                    newList = currentList.filter(x => x !== p);
                                  } else {
                                    newList = [...currentList, p];
                                  }
                                  const updated = [...activeRounds];
                                  updated[index].thrownBy = newList.join(', ');
                                  setActiveRounds(updated);
                                }}
                                className="rounded accent-rose-500 scale-90"
                              />
                              <span>{p}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </td>
                  <td className="py-1 px-1">
                    <select
                      value={r.throwReason || ''}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].throwReason = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="bg-black text-xs p-1 rounded text-white max-w-[120px]"
                    >
                      <option value="">-</option>
                      <option value="Overpeeking">Overpeeking</option>
                      <option value="Failed Clutch">Failed Clutch</option>
                      <option value="Failed Post-plant">Failed Post-plant</option>
                      <option value="C9 / Time Defuse">C9 / Time Defuse</option>
                      <option value="Lost Advantage">Lost Advantage</option>
                      <option value="Poor Eco Buy">Poor Eco Buy</option>
                      <option value="Missed Utility">Missed Utility</option>
                      <option value="Failed Retake">Failed Retake</option>
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <div className="relative group">
                      <input
                        type="text"
                        value={r.strategies || ''}
                        onChange={(e) => {
                          const updated = [...activeRounds];
                          updated[index].strategies = e.target.value;
                          setActiveRounds(updated);
                        }}
                        placeholder="No strat..."
                        className="bg-black text-xs p-1 rounded text-white w-[110px] border border-white/10"
                      />
                      <div className="hidden group-hover:block hover:block absolute right-0 bottom-full bg-slate-900 border border-slate-700 p-2.5 rounded shadow-xl z-50 space-y-1.5 w-[160px] max-h-[160px] overflow-y-auto">
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Map Strategies</p>
                        {((data.strats || []).filter(s => s.map === selectedMatch.map)).map(st => {
                          const currentList = r.strategies ? r.strategies.split(', ').filter(Boolean) : [];
                          const isChecked = currentList.includes(st.name);
                          return (
                            <label key={st.id} className="flex items-start gap-1.5 cursor-pointer text-xs text-white hover:text-violet-400">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  let newList;
                                  if (isChecked) {
                                    newList = currentList.filter(x => x !== st.name);
                                  } else {
                                    newList = [...currentList, st.name];
                                  }
                                  const updated = [...activeRounds];
                                  updated[index].strategies = newList.join(', ');
                                  setActiveRounds(updated);
                                }}
                                className="rounded accent-violet-500 scale-90 mt-0.5"
                              />
                              <span className="leading-tight">{st.name} ({st.side})</span>
                            </label>
                          );
                        })}
                        {((data.strats || []).filter(s => s.map === selectedMatch.map)).length === 0 && (
                          <p className="text-xs text-gray-500 italic">No strategies defined for {selectedMatch.map}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      placeholder="Quick note"
                      value={r.notes || ''}
                      onChange={(e) => {
                        const updated = [...activeRounds];
                        updated[index].notes = e.target.value;
                        setActiveRounds(updated);
                      }}
                      className="w-full bg-black/40 border border-white/5 rounded p-1 text-white text-xs"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center border-t border-white/10 pt-4">
          <span className="text-xs text-gray-500 font-mono">Unused or blank result rows will be discarded on save.</span>
          <div className="flex gap-2">
            <button
              onClick={() => setRoundEditorOpen(false)}
              className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveRounds}
              className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white flex items-center gap-1 font-mono`}
            >
              <Save className="w-4 h-4" /> Save rounds
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
