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
    expect(app).toContain('onReviewContextChange={(matchId, roundNo)');
    expect(app).toContain('focusedMatchId={reviewMatchId} focusedRoundNo={reviewRoundNo}');
    const matches = fs.readFileSync('src/components/MatchLogRounds.tsx', 'utf8');
    expect(matches).toContain('onReviewContextChange?.(selectedMatch.id, r.roundNo)');
    const vod = fs.readFileSync('src/components/VodReview.tsx', 'utf8');
    expect(vod).toContain('onReviewContextChange?.(review.matchId || null, null)');
    expect(vod).toContain('has no confirmed VOD timestamp yet');
    expect(vod).toContain('onReviewContextChange?.(focusedMatch.id, round.roundNo)');
    const players = fs.readFileSync('src/components/PlayerSoloTracker.tsx', 'utf8');
    expect(players).toContain('const contributingRowIds = new Set(row.sourceRowIds)');
    expect(players).not.toContain('stat.playerId === row.playerId');
    expect(players).toContain('playerMetricRoundEvidence(data, row)');
    expect(players).toContain('onOpenEvidence?.(item.matchId, item.roundNo)');
    expect(app).toContain("setReviewRoundNo(roundNo); setActiveTab('vod')");
  });
});
