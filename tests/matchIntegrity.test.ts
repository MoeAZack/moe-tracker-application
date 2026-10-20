import { describe, expect, it } from 'vitest';
import { auditExactRoundEvidenceDuplicates, exactRoundEvidenceFingerprint, findExactRoundEvidenceDuplicate, findExactSourceDuplicate, purgeMatchGraph, purgeRemovedRoundReferences, stableRoundReplacement } from '../lib/matchIntegrity';
import { ensureStorageSchema, STORAGE_SCHEMA_VERSION } from '../lib/storageSchema';

const confirmed = (roundNo: number) => ({
  roundNo, side: roundNo % 2 ? 'Attack' : 'Defense', result: roundNo % 3 ? 'W' : 'L',
  screenshotEvidence: {
    schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'high', eventsComplete: true,
    players: Array.from({ length: 5 }, (_, index) => ({ playerId: `p${index}`, displayName: `P${index}`, team: 'ours', kills: roundNo + index })),
    events: [{ sequence: 1, killerPlayerId: 'p0', victimPlayerId: `enemy-${roundNo}`, killerTeam: 'ours', victimTeam: 'theirs', weapon: 'Vandal' }],
  },
});

describe('H0 match integrity', () => {
  it('preserves round ids by round number and rejects stale or duplicate identities', () => {
    const existing = [{ id: 'r1', roundNo: 1, notes: 'old' }, { id: 'r2', roundNo: 2 }];
    const rows = stableRoundReplacement(existing, [{ roundNo: 1, notes: 'new' }, { id: 'r2', roundNo: 2 }, { roundNo: 3 }], () => 'r3');
    expect(rows.map(row => row.id)).toEqual(['r1', 'r2', 'r3']);
    expect(() => stableRoundReplacement(existing, [{ id: 'stale', roundNo: 1 }], () => 'new')).toThrow(/does not belong/);
    expect(() => stableRoundReplacement(existing, [{ roundNo: 1 }, { roundNo: 1 }], () => 'new')).toThrow(/unique/);
  });

  it('rejects only exact rich confirmed round evidence, not sparse result sequences', () => {
    const rounds = Array.from({ length: 6 }, (_, index) => ({ id: `a${index}`, matchId: 'm1', ...confirmed(index + 1) }));
    const db: any = { matches: [{ id: 'm1' }, { id: 'm2' }], rounds };
    expect(exactRoundEvidenceFingerprint(rounds)).toMatch(/^[a-f0-9]{64}$/);
    expect(findExactRoundEvidenceDuplicate(db, 'm2', rounds.map(({ id: _id, matchId: _matchId, ...row }) => row))).toMatchObject({ existingMatchId: 'm1' });
    expect(auditExactRoundEvidenceDuplicates({ ...db, rounds: [...rounds, ...rounds.map(row => ({ ...row, id: `b${row.roundNo}`, matchId: 'm2' }))] })).toHaveLength(1);
    expect(exactRoundEvidenceFingerprint(Array.from({ length: 13 }, (_, index) => ({ roundNo: index + 1, result: index < 7 ? 'W' : 'L' })))).toBeNull();
  });

  it('finds immutable source reuse without treating ordinary match metadata as identity', () => {
    const db: any = { matches: [{ id: 'm1', sourceMetadata: { method: 'screenshot', provider: 'local', externalId: 'capture-1' } }] };
    expect(findExactSourceDuplicate(db, { id: 'm2', sourceMetadata: { method: 'screenshot', provider: 'local', externalId: 'capture-1' } })).toMatchObject({ existingMatchId: 'm1' });
    expect(findExactSourceDuplicate(db, { id: 'm2', opponent: 'Same', ourScore: 13, theirScore: 8 })).toBeNull();
  });

  it('deletes match-owned evidence and detaches durable coach-authored records', () => {
    const db: any = {
      matches: [{ id: 'm1' }, { id: 'm2' }], playerStats: [{ id: 's1', matchId: 'm1' }, { id: 's2', matchId: 'm2' }], rounds: [{ id: 'r1', matchId: 'm1' }, { id: 'r2', matchId: 'm2' }],
      vetos: [{ id: 'v1', matchId: 'm1' }], stratRuns: [{ id: 'sr1', matchId: 'm1' }], vodSubmissions: [{ id: 'vs1', linkedMatchId: 'm1' }],
      evidenceFusionResolutions: [{ id: 'e1', matchId: 'm1', roundId: 'r1' }, { id: 'e2', matchId: 'm2', roundId: 'r2' }], analyticsBuilds: { m1: { built: true }, m2: { built: true } },
      engineAdapters: { replay: { m1: { matchId: 'm1' }, m2: { matchId: 'm2' } }, devices: { keep: { id: 'keep' } } }, replayIntake: { reviews: { one: { matchId: 'm1' }, two: { matchId: 'm2' } }, devices: { keep: { id: 'keep' } } },
      goals: [{ id: 'g1', matchId: 'm1', roundId: 'r1', evidenceClipId: 'clip', sourceSignalId: 'c1', coachingActionId: 'a1' }], vodReviews: [{ id: 'vr1', matchId: 'm1', notes: [{ text: 'keep' }] }], practiceBlocks: [{ id: 'b1', matchIds: ['m1', 'm2'] }],
      coachingSignals: [{ id: 'c1', matchIds: ['m1'], evidence: { matchIds: ['m1'], roundIds: ['r1'] } }, { id: 'c2', matchIds: ['m2'], evidence: { matchIds: ['m2'], roundIds: ['r2'] } }],
      coachingActions: [{ id: 'a1', sourceSignalId: 'c1', evidence: { matchIds: ['m1'], roundIds: ['r1'] } }, { id: 'a2', sourceSignalId: 'c2', evidence: { matchIds: ['m2'], roundIds: ['r2'] } }], calibratedPlayerRatings: [{ id: 'rating' }],
    };
    const report = purgeMatchGraph(db, 'm1');
    expect(report.removed).toMatchObject({ matches: 1, playerStats: 1, rounds: 1, coachingSignals: 1, coachingActions: 1, calibratedPlayerRatings: 1 });
    expect(db.matches.map((row: any) => row.id)).toEqual(['m2']); expect(db.playerStats.map((row: any) => row.id)).toEqual(['s2']); expect(db.rounds.map((row: any) => row.id)).toEqual(['r2']);
    expect(db.analyticsBuilds).toEqual({ m2: { built: true } }); expect(db.engineAdapters.replay).toEqual({ m2: { matchId: 'm2' } }); expect(db.replayIntake.devices.keep.id).toBe('keep');
    expect(db.goals[0]).toEqual({ id: 'g1' }); expect(db.vodReviews[0]).toMatchObject({ id: 'vr1', notes: [{ text: 'keep' }] }); expect(db.vodReviews[0]).not.toHaveProperty('matchId');
    expect(db.practiceBlocks[0].matchIds).toEqual(['m2']); expect(db.coachingSignals.map((row: any) => row.id)).toEqual(['c2']); expect(db.coachingActions.map((row: any) => row.id)).toEqual(['a2']);
  });

  it('removes references only for rounds intentionally removed from a replacement', () => {
    const db: any = { rounds: [{ id: 'r1', matchId: 'm1' }, { id: 'r2', matchId: 'm1' }], evidenceFusionResolutions: [{ id: 'e1', matchId: 'm1', roundId: 'r1' }, { id: 'e2', matchId: 'm1', roundId: 'r2' }], goals: [{ id: 'g', matchId: 'm1', roundId: 'r2', evidenceClipId: 'clip' }], coachingSignals: [{ evidence: { roundIds: ['r1', 'r2'] } }], coachingActions: [{ evidence: { roundIds: ['r2'] } }] };
    expect(purgeRemovedRoundReferences(db, 'm1', new Set(['r1']))).toMatchObject({ removedResolutions: 1, detachedGoals: 1, detachedSignals: 1, detachedActions: 1 });
    expect(db.evidenceFusionResolutions.map((row: any) => row.id)).toEqual(['e1']); expect(db.goals[0]).not.toHaveProperty('roundId'); expect(db.coachingSignals[0].evidence.roundIds).toEqual(['r1']);
  });

  it('repairs unambiguous orphan-owned rows in the schema-13 migration and records the repair', () => {
    const db: any = { _storage: { schemaVersion: 12, migrationLedger: [] }, settings: {}, matches: [{ id: 'm1' }], playerStats: [{ id: 'keep', matchId: 'm1' }, { id: 'drop', matchId: 'gone' }], rounds: [{ id: 'drop-round', matchId: 'gone' }], vetos: [], stratRuns: [], vodSubmissions: [], evidenceFusionResolutions: [], analyticsBuilds: { m1: {}, gone: {} }, seasonArchives: [], coachingSignals: [], coachingActions: [], dashboardViews: [], calibratedPlayerRatings: [], attendanceCredits: [] };
    ensureStorageSchema(db, '2026-10-20T12:00:00.000Z');
    expect(db._storage.schemaVersion).toBe(STORAGE_SCHEMA_VERSION); expect(db.playerStats.map((row: any) => row.id)).toEqual(['keep']); expect(db.rounds).toEqual([]); expect(Object.keys(db.analyticsBuilds)).toEqual(['m1']);
    expect(db._storage.integrityRepair).toEqual({ at: '2026-10-20T12:00:00.000Z', removed: { playerStats: 1, rounds: 1 } });
  });
});
