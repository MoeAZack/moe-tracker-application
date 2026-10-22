import { describe, expect, it } from 'vitest';
import { LEARNED_RULE_CONFIDENCE_CEILING, applyLearnedCorrections, buildLocalCorrectionModel, correctionSamplesFromAcceptedEdit, ocrHealthSummary, type OcrCorrectionSample } from '../lib/ocrLearning';

const captureMatch = (index: number) => ({ id: `m${index}`, source: 'scrim-import', sourceMetadata: { method: 'screenshot', model: 'tesseract-local+review' }, screenshotEvidence: { captureId: `cap-${index}`, diagnostics: { layout: 'standard', resolution: '1920x1080' } } });
const context = { sourceModel: 'tesseract-local', layout: 'standard', resolution: '1920x1080' };
const rowsWith = (defuses: number, extra: Record<string, unknown> = {}) => Array.from({ length: 3 }, (_, row) => ({ extractedName: `Row ${row}`, defuses: row === 2 ? defuses : 1, ...(row === 2 ? extra : {}) }));

/** One accepted capture: the OCR read row 2 defuses as `read`, the coach saved `saved`. */
function save(index: number, read: number, saved: number, draftExtra: Record<string, unknown> = {}) {
  return correctionSamplesFromAcceptedEdit({
    beforeMatch: captureMatch(index), beforeStats: rowsWith(read, draftExtra), nextMatch: captureMatch(index),
    nextStats: rowsWith(saved).map(row => ({ player: row.extractedName, defuses: row.defuses })), nextScoreboardRows: [0, 1, 2],
    recordedAt: `2026-10-22T10:00:${String(index).padStart(2, '0')}.000Z`,
  });
}

const defusesOnRow2 = (model: ReturnType<typeof buildLocalCorrectionModel>) => model.rules.filter(rule => rule.sourceRegion === 'player.2.defuses');

describe('learned corrections weigh the reads the coach kept', () => {
  it('records a kept read for each saved scoreboard stat cell, and none for names or unread cells', () => {
    const samples = save(1, 0, 0);
    expect(samples.every(sample => sample.kept && sample.predicted === sample.corrected)).toBe(true);
    expect(samples.map(sample => sample.sourceRegion)).toEqual(['player.0.defuses', 'player.1.defuses', 'player.2.defuses']);
    // Saved-match edits have no scoreboard cell, so a kept value there is not evidence.
    expect(correctionSamplesFromAcceptedEdit({ beforeMatch: captureMatch(1), beforeStats: [{ playerId: 'p1', defuses: 0 }], nextMatch: captureMatch(1), nextStats: [{ playerId: 'p1', defuses: 0 }] })).toEqual([]);
  });

  it('does not activate a rule the coach kept the read against as often', () => {
    const corrections = [1, 2, 3].flatMap(index => save(index, 0, 2));
    expect(defusesOnRow2(buildLocalCorrectionModel(corrections))).toMatchObject([{ predicted: 0, corrected: 2 }]);
    const keptThrice = [4, 5, 6].flatMap(index => save(index, 0, 0));
    expect(defusesOnRow2(buildLocalCorrectionModel([...corrections, ...keptThrice]))).toEqual([]);
    const keptMore = [4, 5, 6, 7, 8].flatMap(index => save(index, 0, 0));
    expect(defusesOnRow2(buildLocalCorrectionModel([...corrections, ...keptMore]))).toEqual([]);
    // Corrections that clearly outnumber the kept reads still teach the rule.
    const keptOnce = save(4, 0, 0);
    expect(defusesOnRow2(buildLocalCorrectionModel([...corrections, ...keptOnce]))).toMatchObject([{ predicted: 0, corrected: 2 }]);
  });

  it('labels the read, not the rule, when the coach undoes or keeps a learned correction', () => {
    const undone = save(1, 2, 0, { learnedCorrections: { defuses: 0 } }).find(sample => sample.sourceRegion === 'player.2.defuses')!;
    expect(undone).toMatchObject({ predicted: 0, corrected: 0, kept: true });
    const confirmed = save(2, 2, 2, { learnedCorrections: { defuses: 0 } }).find(sample => sample.sourceRegion === 'player.2.defuses')!;
    expect(confirmed).toMatchObject({ predicted: 0, corrected: 2 });
    expect(confirmed.kept).toBeUndefined();
  });

  it('a rule stops once undone corrections outnumber confirmed ones', () => {
    const learned = [1, 2, 3].flatMap(index => save(index, 0, 2));
    const model = buildLocalCorrectionModel(learned);
    const undone = [4, 5, 6, 7].flatMap(index => {
      const draft = applyLearnedCorrections(rowsWith(0), model, context);
      expect(draft[2]).toMatchObject({ defuses: 2, learnedCorrections: { defuses: 0 } });
      return correctionSamplesFromAcceptedEdit({ beforeMatch: captureMatch(index), beforeStats: draft, nextMatch: captureMatch(index), nextStats: rowsWith(0).map(row => ({ player: row.extractedName, defuses: row.defuses })), nextScoreboardRows: [0, 1, 2], recordedAt: `2026-10-22T11:00:0${index}.000Z` });
    });
    expect(defusesOnRow2(buildLocalCorrectionModel([...learned, ...undone]))).toEqual([]);
  });

  it('never overrides a confidently read number, and records what it changed', () => {
    const model = buildLocalCorrectionModel([1, 2, 3].flatMap(index => save(index, 0, 2)));
    const at = (confidence: number | null) => applyLearnedCorrections(rowsWith(0, { rawConfidence: { defuses: confidence } }), model, context)[2];
    expect(at(91)).toMatchObject({ defuses: 0 });
    expect((at(91) as Record<string, unknown>).learnedCorrections).toBeUndefined();
    expect(at(LEARNED_RULE_CONFIDENCE_CEILING)).toMatchObject({ defuses: 0 });
    expect(at(LEARNED_RULE_CONFIDENCE_CEILING - 1)).toMatchObject({ defuses: 2, learnedCorrections: { defuses: 0 } });
    expect(at(null)).toMatchObject({ defuses: 2, learnedCorrections: { defuses: 0 } });
  });

  it('holds K/D/A to the confidence of their shared line, and leaves agents to the rule', () => {
    const rule = (field: 'kills' | 'agent', predicted: string | number, corrected: string | number) => ({ field, predicted, corrected, confirmations: 3, ...context, sourceRegion: `player.0.${field}` });
    const model = { version: 'ocr-learning-v2' as const, rules: [rule('kills', 7, 17), rule('agent', '0men', 'Omen')] };
    const row = (kda: number) => [{ kills: 7, agent: '0men', rawConfidence: { kda, kills: null } }];
    expect(applyLearnedCorrections(row(95), model, context)[0]).toMatchObject({ kills: 7, agent: 'Omen', learnedCorrections: { agent: '0men' } });
    expect(applyLearnedCorrections(row(40), model, context)[0]).toMatchObject({ kills: 17, agent: 'Omen', learnedCorrections: { kills: 7, agent: '0men' } });
  });

  it('does not count kept reads as coach corrections', () => {
    const samples: OcrCorrectionSample[] = [...save(1, 0, 2), ...save(2, 0, 0)];
    const health = ocrHealthSummary([], samples, []);
    expect(health.correctedFields).toBe(1);
    expect(health.fields).toEqual([{ field: 'defuses', count: 1 }]);
  });
});
