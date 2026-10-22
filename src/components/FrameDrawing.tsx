import React, { useEffect, useRef, useState } from 'react';
import { MoveUpRight, Pencil, Trash2, Undo2 } from 'lucide-react';
import { DRAW_COLORS, MAX_POINTS, MAX_STROKES, arrowHeadPath, normalizeDrawing, strokePath, type DrawColor, type DrawTool, type DrawingStroke, type FrameDrawing, type Point } from '../../lib/frameDrawing';

const COLOR_NAMES: Record<DrawColor, string> = { '#ff4655': 'Red', '#22d3ee': 'Cyan', '#facc15': 'Yellow', '#ffffff': 'White' };

function Strokes({ strokes }: { strokes: DrawingStroke[] }) {
  return (
    <>
      {strokes.map((stroke, index) => (
        <g key={index} stroke={stroke.color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d={strokePath(stroke.points)} vectorEffect="non-scaling-stroke" />
          {stroke.tool === 'arrow' && <path d={arrowHeadPath(stroke.points[0], stroke.points[stroke.points.length - 1])} vectorEffect="non-scaling-stroke" />}
        </g>
      ))}
    </>
  );
}

/** A saved drawing laid over a frame, or shown on its own as a thumbnail. */
export function DrawingView({ drawing, label, className = '' }: { drawing: FrameDrawing; label: string; className?: string }) {
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label={label} className={className}>
      <Strokes strokes={drawing.strokes} />
    </svg>
  );
}

/**
 * A frame with a drawing layer. The frame element stays in the same place in
 * the tree whether or not the coach is drawing, so a playing video is never
 * reloaded by opening or closing the tools.
 */
export function DrawableFrame({ frame, drawing, shown, initial, withNote = true, onSave, onCancel, saveLabel, disabledReason }: { frame: React.ReactNode; drawing: boolean; initial?: FrameDrawing | null; withNote?: boolean; shown?: { drawing: FrameDrawing; label: string } | null; onSave: (drawing: FrameDrawing, text: string) => void; onCancel: () => void; saveLabel: string; disabledReason?: string }) {
  const [strokes, setStrokes] = useState<DrawingStroke[]>([]);
  const [tool, setTool] = useState<DrawTool>('arrow');
  const [color, setColor] = useState<DrawColor>('#ff4655');
  const [text, setText] = useState('');
  const current = useRef<DrawingStroke | null>(null);
  const [, redraw] = useState(0);
  const pointFrom = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))];
  };
  const start = (event: React.PointerEvent<SVGSVGElement>) => {
    if (strokes.length >= MAX_STROKES) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = pointFrom(event);
    current.current = { tool, color, points: [point, point] };
    redraw(value => value + 1);
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const stroke = current.current;
    if (!stroke) return;
    const point = pointFrom(event);
    if (stroke.tool === 'arrow') stroke.points = [stroke.points[0], point];
    else if (stroke.points.length < MAX_POINTS) stroke.points = [...stroke.points, point];
    redraw(value => value + 1);
  };
  const end = () => {
    const stroke = current.current;
    current.current = null;
    if (!stroke) return;
    const cleaned = normalizeDrawing({ strokes: [stroke] });
    if (cleaned) setStrokes(existing => [...existing, cleaned.strokes[0]]);
    redraw(value => value + 1);
  };
  // Each drawing session starts clean, whether it ended by saving or by Done.
  useEffect(() => { setStrokes(drawing && initial ? initial.strokes : []); setText(''); current.current = null; }, [drawing]);
  const shownStrokes = current.current ? [...strokes, current.current] : strokes;
  const result = normalizeDrawing({ strokes });
  return (
    <>
      <div className="relative">
        {frame}
        {drawing ? (
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
            role="img"
            aria-label="Drawing area over the paused frame"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none rounded-lg ring-2 ring-cyan-300/60"
          >
            <Strokes strokes={shownStrokes} />
          </svg>
        ) : (
          shown && <DrawingView drawing={shown.drawing} label={shown.label} className="pointer-events-none absolute inset-0 h-full w-full" />
        )}
      </div>
      {drawing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" role="toolbar" aria-label="Drawing tools">
          <button type="button" aria-pressed={tool === 'arrow'} onClick={() => setTool('arrow')} className={`ui-button inline-flex min-h-8 items-center gap-1 px-2 text-xs ${tool === 'arrow' ? 'ring-1 ring-cyan-300' : ''}`}>
            <MoveUpRight className="h-3.5 w-3.5" /> Arrow
          </button>
          <button type="button" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} className={`ui-button inline-flex min-h-8 items-center gap-1 px-2 text-xs ${tool === 'pen' ? 'ring-1 ring-cyan-300' : ''}`}>
            <Pencil className="h-3.5 w-3.5" /> Line
          </button>
          {DRAW_COLORS.map(option => (
            <button
              key={option}
              type="button"
              aria-label={`${COLOR_NAMES[option]} pen`}
              aria-pressed={color === option}
              onClick={() => setColor(option)}
              className={`h-8 w-8 rounded-full border-2 ${color === option ? 'border-white' : 'border-white/20'}`}
              style={{ backgroundColor: option }}
            />
          ))}
          <button type="button" disabled={!strokes.length} onClick={() => setStrokes(existing => existing.slice(0, -1))} className="ui-button inline-flex min-h-8 items-center gap-1 px-2 text-xs">
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button type="button" disabled={!strokes.length} onClick={() => setStrokes([])} className="ui-button inline-flex min-h-8 items-center gap-1 px-2 text-xs">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
          {withNote && <input aria-label="Note for this drawing" value={text} maxLength={500} onChange={event => setText(event.target.value)} placeholder="What should they see here?" className="ui-field min-h-8 min-w-[10rem] flex-1 px-2 text-xs" />}
          <button type="button" disabled={(!result && !initial) || !!disabledReason} onClick={() => (result || initial) && onSave(result || { ...initial!, strokes: [] }, text.trim())} className="ui-button ui-button-primary min-h-8 px-3 text-xs">
            {saveLabel}
          </button>
          <button type="button" onClick={onCancel} className="ui-button min-h-8 px-3 text-xs">
            Done
          </button>
          {disabledReason && <p className="w-full text-amber-200">{disabledReason}</p>}
        </div>
      )}
    </>
  );
}
