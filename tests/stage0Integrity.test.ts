import { describe, expect, it } from 'vitest';
import { auditStage0Integrity, stage0BaselineSummary } from '../lib/stage0Integrity';
import { DEFAULT_MOE_02_FEATURE_FLAGS, moe02FeatureEnabled, resolveMoe02FeatureFlags } from '../lib/featureFlags';

const source = { method: 'manual', provider: 'coach', externalId: 'source-1', capturedAt: '2026-10-20T12:00:00Z' };
const state = () => ({
  settings: {}, rosterPlayers: [{ id: 'live', displayName: 'Live', createdAt: '2026-10-01' }, { id: 'old', displayName: 'Old', createdAt: '2026-10-01', retiredAt: '2026-10-20' }],
  matches: [{ id: 'm1', sourceMetadata: source, ourScore: 13, theirScore: 8, attW: 7, attL: 5, defW: 6, defL: 3 }],
  playerStats: [{ id: 's1', matchId: 'm1', playerId: 'live', player: 'Live', sourceMetadata: source }], rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', result: 'W' }],
  schedule: [], goals: [], coreMemberships: [], tryoutBatches: [], vodSubmissions: [], coachingSignals: [], coachingActions: [], calibratedPlayerRatings: [], soloq: [],
});

describe('Stage 0 feature boundaries', () => {
  it('keeps every 0.2 feature off unless its exact known flag is enabled', () => {
    expect(Object.values(DEFAULT_MOE_02_FEATURE_FLAGS).every(value => value === false)).toBe(true);
    expect(resolveMoe02FeatureFlags({ unifiedIngestion: true, unknownFutureFlag: true })).toMatchObject({ unifiedIngestion: true, evidenceFusionV2: false });
    expect(moe02FeatureEnabled('unifiedIngestion', { unifiedIngestion: true })).toBe(true);
  });
});

describe('Stage 0 integrity gate', () => {
  it('detects orphaned coaching goals and one-way Team Talk links', () => {
    const state: any = { matches: [], playerStats: [], rounds: [], goals: [], rosterPlayers: [], coreMemberships: [], tryoutBatches: [], vodSubmissions: [], coachingSignals: [], calibratedPlayerRatings: [], coachingActions: [{ id: 'a1', goalId: 'missing' }], schedule: [{ id: 'talk', linkedReviewEventId: 'debrief' }, { id: 'debrief' }] };
    const result = auditStage0Integrity(state);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['ORPHAN_COACHING_GOAL', 'BROKEN_REVIEW_EVENT_LINK']));
  });
  it('preserves a clean baseline without counting archived evidence as current', () => {
    const data = state();
    expect(auditStage0Integrity(data)).toMatchObject({ ok: true, errors: 0 });
    expect(stage0BaselineSummary(data)).toMatchObject({ counts: { matches: 1, playerStats: 1, rounds: 1 }, matchTotals: { wins: 1, losses: 0 }, archivedRosterPlayers: 1 });
  });

  it('rejects duplicated accepted evidence, orphan rows and sourced unknowns stored as zero', () => {
    const data: any = state();
    data.matches.push({ ...data.matches[0], id: 'm2' });
    data.rounds.push({ id: 'orphan', matchId: 'gone', roundNo: 1 });
    data.analyticsBuilds = { bad: { status: 'source-unavailable', unknownReason: 'missing-evidence', value: 0 } };
    const result = auditStage0Integrity(data);
    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['DUPLICATE_ACCEPTED_SOURCE', 'ORPHAN_MATCH_REFERENCE', 'UNKNOWN_AS_ZERO']));
  });

  it('rejects active derived records that still reference an archived identity', () => {
    const data: any = state();
    data.calibratedPlayerRatings = [{ id: 'rating-old', playerId: 'old', value: 1, sourceHash: 'hash' }];
    data.coachingActions = [{ id: 'action-old', state: 'assigned', ownerIds: ['old'] }];
    expect(auditStage0Integrity(data).issues.filter(issue => issue.code === 'ACTIVE_METRIC_REFERENCES_ARCHIVED_PLAYER')).toHaveLength(2);
  });
});
