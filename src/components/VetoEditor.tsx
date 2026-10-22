import { Match, Veto } from '../types';
import { Save } from 'lucide-react';

interface Props {
  selectedMatch: Match;
  activeVetos: Partial<Veto>[];
  setActiveVetos: (rows: Partial<Veto>[]) => void;
  setVetoEditorOpen: (open: boolean) => void;
  handleSaveVetoSubmit: () => Promise<void>;
  maps: string[];
  vetoActions: string[];
  isLight: boolean;
  theme: any;
}

/** Match Review's map veto editor. */
export default function VetoEditor({ selectedMatch, activeVetos, setActiveVetos, setVetoEditorOpen, handleSaveVetoSubmit, maps, vetoActions, isLight, theme }: Props) {
  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className={`w-full max-w-xl p-6 rounded-2xl border ${isLight ? 'bg-white text-slate-800 border-slate-200' : 'bg-[#0f1923] text-white border-white/10'} space-y-4`}>
        <div className="flex justify-between items-center border-b border-white/10 pb-3">
          <div>
            <h4 className="text-lg font-black tracking-tight uppercase">Veto Draft log</h4>
            <p className="text-xs text-gray-400 font-mono">Vs. {selectedMatch.opponent}</p>
          </div>
          <button
            onClick={() => setVetoEditorOpen(false)}
            className="text-gray-400 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 max-h-[350px] overflow-y-auto">
          {activeVetos.map((v, index) => (
            <div key={index} className="grid grid-cols-4 gap-2 bg-black/25 p-2 rounded border border-white/5 items-center font-mono text-xs">
              <div className="text-gray-400 font-bold">Step {v.seq}</div>

              <select
                value={v.actor}
                onChange={(e) => {
                  const updated = [...activeVetos];
                  updated[index].actor = e.target.value;
                  setActiveVetos(updated);
                }}
                className="bg-black p-1 text-white rounded"
              >
                <option value="us">US (Pick/Ban)</option>
                <option value="them">OPPONENT</option>
                <option value="">DECIDER</option>
              </select>

              <select
                value={v.action}
                onChange={(e) => {
                  const updated = [...activeVetos];
                  updated[index].action = e.target.value;
                  setActiveVetos(updated);
                }}
                className="bg-black p-1 text-white rounded uppercase font-bold"
              >
                {vetoActions.map(a => <option key={a} value={a}>{a}</option>)}
              </select>

              <select
                value={v.map}
                onChange={(e) => {
                  const updated = [...activeVetos];
                  updated[index].map = e.target.value;
                  setActiveVetos(updated);
                }}
                className="bg-black p-1 text-white rounded font-bold"
              >
                <option value="">- Select Map -</option>
                {maps.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 pt-4">
          <button
            onClick={() => setVetoEditorOpen(false)}
            className="px-4 py-2 bg-slate-500/10 hover:bg-slate-500/20 text-xs font-bold rounded cursor-pointer text-gray-400 hover:text-white font-mono"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveVetoSubmit}
            className={`px-4 py-2 ${theme.primaryBg} text-xs font-bold rounded cursor-pointer text-white flex items-center gap-1 font-mono`}
          >
            <Save className="w-4 h-4" /> Save vetoes
          </button>
        </div>
      </div>
    </div>
  );
}
