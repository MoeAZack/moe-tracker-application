// Drawings a coach makes over a paused video frame: arrows and free lines,
// kept as small vectors on a VOD note (never a picture of the frame, so a
// YouTube frame needs no capture and the database stays small).
//
// Points are fractions of the frame (0–1 on both axes), so a drawing lines up
// at any player size.

export const DRAWING_SCHEMA = 'moetracker.frame-drawing/v1' as const;
export const DRAW_COLORS = ['#ff4655', '#22d3ee', '#facc15', '#ffffff'] as const;
export const DRAW_TOOLS = ['pen', 'arrow'] as const;
export const MAX_STROKES = 40;
export const MAX_POINTS = 300;

export type DrawColor = (typeof DRAW_COLORS)[number];
export type DrawTool = (typeof DRAW_TOOLS)[number];
export type Point = [number, number];
export type DrawingStroke = { tool: DrawTool; color: DrawColor; points: Point[] };
export type FrameDrawing = { schema: typeof DRAWING_SCHEMA; strokes: DrawingStroke[] };

const unit = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000 : null);

/** Drops points closer than `minDistance` to the last kept one; always keeps the last point. */
export function simplifyPoints(points: Point[], minDistance = 0.004): Point[] {
  if (points.length < 3) return points;
  const kept: Point[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const [x, y] = points[index]; const [lastX, lastY] = kept[kept.length - 1];
    if (Math.hypot(x - lastX, y - lastY) >= minDistance) kept.push(points[index]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/** The stored form of a drawing, or null when nothing usable was drawn. Anything malformed is dropped, not repaired into something else. */
export function normalizeDrawing(input: unknown): FrameDrawing | null {
  const strokes = (input as any)?.strokes;
  if (!Array.isArray(strokes)) return null;
  const clean: DrawingStroke[] = [];
  for (const stroke of strokes.slice(0, MAX_STROKES)) {
    if (!(DRAW_TOOLS as readonly unknown[]).includes(stroke?.tool) || !(DRAW_COLORS as readonly unknown[]).includes(stroke?.color) || !Array.isArray(stroke?.points)) continue;
    const points = stroke.points.map((point: unknown) => (Array.isArray(point) ? [unit(point[0]), unit(point[1])] : [null, null])).filter((point: (number | null)[]): point is Point => point[0] !== null && point[1] !== null);
    // An arrow is its start and end; a line needs at least two points to show.
    const kept = stroke.tool === 'arrow' ? (points.length >= 2 ? [points[0], points[points.length - 1]] : []) : simplifyPoints(points).slice(0, MAX_POINTS);
    if (kept.length >= 2) clean.push({ tool: stroke.tool, color: stroke.color, points: kept });
  }
  return clean.length ? { schema: DRAWING_SCHEMA, strokes: clean } : null;
}

/** SVG path in a 1000×1000 box (the overlay stretches it over the frame). */
export function strokePath(points: Point[]): string {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${Math.round(x * 1000)} ${Math.round(y * 1000)}`).join(' ');
}

/** The two short lines of an arrowhead at `to`, pointing away from `from`. */
export function arrowHeadPath(from: Point, to: Point, size = 30): string {
  const [fromX, fromY] = [from[0] * 1000, from[1] * 1000]; const [toX, toY] = [to[0] * 1000, to[1] * 1000];
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const wing = (turn: number) => `${Math.round(toX - size * Math.cos(angle + turn))} ${Math.round(toY - size * Math.sin(angle + turn))}`;
  return `M${wing(Math.PI / 7)} L${Math.round(toX)} ${Math.round(toY)} L${wing(-Math.PI / 7)}`;
}
