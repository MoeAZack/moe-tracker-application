import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_REFERENCE_SCHEMA, ensureWorkspaceIdentity, evidenceReferenceForMatch, evidenceReferenceForReplay,
  evidenceReferenceForRound, evidenceReferenceForScreenshotRecord, evidenceReferenceKey, isAcceptedEvidenceReference,
  normalizeEvidenceReference, parseEvidenceReference, resolveEvidenceReference, serializeEvidenceReference,
  validateEvidenceReference, workspaceIdentity, type EvidenceReferenceV1,
} from '../lib/evidenceReference';
import { archiveAndResetSeason } from '../lib/roster';
import { createSeed } from '../lib/seed';
import { validateTrackerState } from '../lib/storageSchema';

// Synthetic fixtures only: no real screenshots, replays, names or device identifiers.
const WS = 'ws_teamAlphaWorkspace0001';
const OTHER_WS = 'ws_teamBravoWorkspace0002';
const REPLAY = 'a'.repeat(64);
const REPLAY_DRAFT = 'b'.repeat(64);
const IMAGE = 'c'.repeat(64);
const EVIDENCE = 'd'.repeat(64);
const CONFIRMED_AT = '2026-10-14T18:30:00.000Z';
const REPLAY_ACCEPTED_AT = '2026-10-14T19:00:00.000Z';

function workspace() {
  const db: any = createSeed();
  db.workspace = { schemaVersion: 1, id: WS, createdAt: '2026-10-01T00:00:00.000Z' };
  db.rosterPlayers = [
    { id: 'player-alpha', displayName: 'Alpha', createdAt: '2026-09-01T00:00:00.000Z', rosterStatus: 'core' },
    { id: 'player-tryout', displayName: 'Trial', createdAt: '2026-09-01T00:00:00.000Z', rosterStatus: 'tryout' },
  ];
  db.coreMemberships = [{ id: 'membership-alpha', playerId: 'player-alpha', joinedAt: '2026-09-01T00:00:00.000Z' }];
  db.matches = [
    { id: 'match-shot', date: '2026-10-14', type: 'Scrim', opponent: 'Opponent', map: 'Ascent', attW: 7, attL: 5, defW: 6, defL: 6, ourScore: 13, theirScore: 11,
      source: 'scrim-import', sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-14T18:00:00.000Z', provider: 'tesseract-local', model: 'tesseract-7/eng/parser-v1' },
      reviewConfirmation: { alliedSideConfirmed: true, confirmedAt: CONFIRMED_AT, confirmedBy: 'coach' },
      screenshotEvidence: { schemaVersion: 1, captureId: '20261014-180000', scoreboardPlayers: [] } },
    { id: 'match-replay', date: '2026-10-14', type: 'Scrim', opponent: 'Opponent', map: 'Bind', attW: null, attL: null, defW: null, defL: null, ourScore: 13, theirScore: 9,
      source: 'Replay review', sourceMetadata: { method: 'provider-import', capturedAt: REPLAY_ACCEPTED_AT, provider: 'vrfkit', externalId: REPLAY } },
    { id: 'match-both', date: '2026-10-14', type: 'Scrim', opponent: 'Opponent', map: 'Haven', attW: 6, attL: 6, defW: 7, defL: 5, ourScore: 13, theirScore: 11,
      source: 'scrim-import', sourceMetadata: { method: 'screenshot', capturedAt: '2026-10-14T17:00:00.000Z', provider: 'tesseract-local', model: 'tesseract-7/eng/parser-v1' },
      reviewConfirmation: { alliedSideConfirmed: true, confirmedAt: CONFIRMED_AT, confirmedBy: 'coach' },
      screenshotEvidence: { schemaVersion: 1, captureId: '20261014-170000', scoreboardPlayers: [] } },
    // Legacy rows predate source metadata entirely.
    { id: 'match-legacy', date: '2026-09-01', type: 'Scrim', opponent: 'Old', map: 'Lotus', attW: 6, attL: 6, defW: 6, defL: 6 },
    { id: 'match-manual', date: '2026-09-02', type: 'Scrim', opponent: 'Old', map: 'Split', attW: null, attL: null, defW: null, defL: null, source: 'manual' },
  ];
  db.playerStats = [
    { id: 'stat-1', matchId: 'match-shot', player: 'Alpha', displayNameSnapshot: 'Alpha', playerId: 'player-alpha', agent: 'Waylay', kills: 20, deaths: 14, assists: 3 },
    { id: 'stat-2', matchId: 'match-shot', player: 'Trial', displayNameSnapshot: 'Trial', playerId: 'player-tryout', agent: 'Viper', kills: null, deaths: null, assists: null },
    { id: 'stat-3', matchId: 'match-shot', player: 'Unmatched Name', playerId: 'name:unmatched name', agent: '' },
    { id: 'stat-4', matchId: 'match-replay', player: 'Alpha', displayNameSnapshot: 'Alpha', playerId: 'player-alpha', agent: 'Raze' },
  ];
  db.rounds = [
    { id: 'round-shot-1', matchId: 'match-shot', roundNo: 1, side: 'Attack', result: 'W',
      screenshotEvidence: { schemaVersion: 1, reviewStatus: 'confirmed', confidence: 'high', players: [], fieldConfidence: { 'round.result': 91, 'player.0.kills': 58.5, 'bad key!': 10, 'player.1.kills': null } } },
    { id: 'round-shot-2', matchId: 'match-shot', roundNo: 2, side: 'Attack', result: 'L' },
  ];
  db.vodReviews = [{ id: 'vod-1', matchId: 'match-shot', title: 'Review', vodUrl: 'https://example.invalid/private', notes: [{ id: 'note-1', seconds: 42, timeLabel: '0:42', text: 'x', name: 'c', role: 'coach', createdAt: CONFIRMED_AT, replies: [] }] }];
  db.engineAdapters = {
    schemaVersion: 1, idempotency: {},
    replay: {
      'match-replay': { matchId: 'match-replay', status: 'accepted', acceptedAt: REPLAY_ACCEPTED_AT, provenance: { replaySha256: REPLAY, rawEvidenceHash: EVIDENCE, parser: { name: 'vrfkit', version: '0.2.5' } } },
      'match-both': { matchId: 'match-both', status: 'accepted', acceptedAt: REPLAY_ACCEPTED_AT, provenance: { replaySha256: 'e'.repeat(64), rawEvidenceHash: null, parser: { name: 'vrfkit', version: '0.2.5' } } },
    },
    screenshot: { 'match-shot': { schemaVersion: 1, status: 'accepted', matchId: 'match-shot', digest: 'x', revision: 1, updatedAt: '2026-10-14T18:20:00.000Z', sourceDeviceId: 'd_coachDevice01' } },
  };
  db.replayIntake = {
    schemaVersion: 5, devices: {}, rawSessions: {}, rawReceipts: {}, pairingCodes: {},
    blobs: {
      [REPLAY]: { sha256: REPLAY, size: 10, storedAt: '2026-10-14T18:40:00.000Z', parserStatus: 'parsed-review-required', reviewStatus: 'accepted', matchId: 'match-replay', parserJobId: 'job-1' },
      [REPLAY_DRAFT]: { sha256: REPLAY_DRAFT, size: 10, storedAt: '2026-10-14T20:00:00.000Z', parserStatus: 'parsed-review-required', reviewStatus: 'review-required', matchId: null, parserJobId: 'job-2', evidenceHash: EVIDENCE },
    },
    associations: { k1: { id: 'a1', sha256: REPLAY_DRAFT, size: 10, originalName: 'x.vrf', deviceId: 'd_playerDevice1', owner: { actorId: 'p', role: 'player', playerId: 'player-alpha' }, receivedAt: '2026-10-14T20:00:00.000Z' } },
    parserJobs: {
      'job-1': { id: 'job-1', parser: { name: 'vrfkit', version: '0.2.5' }, result: { scoreboard: { players: [] } } },
      'job-2': { id: 'job-2', parser: { name: 'vrfkit', version: '0.2.5' }, result: { scoreboard: { players: [
        { playerId: 'pp-1', teamId: 'Blue', agent: { status: 'available', value: 'Jett' } },
        { playerId: 'pp-2', teamId: 'Red', agent: { status: 'unavailable' } },
      ] } } },
    },
    reviews: {
      [REPLAY]: { sha256: REPLAY, matchId: 'match-replay', teamId: 'Blue', mappings: [], status: 'accepted', rawEvidenceHash: EVIDENCE, acceptedAt: REPLAY_ACCEPTED_AT },
      [REPLAY_DRAFT]: { sha256: REPLAY_DRAFT, matchId: 'match-legacy', teamId: 'Blue', status: 'review-required', rawEvidenceHash: EVIDENCE, acceptedAt: null,
        mappings: [{ parserPlayerId: 'pp-1', rosterPlayerId: 'player-alpha', displayName: 'Alpha' }, { parserPlayerId: 'pp-2', rosterPlayerId: null, displayName: 'Enemy' }] },
    },
    screenshots: {
      'shot-record-1': { id: 'shot-record-1', deviceId: 'd_coachDevice01', imageSha256: IMAGE, createdAt: '2026-10-14T21:00:00.000Z', createdBy: 'private-actor', status: 'pending', reviewRequired: true, replaySha256: null, suggestions: [], reason: '',
        draft: { contractVersion: 1, status: 'review-required', reviewRequired: true, sourceMetadata: { method: 'screenshot', provider: 'tesseract-local', model: 'tesseract-7/eng/parser-v1', capturedAt: '2026-10-14T21:00:00.000Z' },
          match: {}, rounds: [], stats: [
            { extractedName: 'Alpha', matchedPlayerId: 'player-alpha', rosterMatch: { status: 'matched', candidatePlayerIds: ['player-alpha'] }, agent: 'Waylay' },
            { extractedName: 'Alpah', matchedPlayerId: null, rosterMatch: { status: 'ambiguous', candidatePlayerIds: ['player-alpha', 'player-tryout'] }, agent: null },
          ] } },
    },
  };
  return db;
}

const opts = { workspaceId: WS };

function baseReference(overrides: Partial<EvidenceReferenceV1> = {}): any {
  return {
    schema: EVIDENCE_REFERENCE_SCHEMA, scope: { workspaceId: WS, ownerDeviceId: null }, state: 'accepted', sourceTypes: ['screenshot'],
    matchId: 'match-shot', round: null, captureSessionId: null, screenshot: null, replay: null, vod: null,
    producer: { parser: null, ocr: null, capture: null }, capturedAt: null, acceptedAt: CONFIRMED_AT,
    observedIdentities: [], confidence: null, fieldProvenance: null, ...overrides,
  };
}

describe('S0.1 canonical evidence reference', () => {
  it('references accepted screenshot evidence with capture session, OCR version and Cairo-safe UTC timestamps', () => {
    const db = workspace();
    const reference = evidenceReferenceForMatch(db, 'match-shot', opts);
    expect(reference).toMatchObject({
      schema: 'moetracker.evidence-reference/v1', state: 'accepted', sourceTypes: ['screenshot'], matchId: 'match-shot',
      captureSessionId: '20261014-180000', replay: null, scope: { workspaceId: WS, ownerDeviceId: 'd_coachDevice01' },
      producer: { parser: null, ocr: 'tesseract-local@tesseract-7/eng/parser-v1', capture: null },
      capturedAt: '2026-10-14T18:00:00.000Z', acceptedAt: '2026-10-14T18:30:00.000Z',
    });
    expect(isAcceptedEvidenceReference(reference)).toBe(true);
    const resolved = resolveEvidenceReference(db, reference, opts);
    expect(resolved).toMatchObject({ ok: true, storedState: 'accepted', match: { id: 'match-shot', location: 'active', archiveId: null } });
  });

  it('keeps round-level OCR confidence as field provenance without inventing missing confidences', () => {
    const db = workspace();
    const reference = evidenceReferenceForRound(db, 'match-shot', { roundNumber: 1 }, opts);
    expect(reference.round).toEqual({ roundId: 'round-shot-1', roundNumber: 1 });
    expect(reference.screenshot).toEqual({ artifactId: null, imageSha256: null, captureKind: 'round', cropRegionId: null });
    expect(reference.confidence).toBe('high');
    expect(reference.fieldProvenance).toEqual({
      'player.0.kills': { source: 'screenshot', confidence: 58.5 },
      'player.1.kills': { source: 'screenshot', confidence: null },
      'round.result': { source: 'screenshot', confidence: 91 },
    });
    expect(resolveEvidenceReference(db, reference, opts)).toMatchObject({ ok: true, round: { id: 'round-shot-1', roundNumber: 1 } });
    // A round with no retained screenshot evidence keeps confidence unknown.
    const plain = evidenceReferenceForRound(db, 'match-shot', { roundId: 'round-shot-2' }, opts);
    expect(plain).toMatchObject({ confidence: null, fieldProvenance: null, screenshot: null, round: { roundNumber: 2 } });
    expect(() => evidenceReferenceForRound(db, 'match-shot', { roundNumber: 9 }, opts)).toThrow(/round-not-found/);
  });

  it('keeps review-required rounds draft until both the round and match are confirmed', () => {
    const db = workspace();
    db.rounds[0].screenshotEvidence.reviewStatus = 'review-required';
    const draft = evidenceReferenceForRound(db, 'match-shot', { roundNumber: 1 }, opts);
    expect(draft).toMatchObject({ state: 'draft', acceptedAt: null, screenshot: { captureKind: 'round' } });
    expect(resolveEvidenceReference(db, draft, opts)).toMatchObject({ ok: true, storedState: 'draft' });
    expect(resolveEvidenceReference(db, { ...draft, state: 'accepted', acceptedAt: CONFIRMED_AT }, opts)).toEqual({ ok: false, reason: 'state-mismatch' });

    // A draft reference remains usable after the exact retained evidence is accepted.
    db.rounds[0].screenshotEvidence.reviewStatus = 'confirmed';
    expect(resolveEvidenceReference(db, draft, opts)).toMatchObject({ ok: true, storedState: 'accepted' });

    delete db.matches[0].reviewConfirmation;
    delete db.engineAdapters.screenshot['match-shot'];
    const unconfirmedMatch = evidenceReferenceForRound(db, 'match-shot', { roundNumber: 1 }, opts);
    expect(unconfirmedMatch).toMatchObject({ state: 'draft', acceptedAt: null });
    expect(resolveEvidenceReference(db, { ...unconfirmedMatch, state: 'accepted', acceptedAt: CONFIRMED_AT }, opts)).toEqual({ ok: false, reason: 'state-mismatch' });
  });

  it('references accepted replay evidence by SHA-256 and parser version, not as a separate provider import', () => {
    const db = workspace();
    const fromMatch = evidenceReferenceForMatch(db, 'match-replay', opts);
    expect(fromMatch).toMatchObject({ state: 'accepted', sourceTypes: ['replay'], replay: { sha256: REPLAY, evidenceSha256: EVIDENCE }, producer: { parser: 'vrfkit@0.2.5' }, acceptedAt: REPLAY_ACCEPTED_AT });
    expect(resolveEvidenceReference(db, fromMatch, opts)).toMatchObject({ ok: true, storedState: 'accepted', replay: { sha256: REPLAY, status: 'accepted' } });
    const fromReplay = evidenceReferenceForReplay(db, REPLAY.toUpperCase(), opts);
    expect(fromReplay).toMatchObject({ state: 'accepted', matchId: 'match-replay', replay: { sha256: REPLAY }, acceptedAt: REPLAY_ACCEPTED_AT });
    expect(resolveEvidenceReference(db, fromReplay, opts)).toMatchObject({ ok: true, storedState: 'accepted' });
  });

  it('combines screenshot and replay sources only when both are accepted', () => {
    const db = workspace();
    const both = evidenceReferenceForMatch(db, 'match-both', opts);
    expect(both).toMatchObject({ state: 'accepted', sourceTypes: ['replay', 'screenshot'], captureSessionId: '20261014-170000', replay: { sha256: 'e'.repeat(64) }, producer: { parser: 'vrfkit@0.2.5', ocr: 'tesseract-local@tesseract-7/eng/parser-v1' } });
    // acceptedAt is when the combined evidence became accepted: the later of the two acceptances.
    expect(both.acceptedAt).toBe(REPLAY_ACCEPTED_AT);
    expect(resolveEvidenceReference(db, both, opts)).toMatchObject({ ok: true, replay: { status: 'accepted' } });
    db.engineAdapters.replay['match-both'].status = 'review-required';
    const screenshotOnly = evidenceReferenceForMatch(db, 'match-both', opts);
    expect(screenshotOnly).toMatchObject({ sourceTypes: ['screenshot'], replay: null });
    // The previously issued combined reference may no longer claim acceptance.
    expect(resolveEvidenceReference(db, both, opts)).toEqual({ ok: false, reason: 'replay-not-found' });
  });

  it('distinguishes draft and rejected evidence from accepted evidence', () => {
    const db = workspace();
    const draftShot = evidenceReferenceForScreenshotRecord(db, 'shot-record-1', opts);
    expect(draftShot).toMatchObject({ state: 'draft', acceptedAt: null, sourceTypes: ['screenshot'], screenshot: { artifactId: 'shot-record-1', imageSha256: IMAGE, captureKind: 'scoreboard' }, scope: { ownerDeviceId: 'd_coachDevice01' } });
    expect(JSON.stringify(draftShot)).not.toContain('private-actor');
    expect(isAcceptedEvidenceReference(draftShot)).toBe(false);
    expect(resolveEvidenceReference(db, draftShot, opts)).toMatchObject({ ok: true, storedState: 'draft' });

    const draftReplay = evidenceReferenceForReplay(db, REPLAY_DRAFT, opts);
    expect(draftReplay).toMatchObject({ state: 'draft', acceptedAt: null, matchId: 'match-legacy', replay: { sha256: REPLAY_DRAFT, evidenceSha256: EVIDENCE }, scope: { ownerDeviceId: 'd_playerDevice1' } });
    expect(resolveEvidenceReference(db, draftReplay, opts)).toMatchObject({ ok: true, storedState: 'draft', replay: { status: 'review-required' } });

    // Claiming acceptance for draft storage is refused rather than trusted.
    expect(resolveEvidenceReference(db, { ...draftReplay, state: 'accepted', acceptedAt: CONFIRMED_AT }, opts)).toEqual({ ok: false, reason: 'state-mismatch' });
    expect(resolveEvidenceReference(db, { ...draftShot, state: 'accepted', acceptedAt: CONFIRMED_AT }, opts)).toEqual({ ok: false, reason: 'state-mismatch' });
    // Pointing an accepted match reference at a draft screenshot record cannot launder it into accepted evidence.
    expect(resolveEvidenceReference(db, baseReference({ screenshot: { artifactId: 'shot-record-1', imageSha256: IMAGE, captureKind: 'scoreboard', cropRegionId: null } }), opts)).toEqual({ ok: false, reason: 'state-mismatch' });

    // An unconfirmed screenshot match is draft, never accepted.
    delete db.matches[0].reviewConfirmation; delete db.engineAdapters.screenshot['match-shot'];
    expect(evidenceReferenceForMatch(db, 'match-shot', opts)).toMatchObject({ state: 'draft', acceptedAt: null });

    const rejected = normalizeEvidenceReference(baseReference({ state: 'rejected', acceptedAt: null, matchId: null, captureSessionId: '20261014-180000' }));
    expect(rejected.state).toBe('rejected');
    expect(isAcceptedEvidenceReference(rejected)).toBe(false);
    expect(validateEvidenceReference({ ...rejected, acceptedAt: CONFIRMED_AT })).toMatchObject({ ok: false, issues: [{ path: 'acceptedAt', code: 'only-when-accepted' }] });
    expect(validateEvidenceReference({ ...draftShot, acceptedAt: CONFIRMED_AT })).toMatchObject({ ok: false, issues: [{ path: 'acceptedAt', code: 'only-when-accepted' }] });
    expect(resolveEvidenceReference(db, { ...draftReplay, state: 'rejected' }, opts)).toEqual({ ok: false, reason: 'state-mismatch' });
    db.replayIntake.screenshots['shot-record-1'].status = 'rejected';
    expect(resolveEvidenceReference(db, { ...draftShot, state: 'rejected' }, opts)).toMatchObject({ ok: true, storedState: 'rejected' });
  });

  it('never substitutes capture time for an unknown acceptance time', () => {
    const db = workspace();
    db.matches.push({ id: 'match-import-no-acceptance', source: 'import', sourceMetadata: { method: 'provider-import', capturedAt: '2026-10-14T17:15:00.000Z', provider: 'other' } });
    expect(evidenceReferenceForMatch(db, 'match-import-no-acceptance', opts)).toMatchObject({ state: 'accepted', capturedAt: '2026-10-14T17:15:00.000Z', acceptedAt: null });
  });

  it('fails closed for locator details that current storage cannot substantiate', () => {
    const db = workspace();
    const artifact = evidenceReferenceForScreenshotRecord(db, 'shot-record-1', opts);
    expect(resolveEvidenceReference(db, baseReference({ matchId: null, acceptedAt: null, state: 'draft', captureSessionId: 'unbacked-session' }), opts)).toEqual({ ok: false, reason: 'capture-session-mismatch' });
    expect(resolveEvidenceReference(db, { ...artifact, screenshot: { ...artifact.screenshot!, captureKind: 'performance' } }, opts)).toEqual({ ok: false, reason: 'screenshot-not-found' });
    expect(resolveEvidenceReference(db, { ...artifact, screenshot: { ...artifact.screenshot!, cropRegionId: 'crop-unbacked' } }, opts)).toEqual({ ok: false, reason: 'screenshot-not-found' });
    expect(resolveEvidenceReference(db, baseReference({ captureSessionId: '20261014-180000', screenshot: { artifactId: null, imageSha256: IMAGE, captureKind: 'scoreboard', cropRegionId: null } }), opts)).toEqual({ ok: false, reason: 'screenshot-not-found' });
    expect(resolveEvidenceReference(db, baseReference({ sourceTypes: ['screenshot', 'vod'], vod: { vodReviewId: null, noteId: 'note-1', atSeconds: 42 } }), opts)).toEqual({ ok: false, reason: 'vod-not-found' });
    expect(resolveEvidenceReference(db, baseReference({ round: { roundId: 'round-shot-2', roundNumber: 2 }, screenshot: { artifactId: null, imageSha256: null, captureKind: 'round', cropRegionId: null } }), opts)).toEqual({ ok: false, reason: 'screenshot-not-found' });
  });

  it('resolves a VOD-imported match by its match id and refuses that anchor on a match with no VOD evidence', () => {
    const db = workspace();
    db.matches.push({ id: 'match-vod-import', source: 'vod-submission', sourceMetadata: { method: 'vod-submission', capturedAt: '2026-10-22T23:22:48.000Z', provider: 'local-ocr', externalId: 'sub-1' } });
    const reference = evidenceReferenceForMatch(db, 'match-vod-import', opts);
    expect(reference.vod).toEqual({ vodReviewId: null, noteId: null, atSeconds: null });
    expect(resolveEvidenceReference(db, reference, opts)).toMatchObject({ ok: true, match: { id: 'match-vod-import' }, vod: { vodReviewId: null, matchId: 'match-vod-import' } });
    db.matches.push({ id: 'match-manual-only', source: 'manual', sourceMetadata: { method: 'manual', capturedAt: '2026-10-22T23:22:48.000Z' } });
    expect(resolveEvidenceReference(db, { ...reference, matchId: 'match-manual-only' }, opts)).toEqual({ ok: false, reason: 'vod-not-found' });
    db.playerStats.push({ id: 'stat-vod-row', matchId: 'match-manual-only', sourceMetadata: { method: 'vod-submission', capturedAt: '2026-10-22T23:22:48.000Z' } });
    expect(resolveEvidenceReference(db, { ...reference, matchId: 'match-manual-only' }, opts)).toMatchObject({ ok: true, vod: { vodReviewId: null, matchId: 'match-manual-only' } });
  });

  it('rechecks replay evidence hashes and stored source-device claims', () => {
    const db = workspace();
    const accepted = evidenceReferenceForReplay(db, REPLAY, opts);
    expect(resolveEvidenceReference(db, { ...accepted, replay: { ...accepted.replay!, evidenceSha256: 'f'.repeat(64) } }, opts)).toEqual({ ok: false, reason: 'replay-evidence-mismatch' });
    const draft = evidenceReferenceForReplay(db, REPLAY_DRAFT, opts);
    expect(resolveEvidenceReference(db, { ...draft, replay: { ...draft.replay!, evidenceSha256: 'f'.repeat(64) } }, opts)).toEqual({ ok: false, reason: 'replay-evidence-mismatch' });
    expect(resolveEvidenceReference(db, { ...draft, scope: { ...draft.scope, ownerDeviceId: 'd_wrongDevice01' } }, opts)).toEqual({ ok: false, reason: 'owner-device-mismatch' });
    const shot = evidenceReferenceForScreenshotRecord(db, 'shot-record-1', opts);
    expect(resolveEvidenceReference(db, { ...shot, scope: { ...shot.scope, ownerDeviceId: 'd_wrongDevice01' } }, opts)).toEqual({ ok: false, reason: 'owner-device-mismatch' });
  });

  it('keeps missing optional data null and never converts it to zero', () => {
    const minimal = normalizeEvidenceReference({ schema: EVIDENCE_REFERENCE_SCHEMA, scope: { workspaceId: WS }, state: 'draft', sourceTypes: ['screenshot'], captureSessionId: 'cap-1' });
    expect(minimal).toEqual({
      schema: EVIDENCE_REFERENCE_SCHEMA, scope: { workspaceId: WS, ownerDeviceId: null }, state: 'draft', sourceTypes: ['screenshot'],
      matchId: null, round: null, captureSessionId: 'cap-1', screenshot: null, replay: null, vod: null,
      producer: { parser: null, ocr: null, capture: null }, capturedAt: null, acceptedAt: null,
      observedIdentities: [], confidence: null, fieldProvenance: null,
    });
    const blanks = normalizeEvidenceReference(baseReference({ round: { roundId: '', roundNumber: 3 } as any, observedIdentities: [{ playerId: '', observedName: ' Alpha ', agent: '', team: null } as any] }));
    expect(blanks.round).toEqual({ roundId: null, roundNumber: 3 });
    expect(blanks.observedIdentities).toEqual([{ playerId: null, observedName: 'Alpha', agent: null, team: null }]);
    // Legacy matches without source metadata stay explicitly unknown rather than guessed.
    const db = workspace();
    expect(evidenceReferenceForMatch(db, 'match-legacy', opts)).toMatchObject({ sourceTypes: ['unknown'], capturedAt: null, captureSessionId: null, replay: null, observedIdentities: [] });
    // Legacy accepted rows never recorded when they were accepted; that stays unknown.
    expect(evidenceReferenceForMatch(db, 'match-manual', opts)).toMatchObject({ state: 'accepted', sourceTypes: ['manual'], capturedAt: null, acceptedAt: null });
    expect(validateEvidenceReference(baseReference({ round: { roundId: null, roundNumber: 0 } }))).toMatchObject({ ok: false, issues: [{ path: 'round.roundNumber', code: 'invalid-integer' }] });
    expect(validateEvidenceReference(baseReference({ round: { roundId: null, roundNumber: '3' as any } }))).toMatchObject({ ok: false, issues: [{ path: 'round.roundNumber', code: 'invalid-integer' }] });
  });

  it('rejects invalid source identifiers and source claims without evidence', () => {
    const cases: Array<[any, string, string]> = [
      [baseReference({ sourceTypes: ['replay'], replay: { sha256: 'not-a-hash', evidenceSha256: null } }), 'replay.sha256', 'invalid-sha256'],
      [baseReference({ sourceTypes: ['replay'] }), 'sourceTypes', 'replay-without-sha256'],
      [baseReference({ matchId: '../other-team/match' }), 'matchId', 'invalid-identifier'],
      [baseReference({ captureSessionId: 'cap 1' }), 'captureSessionId', 'invalid-identifier'],
      [baseReference({ screenshot: { artifactId: 'x', imageSha256: 'zz', captureKind: null, cropRegionId: null } }), 'screenshot.imageSha256', 'invalid-sha256'],
      [baseReference({ screenshot: { artifactId: 'x', imageSha256: null, captureKind: 'minimap' as any, cropRegionId: null } }), 'screenshot.captureKind', 'invalid-enum'],
      [baseReference({ sourceTypes: ['replay'], screenshot: { artifactId: 'x', imageSha256: null, captureKind: null, cropRegionId: null }, replay: { sha256: REPLAY, evidenceSha256: null } }), 'screenshot', 'source-type-missing'],
      [baseReference({ sourceTypes: ['scraped' as any] }), 'sourceTypes[0]', 'invalid-enum'],
      [baseReference({ sourceTypes: ['unknown', 'manual'] }), 'sourceTypes', 'unknown-must-be-alone'],
      [baseReference({ sourceTypes: [] }), 'sourceTypes', 'required'],
      [baseReference({ scope: { workspaceId: 'team-1', ownerDeviceId: null } }), 'scope.workspaceId', 'invalid-identifier'],
      [baseReference({ scope: { workspaceId: '', ownerDeviceId: null } as any }), 'scope.workspaceId', 'required'],
      [baseReference({ observedIdentities: [{ playerId: 'name:alpha', observedName: 'Alpha', agent: null, team: 'ours' }] }), 'observedIdentities[0].playerId', 'invalid-identifier'],
      [baseReference({ observedIdentities: [{ playerId: null, observedName: '', agent: null, team: null }] }), 'observedIdentities[0].observedName', 'required'],
      [baseReference({ fieldProvenance: { kills: { source: 'replay', confidence: 50 } } }), 'fieldProvenance.kills.source', 'not-in-source-types'],
      [baseReference({ fieldProvenance: { kills: { source: 'screenshot', confidence: 150 } } }), 'fieldProvenance.kills.confidence', 'invalid-number'],
      [baseReference({ capturedAt: '14/10/2026' }), 'capturedAt', 'invalid-timestamp'],
      [{ ...baseReference(), rawImage: 'base64...' }, 'rawImage', 'unknown-field'],
      [baseReference({ matchId: null }), '', 'no-evidence-anchor'],
    ];
    for (const [input, pathName, code] of cases) {
      const result = validateEvidenceReference(input);
      expect(result.ok, `${pathName} ${code}`).toBe(false);
      expect((result as any).issues, `${pathName} ${code}`).toContainEqual({ path: pathName, code });
    }
    expect(validateEvidenceReference({ ...baseReference(), schema: 'moetracker.evidence-reference/v2' })).toEqual({ ok: false, issues: [{ path: 'schema', code: 'unsupported-schema' }] });
    expect(validateEvidenceReference(null)).toEqual({ ok: false, issues: [{ path: '', code: 'invalid-object' }] });
    expect(() => evidenceReferenceForReplay(workspace(), 'abc', opts)).toThrow(/invalid-replay-sha256/);
    expect(() => parseEvidenceReference('{not json')).toThrow(/invalid-json/);
    // Unknown storage identifiers do not resolve.
    const db = workspace();
    expect(resolveEvidenceReference(db, baseReference({ matchId: 'match-missing' }), opts)).toEqual({ ok: false, reason: 'match-not-found' });
    expect(resolveEvidenceReference(db, baseReference({ captureSessionId: '20261014-999999' }), opts)).toEqual({ ok: false, reason: 'capture-session-mismatch' });
    expect(resolveEvidenceReference(db, { ...evidenceReferenceForScreenshotRecord(db, 'shot-record-1', opts), screenshot: { artifactId: 'shot-record-1', imageSha256: 'f'.repeat(64), captureKind: 'scoreboard', cropRegionId: null } }, opts)).toEqual({ ok: false, reason: 'screenshot-not-found' });
    expect(resolveEvidenceReference(db, baseReference({ state: 'draft', acceptedAt: null, sourceTypes: ['replay', 'screenshot'], replay: { sha256: REPLAY_DRAFT, evidenceSha256: null } }), opts)).toEqual({ ok: false, reason: 'replay-match-mismatch' });
    expect(resolveEvidenceReference(db, baseReference({ sourceTypes: ['screenshot', 'vod'], vod: { vodReviewId: 'vod-1', noteId: 'note-missing', atSeconds: 42 } }), opts)).toEqual({ ok: false, reason: 'vod-not-found' });
    expect(resolveEvidenceReference(db, baseReference({ sourceTypes: ['screenshot', 'vod'], vod: { vodReviewId: 'vod-1', noteId: 'note-1', atSeconds: 42 } }), opts)).toMatchObject({ ok: true, vod: { vodReviewId: 'vod-1' } });
  });

  it('never resolves or builds another team’s evidence', () => {
    const db = workspace();
    const own = evidenceReferenceForMatch(db, 'match-shot', opts);
    const foreign = { ...own, scope: { workspaceId: OTHER_WS, ownerDeviceId: null } };
    expect(resolveEvidenceReference(db, foreign, opts)).toEqual({ ok: false, reason: 'cross-workspace' });
    expect(resolveEvidenceReference(db, foreign, { workspaceId: OTHER_WS })).toEqual({ ok: false, reason: 'cross-workspace' });
    expect(resolveEvidenceReference(db, own, { workspaceId: OTHER_WS })).toEqual({ ok: false, reason: 'cross-workspace' });
    expect(() => evidenceReferenceForMatch(db, 'match-shot', { workspaceId: OTHER_WS })).toThrow(/cross-workspace/);
    expect(() => evidenceReferenceForReplay(db, REPLAY, { workspaceId: OTHER_WS })).toThrow(/cross-workspace/);
    // A workspace without a persisted identity fails closed instead of matching anything.
    delete db.workspace;
    expect(resolveEvidenceReference(db, own, opts)).toEqual({ ok: false, reason: 'workspace-unidentified' });
    expect(() => evidenceReferenceForMatch(db, 'match-shot', opts)).toThrow(/workspace-unidentified/);
  });

  it('preserves observed names and agents through rename, tryout promotion, archival and season reset', () => {
    const db = workspace();
    const reference = evidenceReferenceForMatch(db, 'match-shot', opts);
    expect(reference.observedIdentities).toEqual([
      { playerId: 'player-alpha', observedName: 'Alpha', agent: 'Waylay', team: 'ours' },
      { playerId: 'player-tryout', observedName: 'Trial', agent: 'Viper', team: 'ours' },
      // An unmatched capture key is not promoted to a roster identity.
      { playerId: null, observedName: 'Unmatched Name', agent: null, team: 'ours' },
    ]);
    const before = serializeEvidenceReference(reference);
    db.rosterPlayers[0].displayName = 'Alpha Renamed';
    db.rosterPlayers[0].retiredAt = '2026-10-15T00:00:00.000Z';
    db.rosterPlayers[1].rosterStatus = 'core';
    db.playerStats[0].player = 'Alpha Renamed';
    const resolved: any = resolveEvidenceReference(db, reference, opts);
    expect(resolved.ok).toBe(true);
    expect(resolved.identities[0]).toEqual({ observed: { playerId: 'player-alpha', observedName: 'Alpha', agent: 'Waylay', team: 'ours' }, current: { playerId: 'player-alpha', displayName: 'Alpha Renamed', status: 'archived' } });
    expect(resolved.identities[1].current).toEqual({ playerId: 'player-tryout', displayName: 'Trial', status: 'core' });
    expect(resolved.identities[2].current).toBeNull();
    expect(serializeEvidenceReference(reference)).toBe(before);
    // The rebuilt reference keeps the accepted snapshot, not the later roster display name.
    expect(evidenceReferenceForMatch(db, 'match-shot', opts).observedIdentities[0].observedName).toBe('Alpha');

    archiveAndResetSeason(db, 'Season One', 'Season Two', () => 'archive-1', () => '2026-10-15T01:00:00.000Z');
    expect(db.matches).toEqual([]);
    expect(workspaceIdentity(db)).toBe(WS);
    const archived: any = resolveEvidenceReference(db, reference, opts);
    expect(archived).toMatchObject({ ok: true, storedState: 'accepted', match: { id: 'match-shot', location: 'archived', archiveId: 'archive-1' } });
    expect(archived.identities[0].current).toMatchObject({ playerId: 'player-alpha', status: 'archived' });
    expect(evidenceReferenceForMatch(db, 'match-shot', opts).observedIdentities[0]).toEqual({ playerId: 'player-alpha', observedName: 'Alpha', agent: 'Waylay', team: 'ours' });
    // Accepted replay evidence moves with the archived match and still verifies.
    expect(resolveEvidenceReference(db, evidenceReferenceForMatch(db, 'match-replay', opts), opts)).toMatchObject({ ok: true, replay: { status: 'accepted' }, match: { location: 'archived' } });
  });

  it('serializes deterministically and round-trips without drift', () => {
    const db = workspace();
    const references = [
      evidenceReferenceForMatch(db, 'match-both', opts), evidenceReferenceForRound(db, 'match-shot', { roundNumber: 1 }, opts),
      evidenceReferenceForScreenshotRecord(db, 'shot-record-1', opts), evidenceReferenceForReplay(db, REPLAY_DRAFT, opts),
    ];
    for (const reference of references) {
      const text = serializeEvidenceReference(reference);
      const parsed = parseEvidenceReference(text);
      expect(parsed).toEqual(reference);
      expect(serializeEvidenceReference(parsed)).toBe(text);
      expect(evidenceReferenceKey(parsed)).toBe(evidenceReferenceKey(reference));
      expect(evidenceReferenceKey(reference)).toMatch(/^[a-f0-9]{64}$/);
    }
    // Key order, duplicate source types, upper-case hashes and timestamp offsets normalize to one form.
    const shuffled = { acceptedAt: '2026-10-14T21:30:00+03:00', sourceTypes: ['screenshot', 'replay', 'screenshot'], replay: { evidenceSha256: null, sha256: REPLAY.toUpperCase() },
      matchId: 'match-shot', state: 'accepted', scope: { ownerDeviceId: null, workspaceId: WS }, schema: EVIDENCE_REFERENCE_SCHEMA };
    const normalized = normalizeEvidenceReference(shuffled);
    expect(normalized).toMatchObject({ sourceTypes: ['replay', 'screenshot'], replay: { sha256: REPLAY }, acceptedAt: '2026-10-14T18:30:00.000Z' });
    expect(serializeEvidenceReference(normalized)).toBe(serializeEvidenceReference(normalizeEvidenceReference(JSON.parse(JSON.stringify(normalized)))));
    expect(evidenceReferenceKey(normalized)).not.toBe(evidenceReferenceKey({ ...normalized, state: 'draft', acceptedAt: null }));
    // No raw evidence, file paths, VOD URLs or private actor identifiers leak into any reference.
    const all = references.map(reference => serializeEvidenceReference(reference)).join('\n');
    for (const forbidden of ['example.invalid', 'private-actor', 'x.vrf', 'base64', 'vodUrl', 'token']) expect(all).not.toContain(forbidden);
  });

  it('works with existing records without rewriting them', () => {
    const db = workspace();
    const snapshot = JSON.stringify(db);
    for (const id of ['match-shot', 'match-replay', 'match-both', 'match-legacy', 'match-manual']) {
      const reference = evidenceReferenceForMatch(db, id, opts);
      expect(validateEvidenceReference(reference).ok).toBe(true);
      expect(resolveEvidenceReference(db, reference, opts).ok).toBe(true);
    }
    evidenceReferenceForScreenshotRecord(db, 'shot-record-1', opts); evidenceReferenceForReplay(db, REPLAY_DRAFT, opts);
    expect(JSON.stringify(db)).toBe(snapshot);
    expect(validateTrackerState(structuredClone(db))).toBeTruthy();
  });
});

describe('workspace identity compatibility', () => {
  let tempDir = '';
  afterEach(async () => {
    vi.resetModules(); vi.unstubAllEnvs();
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = '';
  });

  it('mints one identity, never replaces it and refuses malformed identities', () => {
    const db: any = {};
    expect(workspaceIdentity(db)).toBeNull();
    const id = ensureWorkspaceIdentity(db, '2026-10-15T00:00:00.000Z', () => 'abcdefghijklmnopqrstuvwx');
    expect(id).toBe('ws_abcdefghijklmnopqrstuvwx');
    expect(db.workspace).toEqual({ schemaVersion: 1, id, createdAt: '2026-10-15T00:00:00.000Z' });
    expect(ensureWorkspaceIdentity(db, '2027-01-01T00:00:00.000Z', () => 'zzzzzzzzzzzzzzzzzzzzzzzz')).toBe(id);
    expect(() => ensureWorkspaceIdentity({ workspace: { id: 'other-team' } })).toThrow(/malformed/);
    expect(() => validateTrackerState({ workspace: { schemaVersion: 1, id: 'nope', createdAt: 'x' } })).toThrow(/workspace identity/);
    expect(validateTrackerState({ settings: {} })).toBeTruthy();
  });

  it('persists the identity on the first write of an existing database and keeps it stable', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-workspace-'));
    const dbPath = path.join(tempDir, 'db.json');
    await fs.writeFile(dbPath, JSON.stringify({ settings: {}, matches: [{ id: 'legacy-match' }] }));
    vi.stubEnv('DB_PATH', dbPath); 
    const { readDB, saveDB, replaceDB } = await import('../lib/store');
    const legacy = await readDB();
    expect(workspaceIdentity(legacy)).toBeNull();
    expect(workspaceIdentity(await readDB())).toBeNull();
    await saveDB(legacy);
    const minted = workspaceIdentity(legacy);
    expect(minted).toMatch(/^ws_/);
    const reread = await readDB();
    expect(workspaceIdentity(reread)).toBe(minted);
    expect(reread.matches).toEqual([{ id: 'legacy-match' }]);
    reread.matches.push({ id: 'new-match' });
    await saveDB(reread);
    expect(workspaceIdentity(await readDB())).toBe(minted);
    // A complete replacement carrying its own workspace keeps that workspace (restore semantics).
    await replaceDB({ settings: {}, matches: [], workspace: { schemaVersion: 1, id: OTHER_WS, createdAt: '2026-10-01T00:00:00.000Z' } });
    expect(workspaceIdentity(await readDB())).toBe(OTHER_WS);
  });

  it('gives a fresh installation an identity at first boot', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moetracker-workspace-fresh-'));
    vi.stubEnv('DB_PATH', path.join(tempDir, 'db.json')); 
    const { readDB } = await import('../lib/store');
    const first = workspaceIdentity(await readDB());
    expect(first).toMatch(/^ws_[A-Za-z0-9_-]{16,64}$/);
    expect(workspaceIdentity(await readDB())).toBe(first);
  });
});
