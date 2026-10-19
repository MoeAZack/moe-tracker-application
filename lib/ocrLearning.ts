import { normalizeRosterName } from './entryEngine';
import { normalizeCaptureName } from './scrimCaptureImport';

export const OCR_LEARNING_VERSION = 'ocr-learning-v1';

export type OcrLearningField = 'map' | 'opponent' | 'name' | 'agent' | 'kills' | 'deaths' | 'assists' | 'fk' | 'fd' | 'plants' | 'defuses' | 'trades';

export interface OcrCorrectionSample {
  id: string;
  captureId: string | null;
  matchId: string;
  playerId: string | null;
  field: OcrLearningField;
  predicted: string | number | null;
  corrected: string | number | null;
  modelVersion: string;
  recordedAt: string;
  rowIndex?: number | null;
  sourceRegion?: string;
  layout?: string;
  resolution?: string;
}

export interface OcrSessionOutcome {
  id: string;
  captureId: string | null;
  recordedAt: string;
  automatic: boolean;
  reasons: string[];
  layout: string;
  resolution: string;
  roundCount: number;
  confirmedRounds: number;
  cacheHits: number;
  cacheMisses: number;
  modelVersion: string;
}

export interface LearnedPlayerAlias {
  key: string;
  observed: string;
  playerId: string;
  canonicalName: string;
  confirmations: number;
  lastConfirmedAt: string;
}

export interface LocalCorrectionModel {
  version: typeof OCR_LEARNING_VERSION;
  rules: Array<{ field: OcrLearningField; predicted: string | number; corrected: string | number; confirmations: number; sourceModel: string; layout: string; resolution: string }>;
}

const comparable = (value: unknown) => value === undefined || value === '' ? null : value === null ? null : typeof value === 'number' ? value : String(value).trim();
const same = (left: unknown, right: unknown) => typeof left === 'string' || typeof right === 'string'
  ? String(comparable(left) ?? '').toLocaleLowerCase('en') === String(comparable(right) ?? '').toLocaleLowerCase('en')
  : comparable(left) === comparable(right);

function sourceIsOcr(match: any) {
  return match?.sourceMetadata?.method === 'screenshot' || match?.sourceMetadata?.method === 'vod-submission' || match?.source === 'scrim-import' || match?.source === 'vod-submission' || !!match?.screenshotEvidence?.captureId;
}

const rowKey = (row: any, index: number) => String(row?.playerId || row?.id || `${normalizeCaptureName(row?.displayNameSnapshot || row?.player || '')}:${index}`);

/** Turns later coach edits into private local labels without retaining screenshots. */
export function correctionSamplesFromAcceptedEdit(input: {
  beforeMatch: any;
  beforeStats: any[];
  nextMatch: any;
  nextStats: any[];
  recordedAt?: string;
}): OcrCorrectionSample[] {
  if (!input.beforeMatch || !sourceIsOcr(input.beforeMatch)) return [];
  const recordedAt = input.recordedAt || new Date().toISOString();
  const captureId = input.beforeMatch.screenshotEvidence?.captureId || null;
  const modelVersion = String(input.beforeMatch.sourceMetadata?.model || OCR_LEARNING_VERSION).replace(/\+(?:autonomous|review)-v\d+$/i, '');
  const vodSource = input.beforeMatch.sourceMetadata?.method === 'vod-submission' || input.beforeMatch.source === 'vod-submission';
  const layout = input.beforeMatch.screenshotEvidence?.diagnostics?.layout || (vodSource ? 'vod-scoreboard' : 'unknown');
  const resolution = input.beforeMatch.screenshotEvidence?.diagnostics?.resolution || (vodSource ? 'video-source' : 'unknown');
  const matchId = String(input.beforeMatch.id || input.nextMatch?.id || '');
  const samples: OcrCorrectionSample[] = [];
  const add = (field: OcrLearningField, predicted: unknown, corrected: unknown, playerId: string | null = null, rowIndex: number | null = null) => {
    if (same(predicted, corrected)) return;
    samples.push({ id: `${matchId}:${playerId || `row-${rowIndex ?? 'match'}`}:${field}:${recordedAt}`, captureId, matchId, playerId, field, predicted: comparable(predicted) as any, corrected: comparable(corrected) as any, modelVersion, recordedAt, rowIndex, sourceRegion: rowIndex === null ? field : `player.${rowIndex}.${field}`, layout, resolution });
  };
  add('map', input.beforeMatch.map, input.nextMatch?.map);
  add('opponent', input.beforeMatch.opponent, input.nextMatch?.opponent);
  const beforeByKey = new Map(input.beforeStats.map((row, index) => [rowKey(row, index), row]));
  const beforeByPlayer = new Map(input.beforeStats.filter(row => row?.playerId).map(row => [String(row.playerId), row]));
  input.nextStats.forEach((next, index) => {
    const playerId = next?.playerId ? String(next.playerId) : null;
    const before = (playerId && beforeByPlayer.get(playerId)) || beforeByKey.get(rowKey(next, index)) || input.beforeStats[index];
    if (!before) return;
    add('name', before.displayNameSnapshot || before.player, next.displayNameSnapshot || next.player, playerId, index);
    for (const field of ['agent', 'kills', 'deaths', 'assists', 'fk', 'fd', 'plants', 'defuses', 'trades'] as OcrLearningField[]) add(field, before[field], next[field], playerId, index);
  });
  return samples;
}

export function learnedAliasesFromCorrections(samples: readonly OcrCorrectionSample[], roster: readonly { id: string; displayName: string }[]): LearnedPlayerAlias[] {
  const names = new Map(roster.map(player => [player.id, player.displayName]));
  const groups = new Map<string, LearnedPlayerAlias>();
  for (const sample of samples) {
    if (sample.field !== 'name' || !sample.playerId || typeof sample.predicted !== 'string') continue;
    const canonicalName = names.get(sample.playerId) || (typeof sample.corrected === 'string' ? sample.corrected : '');
    const observed = sample.predicted.trim(); const normalized = normalizeRosterName(observed);
    if (!canonicalName || !normalized || normalized === normalizeRosterName(canonicalName)) continue;
    const key = `${sample.playerId}:${normalized}`; const current = groups.get(key);
    groups.set(key, current ? { ...current, confirmations: current.confirmations + 1, lastConfirmedAt: sample.recordedAt > current.lastConfirmedAt ? sample.recordedAt : current.lastConfirmedAt }
      : { key, observed, playerId: sample.playerId, canonicalName, confirmations: 1, lastConfirmedAt: sample.recordedAt });
  }
  return [...groups.values()].sort((a, b) => b.confirmations - a.confirmations || b.lastConfirmedAt.localeCompare(a.lastConfirmedAt));
}

export function rosterWithLearnedAliases(roster: readonly { id?: string; displayName: string; aliases?: string[] }[], aliases: readonly LearnedPlayerAlias[]) {
  const byPlayer = new Map<string, string[]>();
  for (const alias of aliases) if (alias.confirmations > 0) byPlayer.set(alias.playerId, [...(byPlayer.get(alias.playerId) || []), alias.observed]);
  return roster.map(player => ({ ...player, aliases: [...new Set([...(player.aliases || []), ...(byPlayer.get(player.id || '') || [])])] }));
}

export function ocrHealthSummary(outcomes: readonly OcrSessionOutcome[], corrections: readonly OcrCorrectionSample[], aliases: readonly LearnedPlayerAlias[]) {
  const sessions = outcomes.length; const automatic = outcomes.filter(item => item.automatic).length;
  const reasonCounts = new Map<string, number>();
  for (const outcome of outcomes) for (const reason of outcome.reasons) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  const correctionsByField = new Map<string, number>();
  for (const sample of corrections) correctionsByField.set(sample.field, (correctionsByField.get(sample.field) || 0) + 1);
  const cacheHits = outcomes.reduce((sum, item) => sum + item.cacheHits, 0); const cacheMisses = outcomes.reduce((sum, item) => sum + item.cacheMisses, 0);
  return {
    sessions, automatic, exceptions: sessions - automatic, automaticRate: sessions ? automatic / sessions : null,
    correctedFields: corrections.length, learnedAliases: aliases.length,
    cacheHits, cacheMisses, cacheHitRate: cacheHits + cacheMisses ? cacheHits / (cacheHits + cacheMisses) : null,
    reasons: [...reasonCounts].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    fields: [...correctionsByField].sort((a, b) => b[1] - a[1]).map(([field, count]) => ({ field, count })),
  };
}

/** Small, explainable local model; a rule activates only after three identical coach corrections. */
export function buildLocalCorrectionModel(samples: readonly OcrCorrectionSample[]): LocalCorrectionModel {
  const groups = new Map<string, Map<string, { value: string | number; count: number }>>();
  for (const sample of samples) {
    if (sample.field === 'name' || sample.predicted === null || sample.corrected === null || same(sample.predicted, sample.corrected)) continue;
    const source = [sample.modelVersion, sample.layout || 'unknown', sample.resolution || 'unknown', sample.field, String(sample.predicted).toLocaleLowerCase('en')].join('\0'); const target = JSON.stringify(sample.corrected);
    const choices = groups.get(source) || new Map(); const current = choices.get(target);
    choices.set(target, { value: sample.corrected, count: (current?.count || 0) + 1 }); groups.set(source, choices);
  }
  const rules: LocalCorrectionModel['rules'] = [];
  for (const [source, choices] of groups) {
    const ranked = [...choices.values()].sort((a, b) => b.count - a.count); const winner = ranked[0];
    if (!winner || winner.count < 3 || (ranked[1] && ranked[1].count === winner.count)) continue;
    const [sourceModel, layout, resolution, fieldRaw, predicted] = source.split('\0'); const field = fieldRaw as OcrLearningField;
    const numeric = ['kills','deaths','assists','fk','fd','plants','defuses','trades'].includes(field);
    rules.push({ field, predicted: numeric ? Number(predicted) : predicted, corrected: winner.value, confirmations: winner.count, sourceModel, layout, resolution });
  }
  return { version: OCR_LEARNING_VERSION, rules };
}

export function applyLocalCorrection(model: LocalCorrectionModel | undefined, field: OcrLearningField, value: unknown, context?: { sourceModel?: string; layout?: string; resolution?: string }) {
  if (value === null || value === undefined || !model) return value;
  const candidates = model.rules.filter(rule => rule.field === field && same(rule.predicted, value)
    && (!context?.sourceModel || rule.sourceModel === context.sourceModel)
    && (!context?.layout || rule.layout === context.layout)
    && (!context?.resolution || rule.resolution === context.resolution));
  return candidates.length === 1 ? candidates[0].corrected : value;
}

/** Suggest a prior opponent only from a unique enemy-player roster overlap. */
export function suggestOpponentFromEnemyRoster(players: readonly any[], matches: readonly any[]) {
  const enemy = new Set(players.filter(player => !player?.include).map(player => normalizeCaptureName(player?.extractedName || player?.name)).filter(Boolean));
  if (enemy.size < 3) return null;
  const candidates = matches.flatMap(match => {
    const prior = new Set((match?.screenshotEvidence?.scoreboardPlayers || []).filter((player: any) => player?.allied === false).map((player: any) => normalizeCaptureName(player?.name)).filter(Boolean));
    const overlap = [...enemy].filter(name => prior.has(name)).length;
    return match?.opponent && match.opponent !== 'Unknown opponent' && overlap >= 3 ? [{ opponent: match.opponent, overlap, matchId: match.id }] : [];
  }).sort((a, b) => b.overlap - a.overlap || String(a.opponent).localeCompare(String(b.opponent), 'en'));
  if (!candidates.length || (candidates[1] && candidates[0].overlap === candidates[1].overlap && normalizeCaptureName(candidates[0].opponent) !== normalizeCaptureName(candidates[1].opponent))) return null;
  return candidates[0];
}

export function replayScreenshotReconciliation(existing: any, replay: Record<string, any>, comparedAt = new Date().toISOString()) {
  const fields = ['kills', 'deaths', 'assists', 'fk', 'fd', 'plants', 'defuses', 'orbPoints', 'ultimateUses', 'kastSuccessful', 'kastCovered', 'side', 'result', 'winBy', 'firstKillBy', 'firstDeathBy'];
  const comparisons = fields.flatMap(field => {
    const screenshot = comparable(existing?.[field]); const parsed = comparable(replay?.[field]);
    if (screenshot === null || parsed === null) return [];
    return [{ field, screenshot, replay: parsed, agrees: same(screenshot, parsed) }];
  });
  const conflicts = comparisons.filter(item => !item.agrees);
  return { schemaVersion: 1, comparedAt, status: conflicts.length ? 'conflict' : comparisons.length ? 'matched' : 'single-source', comparisons, conflicts };
}
