import { describe, expect, it } from 'vitest';
import { createSeed } from '../lib/seed';
import { integrateVodSubmission, similarVodName } from '../lib/vodSubmissions';
import { vodSubmissionSchema } from '../schemas';

const roster = ['caelia', 'dexle', 'majusIa', 'bellatrix', 'Sandra'].map((displayName, index) => ({ id: `player-${index + 1}`, displayName, createdAt: '2026-10-18T10:00:00Z' }));
const players = roster.map((player, index) => ({ observedName: index === 2 ? 'majusla' : player.displayName, agent: ['Cypher', 'Jett', 'Phoenix', 'Omen', 'Sova'][index], kills: 20 - index, deaths: 12 + index, assists: 3 + index, acs: 200 + index, adr: 140 + index, hs: 25 + index, fk: index, fd: index + 1, plants: index === 2 ? 1 : 0, defuses: index === 4 ? 1 : 0, trades: index + 2 }));
const input = { vodUrl: 'https://example.test/vod/1', imageSha256: 'a'.repeat(64), playerId: 'player-1', date: '2026-10-18', map: 'Ascent', opponent: 'PYO', ourScore: 13, theirScore: 9, players };
const ids = { submissionId: 'submission-1', matchId: 'new-match', statId: (() => { let index = 0; return () => `new-stat-${++index}`; })(), reviewId: 'review-1' };

function fixture() {
  const db: any = createSeed(); db.rosterPlayers = structuredClone(roster); db.matches = [{ id: 'm1', date: '2026-10-18', type: 'Scrim', opponent: 'PYO', map: 'Ascent', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9, sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-18T12:00:00Z' } }];
  db.playerStats = roster.map((player, index) => ({ id: `stat-${index}`, matchId: 'm1', playerId: player.id, player: player.displayName, displayNameSnapshot: player.displayName, agent: players[index].agent, kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: index === 0 ? 99 : null, deaths: null, assists: null })); return db;
}

describe('player VOD submission integration', () => {
  it('accepts a privacy-safe local VOD fingerprint but rejects local file paths', () => {
    const { playerId: _playerId, ...coachInput } = input;
    expect(vodSubmissionSchema.safeParse({ ...coachInput, coachTeamEvidence: true, vodUrl: `moetracker-local://sha256/${'b'.repeat(64)}` }).success).toBe(true);
    expect(vodSubmissionSchema.safeParse({ ...coachInput, coachTeamEvidence: true, vodUrl: 'file:///C:/private/team-vod.mp4' }).success).toBe(false);
  });

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

  it('links by the shared match header only when the saved match also holds all five players', () => {
    // Same date, map, opponent and score, but only four of the five players: a header can repeat, so it is not this game.
    const db = fixture(); db.playerStats = db.playerStats.slice(0, 4).map((row: any) => ({ ...row, playerId: undefined, player: `other-${row.id}`, displayNameSnapshot: `other-${row.id}` }));
    const submission = integrateVodSubmission(db, input, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(submission).toMatchObject({ linkedMatchId: 'new-match', linkMode: 'new-match' });
    expect(db.matches.map((match: any) => match.id)).toEqual(['m1', 'new-match']);
  });

  it('replaces a uniquely matching anonymous scoreboard row with the accepted roster identity', () => {
    const db = fixture();
    db.playerStats = players.map((observed, index) => ({ id: `anonymous-${index}`, matchId: 'm1', player: `Anonymous player ${index + 1}`, displayNameSnapshot: `player-${Math.random().toString(16).slice(2)}`, agent: 'Unknown', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: observed.kills, deaths: observed.deaths, assists: observed.assists }));
    const submission = integrateVodSubmission(db, { ...input, matchId: 'm1' }, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(submission.integration.createdStats).toBe(0); expect(db.playerStats).toHaveLength(5);
    expect(db.playerStats.map((row: any) => [row.playerId, row.player, row.displayNameSnapshot])).toEqual(roster.map(player => [player.id, player.displayName, player.displayName]));
  });

  it('rejects integration unless five unique active roster identities resolve', () => {
    const db = fixture(); const invalid = { ...input, players: input.players.map((row, index) => index === 4 ? { ...row, observedName: 'unknown-player' } : row) };
    expect(() => integrateVodSubmission(db, invalid, 'caelia', ids)).toThrow(/match exactly one active roster player/i);
  });

  it('retains sampled timeline observations but never promotes timing-sensitive v1 OCR as trusted stats', () => {
    const db = fixture(); const timeline: any = {
      schema: 'moetracker.vod-timeline-evidence/v1', grade: 'video-observation', source: { kind: 'youtube', videoId: 'abcdefghijk', sha256: 'b'.repeat(64), width: 1920, height: 1080, durationMs: 600000, analyzedAt: '2026-10-18T14:00:00Z' },
      coverage: { durationMs: 600000, killFeedSnapshots: 40, objectiveSnapshots: 10, ultimateSnapshots: 20, resolvedEliminations: 25, inferredRoundGroups: 12, signals: { eliminations: 'partial', trades: 'complete', kast: 'complete', ultimateUse: 'partial', orbCapture: 'unsupported', throws: 'unsupported' } },
      observations: [], rounds: [], throwCandidates: [], limitations: [],
      playerMetrics: [{ playerName: 'caelia', team: 'ours', kills: 5, deaths: 4, trades: 3, ultimateUses: 2, orbCaptures: null, kastSuccessful: 8, kastCovered: 10, kastRate: 80 }],
    };
    const submission = integrateVodSubmission(db, { ...input, matchId: 'm1', timelineEvidence: timeline }, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(submission.timelineEvidence?.coverage.signals.trades).toBe('partial');
    expect(submission.timelineEvidence?.coverage.signals.kast).toBe('partial');
    expect(db.playerStats[0]).toMatchObject({ trades: 2 });
    expect(db.playerStats[0].kastSuccessful).toBeUndefined(); expect(db.playerStats[0].kastCovered).toBeUndefined();
    expect(db.playerStats[0].ultimateUses).toBeUndefined(); expect(db.playerStats[0].orbPoints).toBeUndefined();
    expect(db.playerStats[0].vodEvidence.timeline).toMatchObject({ grade: 'video-observation', metrics: { observedKills: 5, ultimateUses: 2 } });
  });

  it('upgrades an existing scoreboard-only submission with later timeline evidence instead of duplicating it', () => {
    const db = fixture(); const first = integrateVodSubmission(db, { ...input, matchId: 'm1' }, 'caelia', ids, '2026-10-18T14:00:00Z');
    const timeline: any = { schema: 'moetracker.vod-timeline-evidence/v1', grade: 'video-observation', source: { kind: 'youtube', videoId: 'abcdefghijk', sha256: 'b'.repeat(64), width: 1920, height: 1080, durationMs: 60_000, analyzedAt: '2026-10-18T14:10:00Z' }, coverage: { durationMs: 60_000, killFeedSnapshots: 2, objectiveSnapshots: 0, ultimateSnapshots: 0, resolvedEliminations: 1, inferredRoundGroups: 1, signals: { eliminations: 'partial', trades: 'partial', kast: 'partial', objectives: 'unsupported', ultimateUse: 'unsupported', orbCapture: 'unsupported', throws: 'unsupported' } }, observations: [], rounds: [], playerMetrics: [], throwCandidates: [], limitations: [] };
    const upgraded = integrateVodSubmission(db, { ...input, timelineEvidence: timeline }, 'caelia', { ...ids, submissionId: 'should-not-be-used' }, '2026-10-18T14:10:00Z');
    expect(upgraded.id).toBe(first.id); expect(upgraded.timelineEvidence).toBeTruthy(); expect(db.vodSubmissions).toHaveLength(1);
  });

  it('materializes accepted v2 VOD rounds and exact lost advantages without overwriting coach results', () => {
    const db = fixture(); db.rounds = [{ id: 'coach-r1', matchId: 'm1', roundNo: 1, side: 'Attack', result: 'W' }];
    const lostEvents = [
      ['theirs'], ['theirs'], ['ours'], ['ours'], ['theirs'], ['theirs'], ['ours'], ['ours'], ['ours'],
    ].map(([victimTeam], index) => ({ id: `e${index}`, kind: 'elimination', timestampMs: 1_000 + index * 1_000, grade: 'video-observation', killer: `killer-${index}`, victim: `victim-${index}`, victimTeam }));
    const timeline: any = { schema: 'moetracker.vod-timeline-evidence/v2', grade: 'video-observation', source: { kind: 'youtube', sha256: 'b'.repeat(64), width: 1920, height: 1080, durationMs: 60_000, analyzedAt: '2026-10-18T14:00:00Z' }, coverage: { durationMs: 60_000, killFeedSnapshots: 20, objectiveSnapshots: 0, ultimateSnapshots: 0, resolvedEliminations: 18, inferredRoundGroups: 2, signals: { eliminations: 'complete', trades: 'partial', kast: 'partial' } }, observations: lostEvents, rounds: [{ roundNumber: 1, startedAtMs: 1_000, endedAtMs: 20_000, events: lostEvents }, { roundNumber: 2, startedAtMs: 30_000, endedAtMs: 50_000, events: lostEvents }], playerMetrics: [], throwCandidates: [], limitations: [] };
    integrateVodSubmission(db, { ...input, matchId: 'm1', timelineEvidence: timeline }, 'caelia', ids, '2026-10-18T14:00:00Z');
    expect(db.rounds.find((round: any) => round.roundNo === 1)).toMatchObject({ id: 'coach-r1', result: 'W', advantageEvidence: { source: 'vod', roundOutcome: 'lost' } });
    expect(db.rounds.find((round: any) => round.roundNo === 2)).toMatchObject({ result: 'L', advantageEvidence: { states: expect.arrayContaining([expect.objectContaining({ label: '5v3', outcome: 'lost' }), expect.objectContaining({ label: '3v1', outcome: 'lost' }), expect.objectContaining({ label: '2v1', outcome: 'lost' })]) } });
    expect(db.matches[0].vodTimelineEvidence.fusion.sourceCount).toBe(1);
  });
});
