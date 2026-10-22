// A strategy board: the plan for one strategy drawn on the map, in steps
// ("Setup", "Execute", "Post-plant"). Each step places tokens (our agents,
// enemy positions, the spike, utility) and arrows/lines, all as fractions of
// the board (0–1), so the same plan draws at any size and over any minimap.

import { normalizeDrawing, type FrameDrawing } from './frameDrawing';

export const BOARD_SCHEMA = 'moetracker.strategy-board/v1' as const;
export const MAX_PHASES = 6;
export const MAX_TOKENS = 24;
export const TOKEN_KINDS = ['ally', 'enemy', 'spike', 'utility'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];
export type BoardToken = { id: string; kind: TokenKind; x: number; y: number; agent?: string; label?: string };
export type BoardPhase = { id: string; name: string; tokens: BoardToken[]; drawing: FrameDrawing | null; note: string };
export type StrategyBoard = { schema: typeof BOARD_SCHEMA; phases: BoardPhase[] };

export const DEFAULT_PHASE_NAMES = ['Setup', 'Execute', 'Post-plant'];

const unit = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000 : null);
const shortText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const safeId = (value: unknown, fallback: string) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : fallback);

export const emptyPhase = (index: number): BoardPhase => ({ id: `phase-${index + 1}`, name: DEFAULT_PHASE_NAMES[index] || `Step ${index + 1}`, tokens: [], drawing: null, note: '' });
export const emptyBoard = (): StrategyBoard => ({ schema: BOARD_SCHEMA, phases: [emptyPhase(0)] });

/** The stored form of a board, or null when it has nothing on it. Malformed parts are dropped. */
export function normalizeBoard(input: unknown): StrategyBoard | null {
  const phases = (input as any)?.phases;
  if (!Array.isArray(phases)) return null;
  const clean: BoardPhase[] = phases.slice(0, MAX_PHASES).map((phase: any, index: number) => {
    const ids = new Set<string>();
    const tokens: BoardToken[] = (Array.isArray(phase?.tokens) ? phase.tokens : []).slice(0, MAX_TOKENS).flatMap((token: any, tokenIndex: number) => {
      const x = unit(token?.x); const y = unit(token?.y);
      if (!(TOKEN_KINDS as readonly unknown[]).includes(token?.kind) || x === null || y === null) return [];
      let id = safeId(token?.id, `t${tokenIndex + 1}`);
      if (ids.has(id)) id = `${id}-${tokenIndex + 1}`;
      ids.add(id);
      const agent = shortText(token?.agent, 24); const label = shortText(token?.label, 24);
      return [{ id, kind: token.kind, x, y, ...(agent ? { agent } : {}), ...(label ? { label } : {}) }];
    });
    return { id: safeId(phase?.id, `phase-${index + 1}`), name: shortText(phase?.name, 40) || emptyPhase(index).name, tokens, drawing: normalizeDrawing(phase?.drawing), note: shortText(phase?.note, 1000) };
  });
  const hasContent = clean.some(phase => phase.tokens.length || phase.drawing || phase.note);
  return hasContent ? { schema: BOARD_SCHEMA, phases: clean } : null;
}

/** Copies a step's tokens and drawing into a new step after it, the usual way to plan "what happens next". */
export function nextPhaseFrom(board: StrategyBoard, index: number): StrategyBoard {
  if (board.phases.length >= MAX_PHASES) return board;
  const source = board.phases[index] || emptyPhase(index);
  const used = new Set(board.phases.map(phase => phase.id));
  let number = board.phases.length + 1;
  while (used.has(`phase-${number}`)) number += 1;
  const copy: BoardPhase = { ...structuredClone(source), id: `phase-${number}`, name: DEFAULT_PHASE_NAMES[index + 1] || `Step ${index + 2}`, note: '' };
  return { ...board, phases: [...board.phases.slice(0, index + 1), copy, ...board.phases.slice(index + 1)] };
}

/** File-safe key for a map's minimap image. */
export const mapImageKey = (map: unknown) => String(map ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
