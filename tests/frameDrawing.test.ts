import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MAX_POINTS, MAX_STROKES, arrowHeadPath, normalizeDrawing, simplifyPoints, strokePath } from '../lib/frameDrawing';
import { DrawableFrame, DrawingView } from '../src/components/FrameDrawing';
import MultiPovReview from '../src/components/MultiPovReview';

describe('frame drawings', () => {
  it('keeps only known tools and colours, clamps points to the frame, and drops what cannot show', () => {
    expect(normalizeDrawing({ strokes: [
      { tool: 'pen', color: '#22d3ee', points: [[0.1, 0.1], [0.5, 0.5], [2, -1]] },
      { tool: 'pen', color: 'red', points: [[0, 0], [1, 1]] },
      { tool: 'pen', color: '#22d3ee', points: [[0.5, 0.5]] },
      { tool: 'arrow', color: '#facc15', points: [[0, 0], [0.2, 0.2], [0.9, 0.4]] },
      { tool: 'pen', color: '#ffffff', points: [['x', 1], [0.2, 0.2], [0.3, 0.3]] },
    ] })).toEqual({ schema: 'moetracker.frame-drawing/v1', strokes: [
      { tool: 'pen', color: '#22d3ee', points: [[0.1, 0.1], [0.5, 0.5], [1, 0]] },
      { tool: 'arrow', color: '#facc15', points: [[0, 0], [0.9, 0.4]] },
      { tool: 'pen', color: '#ffffff', points: [[0.2, 0.2], [0.3, 0.3]] },
    ] });
    expect(normalizeDrawing({ strokes: [] })).toBeNull();
    expect(normalizeDrawing('nope')).toBeNull();
  });

  it('caps stroke and point counts so a note stays small', () => {
    const stroke = { tool: 'pen', color: '#ff4655', points: Array.from({ length: MAX_POINTS * 3 }, (_, index) => [index / (MAX_POINTS * 3), 0.5]) };
    const drawing = normalizeDrawing({ strokes: Array.from({ length: MAX_STROKES + 5 }, () => stroke) })!;
    expect(drawing.strokes).toHaveLength(MAX_STROKES);
    expect(drawing.strokes[0].points.length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it('thins hand-drawn points but keeps both ends', () => {
    expect(simplifyPoints([[0, 0], [0.001, 0], [0.002, 0], [0.5, 0.5], [0.5005, 0.5]])).toEqual([[0, 0], [0.5, 0.5], [0.5005, 0.5]]);
  });

  it('draws paths in a 1000-unit box with an arrowhead at the end', () => {
    expect(strokePath([[0, 0], [0.5, 0.25]])).toBe('M0 0 L500 250');
    expect(arrowHeadPath([0, 0.5], [1, 0.5])).toMatch(/^M\d+ \d+ L1000 500 L\d+ \d+$/);
  });

  it('shows a saved drawing over the frame and opens the tools only while drawing', () => {
    const drawing = normalizeDrawing({ strokes: [{ tool: 'arrow', color: '#ff4655', points: [[0, 0], [1, 1]] }] })!;
    expect(renderToStaticMarkup(React.createElement(DrawingView, { drawing, label: 'Drawing at 1:00' }))).toContain('aria-label="Drawing at 1:00"');
    const props = { frame: React.createElement('video'), shown: { drawing, label: 'Drawing at 1:00' }, onSave: () => {}, onCancel: () => {}, saveLabel: 'Save as note' };
    const idle = renderToStaticMarkup(React.createElement(DrawableFrame, { ...props, drawing: false }));
    expect(idle).toContain('Drawing at 1:00'); expect(idle).not.toContain('Drawing tools');
    const active = renderToStaticMarkup(React.createElement(DrawableFrame, { ...props, drawing: true, disabledReason: 'Save the review first.' }));
    expect(active).toContain('aria-label="Drawing tools"'); expect(active).toContain('Red pen'); expect(active).toContain('Save the review first.');
  });

  it('lists a view’s saved drawings in the side-by-side panel', () => {
    const drawing = normalizeDrawing({ strokes: [{ tool: 'arrow', color: '#ff4655', points: [[0, 0], [1, 1]] }] });
    const reviews: any = [{ id: 'a', title: 'POV a', vodUrl: 'https://youtu.be/abcdefghijk', matchId: 'm1', notes: [{ id: 'n1', seconds: 90, timeLabel: '1:30', roundNo: 3, text: 'x', drawing }, { id: 'n2', seconds: 95, timeLabel: '1:35', text: 'plain' }] }];
    const html = renderToStaticMarkup(React.createElement(MultiPovReview, { reviews, matchId: 'm1', rounds: [], onSaveOffset: async () => true, defaultOpen: true } as any));
    expect(html).toContain('Draw on this frame');
    expect(html).toContain('Drawings:');
    expect(html.replace(/<!-- -->/g, '')).toContain('1:30 · R3');
    expect(html).not.toContain('1:35');
  });
});
