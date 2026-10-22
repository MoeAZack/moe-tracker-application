import { useState } from 'react';
import { TrackerData } from '../types';
import { Sparkles, Check, Loader2 } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { notify } from '../utils/appDialogs';
import { CLOUD_AI_OFF_MESSAGE, cloudAiActionBlocked, cloudAiErrorMessage, useCloudAiAvailable } from '../utils/cloudAi';
import { stratSide } from '../../lib/stratbook';

interface Props {
  data: TrackerData;
  theme: any;
  onUpsert: (sheet: string, row: any) => Promise<any>;
}

/** AI tools: draft a strategy with the cloud AI, edit it, and save it to Playbook → Strategies. */
export default function StrategyGenerator({ data, theme, onUpsert }: Props) {
  const [selectedMap, setSelectedMap] = useState(data.settings.maps[0] || 'Ascent');
  const [selectedSide, setSelectedSide] = useState('Attack');
  const [selectedStyle, setSelectedStyle] = useState('Default / General');
  const [customFocus, setCustomFocus] = useState('');
  const [generating, setGenerating] = useState(false);
  const cloudAiAvailable = useCloudAiAvailable();
  const [loadingMsg, setLoadingMsg] = useState('');
  const [generatedStrat, setGeneratedStrat] = useState<any | null>(null);
  const [savingStrat, setSavingStrat] = useState(false);

  // Editable generated fields
  const [editedName, setEditedName] = useState('');
  const [editedAgents, setEditedAgents] = useState('');
  const [editedOverview, setEditedOverview] = useState('');
  const [editedPhase1, setEditedPhase1] = useState('');
  const [editedPhase2, setEditedPhase2] = useState('');
  const [editedPhase3, setEditedPhase3] = useState('');
  const [editedCombo, setEditedCombo] = useState('');
  const [editedNotes, setEditedNotes] = useState('');

  // Loading messages rotation
  const loadingPrompts = [
    'Drawing tactical overlays...',
    'Simulating site crossfires...',
    'Analyzing choke point utility combinations...',
    'Reviewing space-creation vectors...',
    'Compiling elite playbook strategies...',
    'Running micro-scenarios through the tactician matrix...'
  ];

  const handleGenerateStrategy = async () => {
    setGenerating(true);
    setGeneratedStrat(null);
    let msgIndex = 0;
    setLoadingMsg(loadingPrompts[0]);
    const interval = setInterval(() => {
      msgIndex = (msgIndex + 1) % loadingPrompts.length;
      setLoadingMsg(loadingPrompts[msgIndex]);
    }, 1500);

    try {
      const res = await apiFetch('/api/gemini/generate-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map: selectedMap,
          side: selectedSide,
          playStyle: selectedStyle,
          customFocus: customFocus
        })
      });

      if (!res.ok) throw new Error(await cloudAiErrorMessage(res, 'The strategy generator failed. Nothing was saved.'));
      const stratData = await res.json();
      
      setGeneratedStrat(stratData);
      setEditedName(stratData.name);
      setEditedAgents(stratData.agents);
      setEditedOverview(stratData.overview);
      setEditedPhase1(stratData.phase1);
      setEditedPhase2(stratData.phase2);
      setEditedPhase3(stratData.phase3);
      setEditedCombo(stratData.combo);
      setEditedNotes(stratData.notes);
    } catch (err: any) {
      console.error(err);
      notify(err?.message || 'The strategy generator failed. Nothing was saved.', 'error');
    } finally {
      clearInterval(interval);
      setGenerating(false);
    }
  };

  const handleSaveToPlaybook = async () => {
    if (!editedName) return;
    setSavingStrat(true);
    try {
      const fullNotes = `**Agents Required:** ${editedAgents}\n\n**Concept:** ${editedOverview}\n\n**Prep Phase:** ${editedPhase1}\n\n**Execution Phase:** ${editedPhase2}\n\n**Late Round/Post-Plant:** ${editedPhase3}\n\n**Utility Combo:** ${editedCombo}\n\n**Coach Insight:** ${editedNotes}`;
      
      await onUpsert('Strats', {
        map: selectedMap,
        side: stratSide(selectedSide),
        name: editedName,
        notes: fullNotes,
        active: 'TRUE'
      });
      
      notify('Strategy saved to Playbook → Strategies.');
      setGeneratedStrat(null);
      setCustomFocus('');
    } catch (err) {
      console.error(err);
    } finally {
      setSavingStrat(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* AI Generator Settings */}
      <div className={`col-span-1 lg:col-span-4 p-6 rounded-2xl border ${theme.border} ${theme.bg} space-y-5 h-fit`}>
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <Sparkles className="w-4 h-4 text-[#ff4655]" />
          <h3 className="font-black text-xs uppercase tracking-wider text-gray-200">AI Playbook Blueprint</h3>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs uppercase font-bold tracking-wider text-gray-400 font-mono">Select Map</label>
            <select
              aria-label="Select map"
              value={selectedMap}
              onChange={(e) => setSelectedMap(e.target.value)}
              className="w-full bg-black border border-white/10 text-xs p-3 rounded-lg text-white font-mono"
            >
              {data.settings.maps.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase font-bold tracking-wider text-gray-400 font-mono">Tactical Side</label>
            <div className="grid grid-cols-2 gap-2">
              {['Attack', 'Defense'].map(side => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setSelectedSide(side)}
                  className={`py-2 px-3 border text-xs font-bold rounded-lg font-mono transition-all ${
                    selectedSide === side
                      ? 'border-[#ff4655] bg-[#ff4655]/10 text-white'
                      : 'border-white/10 bg-transparent text-gray-400 hover:text-white'
                  }`}
                >
                  {side === 'Attack' ? '🎯 Attack' : '🛡️ Defense'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase font-bold tracking-wider text-gray-400 font-mono">Tactical Style</label>
            <select
              aria-label="Tactical style"
              value={selectedStyle}
              onChange={(e) => setSelectedStyle(e.target.value)}
              className="w-full bg-black border border-white/10 text-xs p-3 rounded-lg text-white font-mono"
            >
              <option value="Default / General">Default / General</option>
              <option value="Aggressive Rush">Aggressive Rush & Site Entry</option>
              <option value="Exec & Post-plant Setup">Vaporizing Exec & Post-plant Setup</option>
              <option value="Slow Default / Map Split">Slow Map Control & Dual Split</option>
              <option value="Trap Play & Counter-Attack">Bait-and-Switch Trap / Retake Counter</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase font-bold tracking-wider text-gray-400 font-mono">Custom Focus / Directives</label>
            <textarea
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              placeholder="e.g., Run an A-Split using Cypher Cage lurk and Omen blind for space..."
              className="w-full bg-black border border-white/10 text-xs p-3 rounded-lg text-white h-20 placeholder:text-gray-600 focus:outline-none focus:border-[#ff4655]"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerateStrategy}
            disabled={cloudAiActionBlocked(cloudAiAvailable, generating)}
            aria-describedby={cloudAiAvailable === false ? 'playbook-cloud-ai-off' : undefined}
            className="w-full py-3 bg-[#d12a3a] hover:bg-[#b91c2e] text-white text-xs font-black rounded-lg font-mono tracking-wider shadow-lg shadow-[#ff4655]/10 flex items-center justify-center gap-2 disabled:opacity-40 cursor-pointer"
          >
            {generating ? (
              <>
                <Loader2 className="w-4.5 h-4.5 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4.5 h-4.5" />
                <span>Generate tactical setup</span>
              </>
            )}
          </button>
          {cloudAiAvailable === false && <p id="playbook-cloud-ai-off" className="text-xs text-gray-400">{CLOUD_AI_OFF_MESSAGE}</p>}
        </div>
      </div>

      {/* AI Output / Saved Playbook */}
      <div className="col-span-1 lg:col-span-8 space-y-6">
        {generating && (
          <div className={`p-12 rounded-2xl border border-dashed border-[#ff4655]/20 bg-[#ff4655]/5 flex flex-col items-center justify-center text-center space-y-4`}>
            <div className="w-12 h-12 rounded-full bg-[#ff4655]/10 flex items-center justify-center text-[#ff4655] animate-pulse">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div className="space-y-1">
              <h4 className="font-bold text-sm text-white font-mono uppercase tracking-wider">Scrim Engine Core Engaged</h4>
              <p className="text-xs text-gray-400 font-mono animate-pulse">{loadingMsg}</p>
            </div>
          </div>
        )}

        {generatedStrat && !generating && (
          <div className={`p-6 rounded-2xl border border-violet-500/30 bg-violet-950/10 space-y-6 animate-fadeIn`}>
            <div className="flex justify-between items-center border-b border-violet-500/20 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
                <span className="text-xs font-mono text-violet-400 uppercase tracking-widest font-bold">AI Draft Output</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setGeneratedStrat(null)}
                  className="px-3 py-1 bg-white/5 border border-white/10 hover:bg-white/10 text-gray-300 rounded text-xs font-mono font-bold"
                >
                  Dismiss
                </button>
                <button
                  onClick={handleSaveToPlaybook}
                  disabled={savingStrat}
                  className="px-3.5 py-1 bg-violet-500 hover:bg-violet-600 text-white rounded text-xs font-mono font-bold flex items-center gap-1.5"
                >
                  {savingStrat ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Add to Playbook
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">Strategy Name</label>
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white font-bold"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">Recommended Agents</label>
                <input
                  type="text"
                  value={editedAgents}
                  onChange={(e) => setEditedAgents(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">Tactical Concept</label>
              <textarea
                value={editedOverview}
                onChange={(e) => setEditedOverview(e.target.value)}
                className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-xs text-white h-16 leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs bg-white/5 text-white/70 px-1 py-0.2 rounded font-mono font-bold">1</span>
                  <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">Early Setup</label>
                </div>
                <textarea
                  value={editedPhase1}
                  onChange={(e) => setEditedPhase1(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-xs text-white h-28 leading-relaxed"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs bg-white/5 text-white/70 px-1 py-0.2 rounded font-mono font-bold">2</span>
                  <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">Execution Trigger</label>
                </div>
                <textarea
                  value={editedPhase2}
                  onChange={(e) => setEditedPhase2(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-xs text-white h-28 leading-relaxed"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs bg-white/5 text-white/70 px-1 py-0.2 rounded font-mono font-bold">3</span>
                  <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">Late Round Hold</label>
                </div>
                <textarea
                  value={editedPhase3}
                  onChange={(e) => setEditedPhase3(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2.5 rounded text-xs text-white h-28 leading-relaxed"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-violet-500/10 pt-4">
              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">⚡ Primary Utility Combo</label>
                <input
                  type="text"
                  value={editedCombo}
                  onChange={(e) => setEditedCombo(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs uppercase font-bold text-violet-400 tracking-wider font-mono">💡 Coaching Note</label>
                <input
                  type="text"
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  className="w-full bg-slate-900 border border-violet-500/25 p-2 rounded text-xs text-white italic"
                />
              </div>
            </div>
          </div>
        )}

        <div className={`p-4 rounded-2xl border ${theme.border} ${theme.bg} flex flex-wrap items-center justify-between gap-3`}>
          <p className="text-sm text-slate-300">Saved strategies, their runs and their tagged rounds live in Playbook → Strategies.</p>
          <a href="#/strategies" className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">Open strategies ({data.strats.length})</a>
        </div>
      </div>
    </div>
  );
}
