import { describe, expect, it } from 'vitest';
import { applyLocalCorrection, buildLocalCorrectionModel, correctionSamplesFromAcceptedEdit, learnedAliasesFromCorrections, ocrHealthSummary, replayScreenshotReconciliation, rosterWithLearnedAliases, suggestOpponentFromEnemyRoster } from '../lib/ocrLearning';
import { matchExtractedRosterName } from '../lib/entryEngine';

const screenshotMatch = { id: 'm1', map: 'Ascentt', opponent: 'Unknown opponent', source: 'scrim-import', sourceMetadata: { method: 'screenshot', model: 'local-v1' }, screenshotEvidence: { captureId: 'cap-1' } };

describe('private OCR learning', () => {
  it('turns accepted coach edits into field labels and roster aliases', () => {
    const samples = correctionSamplesFromAcceptedEdit({
      beforeMatch: screenshotMatch,
      beforeStats: [{ playerId: 'p1', player: 'be11atrix', agent: '0men', kills: 17, deaths: 16, assists: 5 }],
      nextMatch: { ...screenshotMatch, map: 'Ascent', opponent: 'MT Asteria' },
      nextStats: [{ playerId: 'p1', player: 'bellatrix', agent: 'Omen', kills: 17, deaths: 16, assists: 5 }],
      recordedAt: '2026-10-18T10:00:00.000Z',
    });
    expect(samples.map(sample => sample.field)).toEqual(['map', 'opponent', 'name', 'agent']);
    expect(learnedAliasesFromCorrections(samples, [{ id: 'p1', displayName: 'bellatrix' }])).toEqual([]);
    const aliases = learnedAliasesFromCorrections([...samples, { ...samples.find(sample => sample.field === 'name')!, id: 'second', matchId: 'm2', captureId: 'cap-2' }], [{ id: 'p1', displayName: 'bellatrix' }]);
    expect(aliases).toMatchObject([{ observed: 'be11atrix', playerId: 'p1', confirmations: 2 }]);
    const roster = rosterWithLearnedAliases([{ id: 'p1', displayName: 'bellatrix' }], aliases);
    expect(matchExtractedRosterName('be11atrix', roster)).toMatchObject({ matchedPlayerId: 'p1', matchedPlayerName: 'bellatrix', rosterMatch: { status: 'matched' } });
  });

  it('activates explainable correction rules only after three identical labels', () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ id: String(index), captureId: null, matchId: `m${index}`, playerId: 'p1', field: 'agent' as const, predicted: '0men', corrected: 'Omen', modelVersion: 'x', recordedAt: `2026-10-18T10:00:0${index}.000Z` }));
    expect(applyLocalCorrection(buildLocalCorrectionModel(rows.slice(0, 2)), 'agent', '0men')).toBe('0men');
    const model = buildLocalCorrectionModel(rows);
    expect(applyLocalCorrection(model, 'agent', '0men')).toBe('Omen');
    expect(applyLocalCorrection(model, 'agent', '0men', { sourceModel: 'different-model' })).toBe('0men');
  });

  it('does not learn from repeated edits to one capture or apply a rule to another row', () => {
    const base = { captureId: 'same', matchId: 'm1', playerId: 'p1', field: 'kills' as const, predicted: 1, corrected: 7, modelVersion: 'x', recordedAt: '2026-10-18T10:00:00.000Z', sourceRegion: 'player.0.kills' };
    expect(buildLocalCorrectionModel([0, 1, 2].map(index => ({ ...base, id: String(index) }))).rules).toEqual([]);
    const model = buildLocalCorrectionModel([0, 1, 2].map(index => ({ ...base, id: String(index), captureId: `cap-${index}`, matchId: `m${index}` })));
    expect(applyLocalCorrection(model, 'kills', 1, { sourceRegion: 'player.0.kills' })).toBe(7);
    expect(applyLocalCorrection(model, 'kills', 1, { sourceRegion: 'player.1.kills' })).toBe(1);
  });

  it('suggests an opponent only from a unique three-player enemy overlap', () => {
    const current = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map(extractedName => ({ extractedName, include: false }));
    const match = { id: 'old', opponent: 'PYO', screenshotEvidence: { scoreboardPlayers: ['alpha', 'bravo', 'charlie', 'x', 'y'].map(name => ({ name, allied: false })) } };
    expect(suggestOpponentFromEnemyRoster(current, [match])).toEqual({ opponent: 'PYO', overlap: 3, matchId: 'old' });
    expect(suggestOpponentFromEnemyRoster(current, [match, { ...match, id: 'other', opponent: 'MT' }])).toBeNull();
  });

  it('keeps replay disagreements explicit and summarizes shadow outcomes', () => {
    expect(replayScreenshotReconciliation({ kills: 12, deaths: 8 }, { kills: 13, deaths: 8 })).toMatchObject({ status: 'conflict', conflicts: [{ field: 'kills' }] });
    const health = ocrHealthSummary([{ id: 'a', captureId: null, recordedAt: '', automatic: true, reasons: [], layout: 'custom', resolution: '1920x1080', roundCount: 20, confirmedRounds: 20, cacheHits: 5, cacheMisses: 1, modelVersion: 'v' }, { id: 'b', captureId: null, recordedAt: '', automatic: false, reasons: ['names'], layout: 'custom', resolution: '1920x1080', roundCount: 20, confirmedRounds: 19, cacheHits: 6, cacheMisses: 0, modelVersion: 'v' }], [], []);
    expect(health).toMatchObject({ sessions: 2, automatic: 1, exceptions: 1, automaticRate: 0.5, cacheHits: 11, cacheMisses: 1 });
  });
});
