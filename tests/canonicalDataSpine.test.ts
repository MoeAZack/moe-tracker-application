import { describe, expect, it } from 'vitest';
import { buildCanonicalDataSpine, serializeCanonicalDataSpine, validateCanonicalDataSpine } from '../lib/canonicalDataSpine';
import { buildIdentityResolver, identityExactKey, identityOcrKey } from '../lib/identityResolver';
import { toPublicTrackerData } from '../lib/publicData';

function fixture() {
  return {
    workspace: { schemaVersion: 1, id: 'ws_stageOneWorkspace001', createdAt: '2026-10-20T00:00:00.000Z' },
    settings: { featureFlags: { canonicalDataSpine: true } },
    rosterPlayers: [
      { id: '11111111-1111-4111-8111-111111111111', displayName: 'bellatr1x', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: '22222222-2222-4222-8222-222222222222', displayName: 'Old Name', createdAt: '2026-09-01T00:00:00.000Z', retiredAt: '2026-10-10T00:00:00.000Z' },
    ],
    tryoutBatches: [{ id: 'batch', aliases: [{ playerId: '11111111-1111-4111-8111-111111111111', alias: 'bella trix' }] }], identityCorrectionBatches: [], seasonArchives: [],
    matches: [{ id: 'm1', date: '2026-10-20', map: 'Ascent', opponent: 'PYO', sourceMetadata: { method: 'manual', capturedAt: '2026-10-20T10:00:00.000Z', externalId: 'manual-1' } }],
    rounds: [{ id: 'r1', matchId: 'm1', roundNo: 1, side: 'Att', result: 'W' }],
    playerStats: [{ id: 's1', matchId: 'm1', player: 'Bellatrix', displayNameSnapshot: 'Bellatrix', agent: 'Omen', sourceMetadata: { method: 'manual', capturedAt: '2026-10-20T10:00:00.000Z' } }],
    analyticsBuilds: { m1: { status: 'recomputed', sourceHash: 'a'.repeat(64), builders: ['map/v1', 'player/v1'] } },
    coreMemberships: [], soloq: [], schedule: [], attendanceCredits: [], goals: [], coachingSignals: [], coachingActions: [], dashboardViews: [], evidenceFusionResolutions: [], calibratedPlayerRatings: [], vodSubmissions: [], vodReviews: [], vetos: [], strats: [], stratRuns: [], secrets: {}, serverTime: '',
  } as any;
}

describe('canonical identity resolver', () => {
  it('uses explicit IDs first, then exact aliases, then OCR-equivalent names without guessing ambiguity', () => {
    const data = fixture(); const resolver = buildIdentityResolver(data);
    expect(identityExactKey('Bélla-Trix')).toBe('bellatrix'); expect(identityOcrKey('Bellatrix')).toBe(identityOcrKey('bellatr1x'));
    expect(resolver.resolve({ playerId: data.rosterPlayers[0].id, observedName: 'anonymous' })).toMatchObject({ status: 'matched', matchedBy: 'explicit-id', playerId: data.rosterPlayers[0].id });
    expect(resolver.resolve({ observedName: 'bella trix' })).toMatchObject({ status: 'matched', matchedBy: 'exact-name' });
    expect(resolver.resolve({ observedName: 'Bellatrix' })).toMatchObject({ status: 'matched', matchedBy: 'exact-name' });
    const withoutAlias = fixture(); withoutAlias.tryoutBatches[0].aliases = [];
    expect(buildIdentityResolver(withoutAlias).resolve({ observedName: 'Bellatrix' })).toMatchObject({ status: 'matched', matchedBy: 'ocr-equivalent' });
    data.rosterPlayers.push({ id: '33333333-3333-4333-8333-333333333333', displayName: 'Bellatrix', createdAt: '2026-10-20T00:00:00.000Z' });
    expect(buildIdentityResolver(data).resolve({ observedName: 'Bellatrix' })).toMatchObject({ status: 'ambiguous', playerId: null });
  });
});

describe('canonical data spine', () => {
  it('joins sources, matches, rounds, appearances, identities and derived builds deterministically', () => {
    const data = fixture(); const first = buildCanonicalDataSpine(data);
    expect(validateCanonicalDataSpine(first)).toEqual({ ok: true, issues: [] });
    expect(first).toMatchObject({ schema: 'moetracker.canonical-data-spine/v1', matches: [{ id: 'm1', roundIds: ['r1'], appearanceIds: ['appearance:s1'] }], rounds: [{ id: 'r1', matchId: 'm1' }], appearances: [{ id: 'appearance:s1', playerId: data.rosterPlayers[0].id, identityStatus: 'matched' }], derivedBuilds: [{ matchId: 'm1', sourceHash: 'a'.repeat(64) }] });
    data.playerStats.reverse(); data.rounds.reverse(); data.rosterPlayers.reverse();
    const second = buildCanonicalDataSpine(data);
    expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
    expect(serializeCanonicalDataSpine(second)).toBe(serializeCanonicalDataSpine(first));
  });

  it('is coach-only and remains fully disabled unless the exact Stage 1 flag is enabled', () => {
    const data = fixture();
    expect(toPublicTrackerData(data, 'coach').canonicalDataSpine).toMatchObject({ schema: 'moetracker.canonical-data-spine/v1' });
    data.settings.featureFlags.canonicalDataSpine = false;
    expect(toPublicTrackerData(data, 'coach')).not.toHaveProperty('canonicalDataSpine');
    data.settings.featureFlags.canonicalDataSpine = true;
    expect(toPublicTrackerData(data, 'player')).not.toHaveProperty('canonicalDataSpine');
  });

  it('fails closed when a derived build or appearance references a missing canonical parent', () => {
    const spine = buildCanonicalDataSpine(fixture());
    spine.matches = [];
    const codes = validateCanonicalDataSpine(spine).issues.map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['missing-match', 'orphan-derived-build']));
  });

  it('loads a workspace whose matches all came from an unnamed VOD import', () => {
    const data = fixture(); const vodSource = { method: 'vod-submission', capturedAt: '2026-10-22T23:22:48.000Z', provider: 'local-ocr', externalId: 'sub-1' };
    data.matches = [{ id: 'vod-m1', date: '2026-10-22', map: 'Haven', opponent: '', source: 'vod-submission', sourceMetadata: vodSource }];
    data.rounds = [{ id: 'vod:vod-m1:round:1', matchId: 'vod-m1', roundNo: 1, side: '', result: '', sourceMetadata: vodSource }];
    data.playerStats = []; data.analyticsBuilds = {};
    const spine = toPublicTrackerData(data, 'coach').canonicalDataSpine;
    expect(spine.matches.map((match: any) => match.id)).toEqual(['vod-m1']);
    expect(spine.sources.every((source: any) => source.types.includes('vod'))).toBe(true);
    expect(validateCanonicalDataSpine(spine)).toEqual({ ok: true, issues: [] });
  });

  it('keeps a VOD-imported stat row on a manual match as its own VOD source', () => {
    const data = fixture();
    data.playerStats[0].sourceMetadata = { method: 'vod-submission', capturedAt: '2026-10-22T23:22:48.000Z', provider: 'local-ocr', externalId: 'sub-2' };
    const spine = buildCanonicalDataSpine(data);
    expect(spine.sources.some(source => source.types.includes('vod') && source.reference.vod)).toBe(true);
  });

  it('leaves the spine out instead of failing the whole workspace when it cannot be built', () => {
    const data = fixture(); delete data.workspace;
    const result = toPublicTrackerData(data, 'coach');
    expect(result).not.toHaveProperty('canonicalDataSpine');
    expect(result.matches).toHaveLength(1);
  });
});
