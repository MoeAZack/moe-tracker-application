import { describe, expect, it } from 'vitest';
import { exactRoundEvidenceFingerprint, isDuplicateQuarantined, refreshDuplicateQuarantine, sameGameEvidence, stableMatchEvidenceFingerprint } from '../lib/matchIntegrity';
import { ensureStorageSchema } from '../lib/storageSchema';
import { buildAcceptedMatchAggregatePlan } from '../lib/aggregateVersioning';
import { filterAnalyticsHistory } from '../src/utils/historyFilter';
import { buildCalibratedPlayerRatings } from '../lib/calibratedPlayerRatings';
import { recaptureMatch, recaptureRounds, recaptureStats, withUnreadScoreboardRows } from './fixtures/sameGameRecapture';

const pair = () => ({
  matches: [recaptureMatch('a', 'first'), recaptureMatch('b', 'second')],
  rounds: [...recaptureRounds('a', 'first'), ...recaptureRounds('b', 'second')],
  playerStats: [...recaptureStats('a'), ...recaptureStats('b')],
});

describe('H0 same-game duplicate quarantine', () => {
  it('matches an OCR-variant re-capture that the exact payload guard misses', () => {
    const db: any = pair();
    const roundsA = db.rounds.filter((row: any) => row.matchId === 'a'); const roundsB = db.rounds.filter((row: any) => row.matchId === 'b');
    expect(roundsA.flatMap((row: any) => row.screenshotEvidence.events)).toHaveLength(168);
    // The audited gap: confidence floats, loadouts and economy differ, so the exact guard passes it.
    expect(exactRoundEvidenceFingerprint(roundsA)).not.toBe(exactRoundEvidenceFingerprint(roundsB));
    expect(stableMatchEvidenceFingerprint(db.matches[0], roundsA)).toMatch(/^[a-f0-9]{64}$/);
    expect(stableMatchEvidenceFingerprint(db.matches[1], roundsB)).toBe(stableMatchEvidenceFingerprint(db.matches[0], roundsA));
  });

  it('quarantines the later copy, keeps the original, and never deletes', () => {
    const db: any = pair();
    expect(refreshDuplicateQuarantine(db, '2026-10-20T12:00:00.000Z')).toEqual(['b']);
    expect(db.matches[0].duplicateReview).toBeUndefined();
    expect(db.matches[1].duplicateReview).toMatchObject({ status: 'quarantined', candidateMatchIds: ['a'], detectedAt: '2026-10-20T12:00:00.000Z' });
    expect(db.matches).toHaveLength(2); expect(db.rounds).toHaveLength(48);
    // Idempotent: a second pass keeps the original detection time.
    refreshDuplicateQuarantine(db, '2026-10-21T12:00:00.000Z');
    expect(db.matches[1].duplicateReview.detectedAt).toBe('2026-10-20T12:00:00.000Z');
  });

  it('holds a coach keep-both decision until the evidence changes', () => {
    const db: any = pair(); refreshDuplicateQuarantine(db);
    db.matches[1].duplicateReview = { ...db.matches[1].duplicateReview, status: 'kept-distinct', resolvedBy: 'Coach', resolvedAt: '2026-10-20T13:00:00.000Z' };
    expect(refreshDuplicateQuarantine(db)).toEqual([]);
    expect(db.matches[1].duplicateReview.status).toBe('kept-distinct');
    // A further copy quarantines only itself; the coach's keep decision stands and gains the new candidate.
    db.matches.push(recaptureMatch('c', 'second')); db.rounds.push(...recaptureRounds('c', 'second'));
    expect(refreshDuplicateQuarantine(db)).toEqual(['c']);
    expect(db.matches[1].duplicateReview).toMatchObject({ status: 'kept-distinct', resolvedBy: 'Coach', candidateMatchIds: ['a', 'c'] });
    expect(db.matches[2].duplicateReview).toMatchObject({ status: 'quarantined', candidateMatchIds: ['a', 'b'] });
  });

  it('still catches a re-capture when scoreboard cells are unread', () => {
    const db: any = pair(); db.matches = [withUnreadScoreboardRows(db.matches[0]), withUnreadScoreboardRows(db.matches[1])];
    const evidence = sameGameEvidence(db.matches[0], db.rounds.filter((row: any) => row.matchId === 'a'));
    expect(evidence).toMatchObject({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), scoreboard: null });
    expect(refreshDuplicateQuarantine(db)).toEqual(['b']);
    // One copy fully read and one with unread rows still pair up.
    const mixed: any = pair(); mixed.matches[1] = withUnreadScoreboardRows(mixed.matches[1]);
    expect(refreshDuplicateQuarantine(mixed)).toEqual(['b']);
  });

  it('keeps games apart when two complete scoreboards disagree', () => {
    const db: any = pair(); db.matches[1].screenshotEvidence.scoreboardPlayers[0].kills += 1;
    expect(refreshDuplicateQuarantine(db)).toEqual([]);
  });

  it('never treats scores, K/D/A totals, W/L sequences or partial evidence as proof', () => {
    const db: any = pair();
    // Same score, scoreboard and W/L sequence, different kill order: a different game.
    for (const row of db.rounds.filter((item: any) => item.matchId === 'b')) row.screenshotEvidence.events = row.screenshotEvidence.events.reverse().map((event: any, index: number) => ({ ...event, sequence: index + 1 }));
    expect(refreshDuplicateQuarantine(db)).toEqual([]);
    const sparse = recaptureRounds('x', 'first').map(({ screenshotEvidence: _evidence, ...row }) => row);
    expect(stableMatchEvidenceFingerprint(recaptureMatch('x', 'first'), sparse)).toBeNull();
    // Fewer than ten rounds with fully identified kill lists is never enough.
    const nineWithKills = recaptureRounds('y', 'first').map((row, index) => index < 15 ? { ...row, screenshotEvidence: { ...row.screenshotEvidence, events: [] } } : row);
    expect(stableMatchEvidenceFingerprint(recaptureMatch('y', 'first'), nineWithKills)).toBeNull();
    const unidentified = recaptureRounds('z', 'first').map((row, index) => index < 15 ? { ...row, screenshotEvidence: { ...row.screenshotEvidence, events: row.screenshotEvidence.events.map(event => ({ ...event, killerPlayerId: '' })) } } : row);
    expect(stableMatchEvidenceFingerprint(recaptureMatch('z', 'first'), unidentified)).toBeNull();
  });

  it('clears a quarantine once the original is gone', () => {
    const db: any = pair(); refreshDuplicateQuarantine(db);
    db.matches = db.matches.filter((match: any) => match.id !== 'a'); db.rounds = db.rounds.filter((row: any) => row.matchId !== 'a');
    refreshDuplicateQuarantine(db);
    expect(isDuplicateQuarantined(db.matches[0])).toBe(false);
  });

  it('counts a quarantined copy once in analytics and ratings', () => {
    const db: any = { ...pair(), settings: {}, tryoutBatches: [], vetos: [], stratRuns: [], rosterPlayers: [] }; refreshDuplicateQuarantine(db);
    const visible = filterAnalyticsHistory(db);
    expect(visible.matches.map(match => match.id)).toEqual(['a']);
    expect(new Set(visible.playerStats.map(row => row.matchId))).toEqual(new Set(['a']));
    expect(new Set(visible.rounds.map(row => row.matchId))).toEqual(new Set(['a']));
    expect(buildCalibratedPlayerRatings(db).every(rating => rating.matches <= 1)).toBe(true);
  });

  it('flags existing same-game pairs in the schema-15 migration without removing anything', () => {
    const db: any = { _storage: { schemaVersion: 14, migrationLedger: [] }, settings: {}, ...pair(), vetos: [], stratRuns: [], vodSubmissions: [], evidenceFusionResolutions: [], analyticsBuilds: {}, seasonArchives: [], coachingSignals: [], coachingActions: [], dashboardViews: [], calibratedPlayerRatings: [], attendanceCredits: [] };
    ensureStorageSchema(db, '2026-10-20T12:00:00.000Z');
    expect(db.matches.map((match: any) => match.duplicateReview?.status || null)).toEqual([null, 'quarantined']);
    expect(db.rounds).toHaveLength(48); expect(db.playerStats).toHaveLength(10);
  });

  it('gives a quarantined copy the same derived aggregates whenever the quarantine was detected', () => {
    // An unsaved schema-14 workspace is migrated on every read, each time with a new detectedAt.
    const first: any = pair(); const later: any = pair();
    refreshDuplicateQuarantine(first, '2026-10-20T12:00:00.000Z'); refreshDuplicateQuarantine(later, '2026-10-21T17:00:00.000Z');
    const [a, b] = [buildAcceptedMatchAggregatePlan(first, 'b'), buildAcceptedMatchAggregatePlan(later, 'b')];
    expect(a.build.status).toBe('recomputed');
    expect(b.build.sourceHash).toBe(a.build.sourceHash);
    expect(b.match!.roundAnalytics).toEqual(a.match!.roundAnalytics);
    // The decision itself is still source: keeping the copy changes the hash.
    later.matches[1].duplicateReview = { ...later.matches[1].duplicateReview, status: 'kept-distinct' };
    expect(buildAcceptedMatchAggregatePlan(later, 'b').build.sourceHash).not.toBe(a.build.sourceHash);
  });
});
