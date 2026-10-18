import React from 'react';
import fs from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ReviewContextBar from '../src/components/ReviewContextBar';

const data: any = {
  matches: [{ id: 'm1', date: '2026-10-18', opponent: 'PYO', map: 'Ascent' }],
  rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1 }, { id: 'r2', matchId: 'm1', roundNo: 2 }],
};

describe('shared match review context', () => {
  it('renders the shared match and round selectors plus every review destination', () => {
    const html = renderToStaticMarkup(<ReviewContextBar data={data} value={{ matchId: 'm1', roundNo: 2 }} onChange={vi.fn()} onNavigate={vi.fn()} />);
    expect(html).toContain('Reviewing together');
    expect(html).toContain('PYO · Ascent');
    expect(html).toContain('Round 2');
    for (const label of ['Match', 'Replay', 'VOD', 'Economy']) expect(html).toContain(label);
  });

  it('wires the shared selection into match, replay, VOD and economy surfaces', () => {
    const app = fs.readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('moetracker-review-match');
    expect(app).toContain('preferredMatchId={reviewMatchId}');
    expect(app).toContain('selectedRoundNo={reviewRoundNo}');
    expect(app).toContain('focusedMatchId={reviewMatchId} focusedRoundNo={reviewRoundNo}');
    const matches = fs.readFileSync('src/components/MatchLogRounds.tsx', 'utf8');
    expect(matches).toContain('onReviewContextChange?.(selectedMatch.id, r.roundNo)');
  });
});
