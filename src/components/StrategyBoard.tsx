import React, { useEffect, useRef, useState } from 'react';
import { Bomb, Copy, ImagePlus, Pencil, Plus, Save, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import type { Strat } from '../types';
import { apiFetch } from '../utils/api';
import { DrawableFrame, DrawingView } from './FrameDrawing';
import { MAX_PHASES, MAX_TOKENS, emptyBoard, mapImageKey, nextPhaseFrom, normalizeBoard, type BoardPhase, type BoardToken, type StrategyBoard as Board, type TokenKind } from '../../lib/strategyBoard';

const agentImage = (agent: string) => `/agents/${encodeURIComponent(agent.replace(/\//g, '_'))}.png`;
const TOKEN_STYLE: Record<TokenKind, string> = {
  ally: 'border-cyan-300 bg-cyan-950',
  enemy: 'border-rose-400 bg-rose-950',
  spike: 'border-amber-300 bg-amber-950',
  utility: 'border-violet-300 bg-violet-950',
};
const TOKEN_NAMES: Record<TokenKind, string> = { ally: 'Our player', enemy: 'Enemy', spike: 'Spike', utility: 'Utility' };

export function tokenLabel(token: BoardToken) {
  return token.agent || token.label || TOKEN_NAMES[token.kind];
}

function TokenMark({ token }: { token: BoardToken }) {
  return (
    <span className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 text-xs font-bold text-white shadow-lg ${TOKEN_STYLE[token.kind]}`}>
      {token.agent ? (
        <img src={agentImage(token.agent)} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : token.kind === 'spike' ? (
        <Bomb className="h-4 w-4" aria-hidden="true" />
      ) : token.kind === 'utility' ? (
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      ) : token.kind === 'enemy' ? (
        (token.label || 'E').slice(0, 2)
      ) : (
        <UserRound className="h-4 w-4" aria-hidden="true" />
      )}
    </span>
  );
}

/** Loads the coach's minimap for a map as a data: URL (the page allows data: images, not blob:). */
function useMapImage(map: string, version: number) {
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setImage(null);
    const key = mapImageKey(map);
    if (!key) return;
    apiFetch(`/api/map-images/${encodeURIComponent(key)}`)
      .then(response => (response.status === 200 ? response.blob() : null))
      .then(blob => {
        if (!blob || !live) return;
        const reader = new FileReader();
        reader.onload = () => { if (live) setImage(String(reader.result)); };
        reader.readAsDataURL(blob);
      })
      .catch(() => null);
    return () => { live = false; };
  }, [map, version]);
  return image;
}

/**
 * The plan for one strategy on the map, step by step. Tokens are dragged into
 * place; lines and arrows use the same drawing tools as video frames.
 */
export default function StrategyBoard({ strat, agents, onSave, onClose }: { key?: React.Key; strat: Strat; agents: string[]; onSave: (board: Board | null) => Promise<unknown>; onClose: () => void }) {
  const [board, setBoard] = useState<Board>(() => normalizeBoard(strat.board) || emptyBoard());
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const image = useMapImage(strat.map, imageVersion);
  const area = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<string | null>(null);
  const phase = board.phases[Math.min(phaseIndex, board.phases.length - 1)];
  const selectedToken = phase.tokens.find(token => token.id === selected) || null;

  const updatePhase = (change: (phase: BoardPhase) => BoardPhase) => {
    setBoard(current => ({ ...current, phases: current.phases.map((item, index) => (index === phaseIndex ? change(item) : item)) }));
    setDirty(true);
  };
  const addToken = (kind: TokenKind, agent?: string) => {
    if (phase.tokens.length >= MAX_TOKENS) return setNotice(`A step holds at most ${MAX_TOKENS} markers.`);
    const used = new Set(phase.tokens.map(token => token.id));
    let number = phase.tokens.length + 1;
    while (used.has(`t${number}`)) number += 1;
    // New markers start in a loose row near the middle so they do not stack exactly.
    const token: BoardToken = { id: `t${number}`, kind, x: 0.35 + (phase.tokens.length % 6) * 0.06, y: 0.5, ...(agent ? { agent } : {}) };
    updatePhase(current => ({ ...current, tokens: [...current.tokens, token] }));
    setSelected(token.id);
  };
  const moveToken = (event: React.PointerEvent) => {
    const id = dragging.current; const box = area.current?.getBoundingClientRect();
    if (!id || !box) return;
    const x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)); const y = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    updatePhase(current => ({ ...current, tokens: current.tokens.map(token => (token.id === id ? { ...token, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : token)) }));
  };
  const nudge = (token: BoardToken, dx: number, dy: number) =>
    updatePhase(current => ({ ...current, tokens: current.tokens.map(item => (item.id === token.id ? { ...item, x: Math.min(1, Math.max(0, item.x + dx)), y: Math.min(1, Math.max(0, item.y + dy)) } : item)) }));
  const removeToken = (id: string) => { updatePhase(current => ({ ...current, tokens: current.tokens.filter(token => token.id !== id) })); setSelected(null); };
  const addPhase = () => {
    if (board.phases.length >= MAX_PHASES) return;
    setBoard(current => nextPhaseFrom(current, phaseIndex));
    setPhaseIndex(phaseIndex + 1);
    setDirty(true);
  };
  const removePhase = () => {
    if (board.phases.length < 2) return;
    setBoard(current => ({ ...current, phases: current.phases.filter((_, index) => index !== phaseIndex) }));
    setPhaseIndex(Math.max(0, phaseIndex - 1));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await onSave(normalizeBoard(board));
      setDirty(false);
      setNotice('Board saved.');
    } catch (error: any) {
      setNotice(error?.message || 'The board could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const uploadImage = async (file?: File) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return setNotice('Use a minimap image under 3 MB.');
    const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
    const response = await apiFetch(`/api/map-images/${encodeURIComponent(mapImageKey(strat.map))}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: dataUrl }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setNotice(body.error || 'The image could not be saved.');
    setImageVersion(version => version + 1);
    setNotice(`Minimap saved for ${strat.map}. Every ${strat.map} strategy uses it.`);
  };

  const surface = (
    <div
      ref={area}
      className="relative aspect-square w-full select-none overflow-hidden rounded-lg border border-white/10 bg-[#0b1118]"
      onPointerMove={moveToken}
      onPointerUp={() => { dragging.current = null; }}
      onPointerLeave={() => { dragging.current = null; }}
    >
      {image ? (
        <img src={image} alt={`${strat.map} minimap`} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:10%_10%]" aria-hidden="true" />
      )}
      {phase.drawing && !drawing && <DrawingView drawing={phase.drawing} label={`Lines on ${phase.name}`} className="pointer-events-none absolute inset-0 h-full w-full" />}
      {phase.tokens.map(token => (
        <button
          key={token.id}
          type="button"
          aria-label={`${tokenLabel(token)} marker. Drag to move, or use the arrow keys.`}
          aria-pressed={selected === token.id}
          onPointerDown={event => { event.preventDefault(); dragging.current = token.id; setSelected(token.id); }}
          onKeyDown={event => {
            const step = event.shiftKey ? 0.05 : 0.01;
            const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            if (moves[event.key]) { event.preventDefault(); nudge(token, ...moves[event.key]); }
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeToken(token.id); }
          }}
          className={`absolute -translate-x-1/2 -translate-y-1/2 touch-none rounded-full ${selected === token.id ? 'ring-2 ring-white' : ''}`}
          style={{ left: `${token.x * 100}%`, top: `${token.y * 100}%` }}
        >
          <TokenMark token={token} />
        </button>
      ))}
    </div>
  );

  return (
    <section aria-labelledby="strategy-board-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="strategy-board-title" className="text-base font-semibold">
            {strat.name} · board
          </h3>
          <p className="text-xs text-slate-400">
            {strat.map} · drag markers into place, draw the lines, and add a step for what happens next.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="ui-button ui-button-primary inline-flex min-h-10 items-center gap-1.5 px-3 text-sm">
            <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save board'}
          </button>
          <button type="button" onClick={onClose} className="ui-button inline-flex min-h-10 items-center gap-1.5 px-3 text-sm">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      <div role="group" aria-label="Steps" className="flex flex-wrap items-center gap-2">
        {board.phases.map((item, index) => (
          <button key={item.id} type="button" aria-pressed={index === phaseIndex} onClick={() => { setPhaseIndex(index); setSelected(null); setDrawing(false); }} className={`ui-button min-h-9 px-3 text-xs ${index === phaseIndex ? 'ring-1 ring-cyan-300' : ''}`}>
            {index + 1}. {item.name}
          </button>
        ))}
        <button type="button" disabled={board.phases.length >= MAX_PHASES} onClick={addPhase} className="ui-button inline-flex min-h-9 items-center gap-1 px-3 text-xs">
          <Copy className="h-3.5 w-3.5" /> Next step from this one
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <DrawableFrame
            frame={surface}
            drawing={drawing}
            initial={phase.drawing}
            withNote={false}
            saveLabel="Keep these lines"
            onSave={result => { updatePhase(current => ({ ...current, drawing: result.strokes.length ? result : null })); setDrawing(false); }}
            onCancel={() => setDrawing(false)}
          />
          {!image && (
            <p className="mt-2 text-xs text-amber-200">No minimap for {strat.map} yet. Add your own minimap image below; it stays on this PC and every {strat.map} strategy uses it.</p>
          )}
        </div>
        <div className="space-y-3 text-xs">
          <label className="block text-slate-400">
            Step name
            <input value={phase.name} maxLength={40} onChange={event => updatePhase(current => ({ ...current, name: event.target.value }))} className="ui-field mt-1 min-h-9 w-full px-2 text-xs" />
          </label>
          <label className="block text-slate-400">
            Add an agent
            <select value="" onChange={event => event.target.value && addToken('ally', event.target.value)} className="ui-field mt-1 min-h-9 w-full px-2 text-xs">
              <option value="">Choose an agent</option>
              {agents.map(agent => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addToken('enemy')} className="ui-button inline-flex min-h-9 items-center gap-1 px-2 text-xs"><Plus className="h-3.5 w-3.5" /> Enemy</button>
            <button type="button" onClick={() => addToken('spike')} className="ui-button inline-flex min-h-9 items-center gap-1 px-2 text-xs"><Bomb className="h-3.5 w-3.5" /> Spike</button>
            <button type="button" onClick={() => addToken('utility')} className="ui-button inline-flex min-h-9 items-center gap-1 px-2 text-xs"><Sparkles className="h-3.5 w-3.5" /> Utility</button>
            <button type="button" disabled={drawing} onClick={() => { setSelected(null); setDrawing(true); }} className="ui-button inline-flex min-h-9 items-center gap-1 px-2 text-xs"><Pencil className="h-3.5 w-3.5" /> Draw lines</button>
          </div>
          {selectedToken && (
            <div className="space-y-2 rounded-lg border border-white/10 p-2">
              <p className="font-semibold text-slate-200">Selected: {tokenLabel(selectedToken)}</p>
              {selectedToken.kind !== 'spike' && (
                <label className="block text-slate-400">
                  Label
                  <input value={selectedToken.label || ''} maxLength={24} placeholder={selectedToken.kind === 'utility' ? 'e.g. smoke, flash' : 'e.g. lurk, anchor'} onChange={event => updatePhase(current => ({ ...current, tokens: current.tokens.map(token => (token.id === selectedToken.id ? { ...token, label: event.target.value } : token)) }))} className="ui-field mt-1 min-h-9 w-full px-2 text-xs" />
                </label>
              )}
              <button type="button" onClick={() => removeToken(selectedToken.id)} className="ui-button inline-flex min-h-9 items-center gap-1 px-2 text-xs"><Trash2 className="h-3.5 w-3.5" /> Remove marker</button>
            </div>
          )}
          <label className="block text-slate-400">
            Notes for this step
            <textarea value={phase.note} maxLength={1000} rows={4} onChange={event => updatePhase(current => ({ ...current, note: event.target.value }))} placeholder="Timing, calls, who trades whom…" className="ui-field mt-1 w-full px-2 py-1.5 text-xs" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={board.phases.length < 2} onClick={removePhase} className="ui-button inline-flex min-h-9 items-center gap-1 px-2 text-xs"><Trash2 className="h-3.5 w-3.5" /> Delete this step</button>
            <label className="ui-button inline-flex min-h-9 cursor-pointer items-center gap-1 px-2 text-xs">
              <ImagePlus className="h-3.5 w-3.5" /> {image ? 'Replace minimap' : 'Add minimap'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={event => { void uploadImage(event.target.files?.[0]); event.target.value = ''; }} />
            </label>
          </div>
          {notice && <p role="status" className="text-cyan-200">{notice}</p>}
        </div>
      </div>
    </section>
  );
}
