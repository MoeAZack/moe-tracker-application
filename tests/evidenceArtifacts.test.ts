import { describe, expect, it } from 'vitest';
import { evidenceArtifactReferences, evidenceStorageFootprint, externalizeEvidenceArtifacts, hydrateEvidenceArtifacts, planArtifactCollection } from '../lib/evidenceArtifacts';
import { archiveAndResetSeason, restoreSeasonArchive } from '../lib/roster';
import { createSeed } from '../lib/seed';

function season(matchCount = 1) {
  const matches = Array.from({ length: matchCount }, (_, index) => ({ id: `m${index}`, map: 'Ascent', date: '2026-10-20' }));
  const rounds = matches.flatMap(match => Array.from({ length: 24 }, (_, round) => ({
    id: `${match.id}-r${round + 1}`, matchId: match.id, roundNo: round + 1, result: round % 2 ? 'W' : 'L',
    screenshotEvidence: { reviewStatus: 'confirmed', players: Array.from({ length: 10 }, (_, player) => ({ playerId: `p${player}`, equippedWeapon: 'Vandal', bank: 3200, loadoutValue: 4700 })), events: Array.from({ length: 8 }, (_, event) => ({ sequence: event + 1, killerPlayerId: `p${event}`, victimPlayerId: `p${event + 1}` })) },
  })));
  return { _storage: { schemaVersion: 14 }, settings: {}, matches, rounds, analyticsBuilds: Object.fromEntries(matches.map(match => [match.id, { matchId: match.id, intelligence: { rounds: rounds.filter(round => round.matchId === match.id), report: 'x'.repeat(4000) } }])), engineAdapters: { replay: {} }, replayIntake: { parserJobs: {} }, seasonArchives: [] };
}

describe('Storage v2 evidence artifacts', () => {
  it('externalizes and losslessly hydrates match evidence by content hash', async () => {
    const source = season(2); const planned = externalizeEvidenceArtifacts(source); const payloads = new Map(planned.artifacts.map(item => [item.sha256, item.json]));
    expect(evidenceArtifactReferences(planned.state).size).toBeGreaterThan(2);
    expect(JSON.stringify(planned.state).length).toBeLessThan(JSON.stringify(source).length / 3);
    await hydrateEvidenceArtifacts(planned.state, async sha => payloads.get(sha)!);
    expect(planned.state.rounds).toEqual(source.rounds);
    expect(planned.state.analyticsBuilds).toEqual(source.analyticsBuilds);
  });

  it('keeps a 100-match season active index below the old D1 write wall', () => {
    const footprint = evidenceStorageFootprint(season(100));
    expect(footprint.indexCharacters).toBeLessThan(32 * 200_000);
    expect(footprint.artifactCount).toBeGreaterThan(100);
    expect(footprint.artifactStoredBytes).toBeLessThan(footprint.artifactLogicalBytes);
  });

  it('externalizes heavy archive collections while retaining archive identity', async () => {
    const active = season(100); const archived = { id: 'archive', name: 'Season A', seasonName: 'A', matches: active.matches, rounds: active.rounds, analyticsBuilds: active.analyticsBuilds };
    const source: any = { ...season(0), seasonArchives: [archived] }; const planned = externalizeEvidenceArtifacts(source); const payloads = new Map(planned.artifacts.map(item => [item.sha256, item.json]));
    expect(planned.state.seasonArchives[0]).toMatchObject({ id: 'archive', name: 'Season A' });
    expect(planned.state.seasonArchives[0].rounds.__moeEvidenceArtifact).toBe(1);
    await hydrateEvidenceArtifacts(planned.state, async sha => payloads.get(sha)!);
    expect(planned.state.seasonArchives[0].rounds).toEqual(active.rounds);
  });

  it('archives, stores, hydrates, and restores a 100-match season losslessly', async () => {
    const generated = season(100); const workspace: any = createSeed();
    workspace.settings.season = 'Season A'; workspace.matches = generated.matches; workspace.rounds = generated.rounds; workspace.analyticsBuilds = generated.analyticsBuilds;
    const expectedLastRound = workspace.rounds.at(-1); const archive = archiveAndResetSeason(workspace, 'Season A archive', 'Season B', () => 'archive-100', () => '2026-10-20T12:00:00.000Z');
    expect(archive.matches).toHaveLength(100); expect(workspace.matches).toEqual([]);
    const planned = externalizeEvidenceArtifacts(workspace); const payloads = new Map(planned.artifacts.map(item => [item.sha256, item.json]));
    await hydrateEvidenceArtifacts(planned.state, async sha => payloads.get(sha)!);
    restoreSeasonArchive(planned.state, 'archive-100');
    expect(planned.state.matches).toHaveLength(100); expect(planned.state.rounds.at(-1)).toEqual(expectedLastRound);
  });

  it('fails closed when an artifact is missing or corrupted', async () => {
    const planned = externalizeEvidenceArtifacts(season());
    await expect(hydrateEvidenceArtifacts(planned.state, async () => '{"wrong":true}')).rejects.toThrow(/integrity validation/);
  });
  it('moves the remaining bulky fields out of the index and restores them losslessly', async () => {
    const bulky = (label: string) => ({ label, samples: 'x'.repeat(4000) });
    const source: any = {
      ...season(0),
      matches: [{ id: 'm1', roundAnalytics: bulky('round-analytics') }],
      playerStats: [{ id: 's1', matchId: 'm1', screenshotMetrics: bulky('metrics') }],
      vodSubmissions: [{ id: 'v1', timelineEvidence: bulky('timeline') }],
      replayIntake: { parserJobs: {}, screenshots: { shot: { id: 'shot', draft: bulky('draft') } } },
    };
    const planned = externalizeEvidenceArtifacts(source);
    expect(planned.state.matches[0].roundAnalytics.__moeEvidenceArtifact).toBe(1);
    expect(planned.state.playerStats[0].screenshotMetrics.__moeEvidenceArtifact).toBe(1);
    expect(planned.state.vodSubmissions[0].timelineEvidence.__moeEvidenceArtifact).toBe(1);
    expect(planned.state.replayIntake.screenshots.shot.draft.__moeEvidenceArtifact).toBe(1);
    expect(JSON.stringify(planned.state)).not.toContain('x'.repeat(100));
    const payloads = new Map(planned.artifacts.map(item => [item.sha256, item.json]));
    await hydrateEvidenceArtifacts(planned.state, async sha => payloads.get(sha)!);
    expect(planned.state.matches).toEqual(source.matches); expect(planned.state.playerStats).toEqual(source.playerStats);
    expect(planned.state.vodSubmissions).toEqual(source.vodSubmissions); expect(planned.state.replayIntake).toEqual(source.replayIntake);
  });

  it('refuses artifact references submitted inside a state to write', () => {
    const crafted: any = season(); crafted.rounds[0].screenshotEvidence = { __moeEvidenceArtifact: 1, sha256: 'f'.repeat(64), bytes: 10 };
    expect(() => externalizeEvidenceArtifacts(crafted)).toThrow(/cannot be submitted/);
    const nested: any = season(); nested.matches[0].notes = { inner: { __moeEvidenceArtifact: 'anything' } };
    expect(() => externalizeEvidenceArtifacts(nested)).toThrow(/cannot be submitted/);
  });

  it('rejects malformed stored references instead of loading them', async () => {
    const state: any = { rounds: [{ id: 'r1', screenshotEvidence: { __moeEvidenceArtifact: 1, sha256: '../../etc/passwd', bytes: 1 } }] };
    await expect(hydrateEvidenceArtifacts(state, async () => '{}')).rejects.toThrow(/malformed/);
  });

  it('plans collection from orphan time and keeps referenced artifacts', () => {
    const now = 10 * 86_400_000; const day = 86_400_000;
    const plan = planArtifactCollection(['live', 'fresh', 'old', 'new'], new Set(['live']), { fresh: now - day / 2, old: now - 3 * day }, now, day);
    expect(plan.remove).toEqual(['old']);
    expect(plan.orphanedSince).toEqual({ fresh: now - day / 2, new: now });
  });
});
