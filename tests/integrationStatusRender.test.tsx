import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoachEngineAuthoring, CoachEngineReadiness } from '../src/components/IntegrationStatus';
import VodReview from '../src/components/VodReview';
import { createSeed } from '../lib/seed';

describe('coach persisted engine readiness', () => {
  it('renders only persisted replay and rating calibration/contributions facts, with no ranked card', () => {
    const html = renderToStaticMarkup(<CoachEngineReadiness role="coach" engineState={{
      replay: [{ status: 'review-required' }],
      ratings: { configs: { c: { key: 'shadow/v1:b:1', calibrationStatus: 'uncalibrated', formula: { weights: { killsPerRound: .2 } } } }, records: { r: { recordKey: 'r', status: 'review-required', calibrationStatus: 'uncalibrated', result: { context: { playerId: 'p1' }, coverage: { ratio: .8 }, metrics: [{ metric: 'killsPerRound', included: true, weightedContribution: .12 }] } } } },
      ranked: { providers: [{ approvedStatus: 'approved', configured: true }], accounts: [{}], consents: [{ revokedAt: null }], states: [{ status: 'fresh' }] },
    }} />);
    for (const value of ['1 active · 1 awaiting review', '1 recomputed · 0 calibrated', 'authoritative score unavailable', 'killsPerRound']) expect(html).toContain(value);
    expect(html).not.toContain('Ranked'); expect(html).not.toContain('consented');
  });
  it('does not expose coach readiness to players', () => expect(renderToStaticMarkup(<CoachEngineReadiness role="player" engineState={{}} />)).toBe(''));
  it('mounts explicit coach authoring controls while players receive none', () => {
    const coach = renderToStaticMarkup(<CoachEngineAuthoring role="coach" engineState={{ ratings: { records: {} } }} onChanged={() => {}} />);
    for (const value of ['Formula, baseline, validation input and expectedRevision JSON', 'Preview weights', 'Recompute on server']) expect(coach).toContain(value);
    for (const value of ['Provider capability', 'Exact account JSON', 'Ranked']) expect(coach).not.toContain(value);
    expect(renderToStaticMarkup(<CoachEngineAuthoring role="player" engineState={{}} onChanged={() => {}} />)).toBe('');
  });
});

describe('match-scoped replay authoring', () => {
  it('renders first-draft validation for a focused active match with no linked VOD', () => {
    const data: any = { ...createSeed(), matches: [{ id: 'match-no-vod', opponent: 'Opponent', map: 'Ascent', date: '2026-10-12', type: 'Scrim' }], vodReviews: [], rounds: [], playerStats: [] };
    const html = renderToStaticMarkup(<VodReview data={data} theme={{ border: 'border-test', cardBg: 'card-test' }} role="coach" onRefresh={async () => {}} initialMatchId="match-no-vod" />);
    expect(html).toContain('Create replay evidence draft'); expect(html).toContain('match-no-vod'); expect(html).toContain('Validate and save draft');
  });
});
