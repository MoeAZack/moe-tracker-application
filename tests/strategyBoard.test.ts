import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_PHASES, MAX_TOKENS, emptyBoard, mapImageKey, nextPhaseFrom, normalizeBoard } from '../lib/strategyBoard';
import StrategyBoard, { tokenLabel } from '../src/components/StrategyBoard';
import { sniffImageType } from '../lib/routes/mapImages';

describe('strategy board', () => {
  it('cleans a board: known marker kinds only, positions clamped, ids made unique, empty boards dropped', () => {
    const board = normalizeBoard({ phases: [{ id: 'bad id!', name: '', note: ' Go fast ', tokens: [
      { id: 't1', kind: 'ally', agent: 'Jett', x: -1, y: 0.5 },
      { id: 't1', kind: 'enemy', label: 'Op', x: 0.2, y: 0.2 },
      { id: 't3', kind: 'wall', x: 0.2, y: 0.2 },
      { id: 't4', kind: 'spike', x: 'x', y: 0.2 },
    ] }] })!;
    expect(board.phases[0]).toEqual({ id: 'phase-1', name: 'Setup', note: 'Go fast', drawing: null, tokens: [{ id: 't1', kind: 'ally', agent: 'Jett', x: 0, y: 0.5 }, { id: 't1-2', kind: 'enemy', label: 'Op', x: 0.2, y: 0.2 }] });
    expect(normalizeBoard({ phases: [{ tokens: [] }, { note: '  ' }] })).toBeNull();
    expect(normalizeBoard(null)).toBeNull();
  });

  it('caps steps and markers', () => {
    const tokens = Array.from({ length: MAX_TOKENS + 4 }, (_, index) => ({ id: `t${index}`, kind: 'enemy', x: 0.5, y: 0.5 }));
    const board = normalizeBoard({ phases: Array.from({ length: MAX_PHASES + 2 }, () => ({ tokens })) })!;
    expect(board.phases).toHaveLength(MAX_PHASES);
    expect(board.phases[0].tokens).toHaveLength(MAX_TOKENS);
  });

  it('starts the next step as a copy of the current one, with its own id and name', () => {
    const start = normalizeBoard({ phases: [{ id: 'phase-1', name: 'Setup', note: 'x', tokens: [{ id: 't1', kind: 'ally', x: 0.1, y: 0.1 }] }, { id: 'phase-2', name: 'Execute', tokens: [{ id: 't1', kind: 'spike', x: 0.5, y: 0.5 }] }] })!;
    const next = nextPhaseFrom(start, 0);
    expect(next.phases.map(phase => [phase.id, phase.name])).toEqual([['phase-1', 'Setup'], ['phase-3', 'Execute'], ['phase-2', 'Execute']]);
    expect(next.phases[1].tokens).toEqual(start.phases[0].tokens); expect(next.phases[1].note).toBe('');
    next.phases[1].tokens[0].x = 0.9; expect(start.phases[0].tokens[0].x).toBe(0.1);
    const full = { ...start, phases: Array.from({ length: MAX_PHASES }, (_, index) => ({ ...start.phases[0], id: `p${index}` })) };
    expect(nextPhaseFrom(full, 0)).toBe(full);
    expect(emptyBoard().phases).toHaveLength(1);
  });

  it('keys minimap images safely and recognises images by their bytes', () => {
    expect(mapImageKey(' Ascent ')).toBe('ascent'); expect(mapImageKey('../../etc/passwd')).toBe('etc-passwd'); expect(mapImageKey('')).toBe('');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffImageType(new Uint8Array(Buffer.from('<svg onload=alert(1)>')))).toBeNull();
  });

  it('draws the saved plan: markers with readable names, steps as tabs, and a prompt for a missing minimap', () => {
    const strat: any = { id: 's1', map: 'Ascent', side: 'Att', name: 'A split', active: 'TRUE', board: normalizeBoard({ phases: [{ id: 'phase-1', name: 'Setup', tokens: [{ id: 't1', kind: 'ally', agent: 'KAY/O', x: 0.25, y: 0.5 }, { id: 't2', kind: 'utility', label: 'smoke', x: 0.5, y: 0.5 }] }, { id: 'phase-2', name: 'Execute', note: 'go' }] }) };
    const html = renderToStaticMarkup(React.createElement(StrategyBoard, { strat, agents: ['Jett', 'KAY/O'], onSave: async () => {}, onClose: () => {} }));
    expect(html).toContain('aria-label="KAY/O marker. Drag to move, or use the arrow keys."');
    expect(html).toContain('src="/agents/KAY_O.png"');
    expect(html).toContain('aria-label="smoke marker');
    expect(html).toContain('left:25%');
    expect(html.replace(/<!-- -->/g, '')).toMatch(/aria-pressed="true"[^>]*>1\. Setup</);
    expect(html.replace(/<!-- -->/g, '')).toMatch(/aria-pressed="false"[^>]*>2\. Execute</);
    expect(html).toContain('No minimap for Ascent yet.');
    expect(tokenLabel({ id: 'x', kind: 'enemy', x: 0, y: 0 })).toBe('Enemy');
  });
});
