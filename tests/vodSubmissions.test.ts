import { describe, expect, it } from 'vitest';
import { createSeed } from '../lib/seed';
import { integrateVodSubmission, similarVodName } from '../lib/vodSubmissions';

const roster = ['caelia', 'dexle', 'majusIa', 'bellatrix', 'Sandra'].map((displayName, index) => ({ id: `player-${index + 1}`, displayName, createdAt: '2026-10-18T10:00:00Z' }));
const players = roster.map((player, index) => ({ observedName: index === 2 ? 'majusla' : player.displayName, agent: ['Cypher', 'Jett', 'Phoenix', 'Omen', 'Sova'][index], kills: 20 - index, deaths: 12 + index, assists: 3 + index, acs: 200 + index, adr: 140 + index, hs: 25 + index, fk: index, fd: index + 1, plants: index === 2 ? 1 : 0, defuses: index === 4 ? 1 : 0, trades: index + 2 }));
const input = { vodUrl: 'https://example.test/vod/1', imageSha256: 'a'.repeat(64), playerId: 'player-1', date: '2026-10-18', map: 'Ascent', opponent: 'PYO', ourScore: 13, theirScore: 9, players };
const ids = { submissionId: 'submission-1', matchId: 'new-match', statId: (() => { let index = 0; return () => `new-stat-${++index}`; })(), reviewId: 'review-1' };

function fixture() {
  const db: any = createSeed(); db.rosterPlayers = structuredClone(roster); db.matches = [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'PYO', map: 'Ascent', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9, sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-18T12:00:00Z' } }];
  db.playerStats = roster.map((player, index) => ({ id: `stat-${index}`, matchId: 'm1', playerId: player.id, player: player.displayName, displayNameSnapshot: player.displayName, agent: players[index].agent, kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: index === 0 ? 99 : null, deaths: null, assists: null })); return db;
}

describe('player VOD submission integration', () => {
  it('accepts a minor OCR name error, links five identities and fills only missing match fields', () => {
    expect(similarVodName('majusla', 'majusIa')).toBe(true);
    const db = fixture(); const submission = integrateVodSubmission(db, { ...input, matchId: 'm1' }, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(submission).toMatchObject({ linkedMatchId: 'm1', linkMode: 'existing-match', rosterMatchCount: 5, integration: { createdMatch: false, createdStats: 0 } });
    expect(db.playerStats[0].kills).toBe(99); expect(db.playerStats[0].deaths).toBe(12); expect(db.playerStats[4].trades).toBe(6);
    expect(db.matches[0].vodSubmissionIds).toEqual(['submission-1']); expect(db.vodReviews[0]).toMatchObject({ matchId: 'm1', vodUrl: input.vodUrl });
  });

  it('creates a new linked match section when the VOD is not tied to recorded evidence', () => {
    const db = fixture(); db.matches = []; db.playerStats = [];
    const submission = integrateVodSubmission(db, input, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(submission).toMatchObject({ linkedMatchId: 'new-match', linkMode: 'new-match', integration: { createdMatch: true, createdStats: 5 } });
    expect(db.matches[0]).toMatchObject({ id: 'new-match', sourceMetadata: { method: 'vod-submission' }, comparisonEvidence: { accepted: true } });
    expect(db.playerStats).toHaveLength(5);
  });

  it('rejects integration unless five unique active roster identities resolve', () => {
    const db = fixture(); const invalid = { ...input, players: input.players.map((row, index) => index === 4 ? { ...row, observedName: 'unknown-player' } : row) };
    expect(() => integrateVodSubmission(db, invalid, 'caelia', ids)).toThrow(/match exactly one active roster player/i);
  });

  it('retains partial timeline observations but promotes metrics only with complete signal coverage', () => {
    const db = fixture(); const timeline: any = {
      schema: 'moetracker.vod-timeline-evidence/v1', grade: 'video-observation', source: { kind: 'youtube', videoId: 'abcdefghijk', sha256: 'b'.repeat(64), width: 1920, height: 1080, durationMs: 600000, analyzedAt: '2026-10-18T14:00:00Z' },
      coverage: { durationMs: 600000, killFeedSnapshots: 40, objectiveSnapshots: 10, ultimateSnapshots: 20, resolvedEliminations: 25, inferredRoundGroups: 12, signals: { eliminations: 'partial', trades: 'complete', kast: 'complete', ultimateUse: 'partial', orbCapture: 'unsupported', throws: 'unsupported' } },
      observations: [], rounds: [], throwCandidates: [], limitations: [],
      playerMetrics: [{ playerName: 'caelia', team: 'ours', kills: 5, deaths: 4, trades: 3, ultimateUses: 2, orbCaptures: null, kastSuccessful: 8, kastCovered: 10, kastRate: 80 }],
    };
    const submission = integrateVodSubmission(db, { ...input, matchId: 'm1', timelineEvidence: timeline }, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(submission.timelineEvidence?.coverage.signals.trades).toBe('complete');
    expect(db.playerStats[0]).toMatchObject({ trades: 2, kastSuccessful: 8, kastCovered: 10 });
    expect(db.playerStats[0].ultimateUses).toBeUndefined(); expect(db.playerStats[0].orbPoints).toBeUndefined();
    expect(db.playerStats[0].vodEvidence.timeline).toMatchObject({ grade: 'video-observation', metrics: { observedKills: 5, ultimateUses: 2 } });
  });

  it('upgrades an existing scoreboard-only submission with later timeline evidence instead of duplicating it', () => {
    const db = fixture(); const first = integrateVodSubmission(db, { ...input, matchId: 'm1' }, 'caelia', ids, '2026-10-18T14:00:00Z');
    const timeline: any = { schema: 'moetracker.vod-timeline-evidence/v1', grade: 'video-observation', source: { kind: 'youtube', videoId: 'abcdefghijk', sha256: 'b'.repeat(64), width: 1920, height: 1080, durationMs: 60_000, analyzedAt: '2026-10-18T14:10:00Z' }, coverage: { durationMs: 60_000, killFeedSnapshots: 2, objectiveSnapshots: 0, ultimateSnapshots: 0, resolvedEliminations: 1, inferredRoundGroups: 1, signals: { eliminations: 'partial', trades: 'partial', kast: 'partial', objectives: 'unsupported', ultimateUse: 'unsupported', orbCapture: 'unsupported', throws: 'unsupported' } }, observations: [], rounds: [], playerMetrics: [], throwCandidates: [], limitations: [] };
    const upgraded = integrateVodSubmission(db, { ...input, timelineEvidence: timeline }, 'caelia', { ...ids, submissionId: 'should-not-be-used' }, '2026-10-18T14:10:00Z');
    expect(upgraded.id).toBe(first.id); expect(upgraded.timelineEvidence).toBeTruthy(); expect(db.vodSubmissions).toHaveLength(1);
  });
});
