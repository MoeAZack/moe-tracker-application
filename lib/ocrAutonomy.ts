import type { LocalOcrProfile, LocalOcrRecognition } from './localOcrEngine';
import { captureConsistencyReport, findDuplicateScoreboardMatch } from './screenshotEvidence';
import { cleanCaptureMap, normalizeCaptureName } from './scrimCaptureImport';

export const OCR_PIPELINE_VERSIONS = Object.freeze({
  recognition: 'tesseract-7-eng-1/valorant-fields-v5',
  layout: 'valorant-summary-anchors-v2',
  normalization: 'valorant-normalization-v3',
  consensus: 'cross-frame-consensus-v1',
  acceptance: 'exception-only-acceptance-v1',
});

export interface OcrCacheRecord {
  schemaVersion: 1;
  key: string;
  imageSha256: string;
  profile: { id: string; version: number; width: number; height: number };
  recognitionVersion: string;
  recognitions: LocalOcrRecognition[];
  createdAt: string;
  lastUsedAt: string;
}

export function recognitionCacheKey(imageSha256: string, profile: LocalOcrProfile) {
  const geometry = profile.regions.map(region => `${region.id}=${region.rectangle.left},${region.rectangle.top},${region.rectangle.width},${region.rectangle.height}`).join(';');
  return [imageSha256.toLowerCase(), profile.id, profile.version, profile.dimensions.width, profile.dimensions.height, geometry, OCR_PIPELINE_VERSIONS.recognition].join(':');
}

export function validCachedRecognitions(record: unknown, imageSha256: string, profile: LocalOcrProfile): record is OcrCacheRecord {
  const value = record as OcrCacheRecord;
  return value?.schemaVersion === 1
    && value.key === recognitionCacheKey(imageSha256, profile)
    && value.imageSha256 === imageSha256.toLowerCase()
    && value.recognitionVersion === OCR_PIPELINE_VERSIONS.recognition
    && value.profile?.id === profile.id
    && value.profile?.version === profile.version
    && value.profile?.width === profile.dimensions.width
    && value.profile?.height === profile.dimensions.height
    && Array.isArray(value.recognitions)
    && value.recognitions.every(item => typeof item?.regionId === 'string' && typeof item?.text === 'string' && (item.confidence === null || Number.isFinite(item.confidence)));
}

export function canonicalKnownMap(raw: unknown, knownMaps: readonly string[]) {
  const cleaned = cleanCaptureMap(raw);
  const key = normalizeCaptureName(cleaned);
  if (!key) return null;
  const exact = knownMaps.filter(map => normalizeCaptureName(map) === key);
  if (exact.length === 1) return exact[0];
  const prefix = knownMaps.filter(map => {
    const candidate = normalizeCaptureName(map);
    return key.length >= 4 && candidate.length >= 4 && (candidate.startsWith(key) || key.startsWith(candidate));
  });
  return prefix.length === 1 ? prefix[0] : null;
}

/** Pick a stable spelling seen across the scoreboard and round screens. */
export function consensusDisplayName(observations: readonly string[], preferred?: string | null) {
  const groups = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const observation of observations) {
    const display = String(observation || '').trim(); const key = normalizeCaptureName(display);
    if (!key) continue;
    const group = groups.get(key) || { count: 0, spellings: new Map<string, number>() };
    group.count += 1; group.spellings.set(display, (group.spellings.get(display) || 0) + 1); groups.set(key, group);
  }
  const preferredKey = normalizeCaptureName(preferred || '');
  if (preferredKey && groups.has(preferredKey)) return preferred!.trim();
  const ranked = [...groups.entries()].sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length || a[0].localeCompare(b[0]));
  if (!ranked.length || (ranked[1] && ranked[0][1].count === ranked[1][1].count)) return preferred?.trim() || null;
  return [...ranked[0][1].spellings.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))[0][0];
}

export interface AutonomousCaptureDecision {
  automatic: boolean;
  reasons: string[];
  warnings: string[];
  map: string | null;
  alliedPlayerKeys: string[];
  /** Rounds saved with the match but kept out of round analytics until a coach confirms them. */
  roundsNeedingReview: number[];
}

/**
 * A round whose detail (economy, kill feed, names) is uncertain can still be
 * saved when its WIN/LOSS banner was read and the frame was not low quality:
 * the scoreboard total cross-checks every result. Analytics already ignore
 * rounds that are not confirmed, so only the round's detail waits for review.
 */
function deferrableRound(round: any) {
  const evidence = round?.screenshotEvidence;
  const issues = Array.isArray(round?.extractionIssues) ? round.extractionIssues : Array.isArray(evidence?.extractionIssues) ? evidence.extractionIssues : [];
  return (evidence?.confidence === 'medium' || evidence?.confidence === 'high') && !issues.includes('round-result');
}

/**
 * Fail-closed gate for zero-confirmation imports. It accepts only a complete,
 * structurally consistent capture. Low-confidence fields remain available for
 * review and never block later manual correction of an automatically saved match.
 */
export function autonomousCaptureDecision(extracted: any, knownMaps: readonly string[], existingStats: readonly any[] = []): AutonomousCaptureDecision {
  const reasons: string[] = [];
  const map = canonicalKnownMap(extracted?.meta?.map, knownMaps);
  if (!map) reasons.push('map-unresolved');
  if (!Number.isInteger(extracted?.meta?.ourScore) || !Number.isInteger(extracted?.meta?.theirScore)) reasons.push('score-unresolved');
  if (!extracted?.startingSide?.firstHalf) reasons.push('starting-side-unresolved');
  const rounds = Array.isArray(extracted?.rounds) ? extracted.rounds : [];
  const captureIssues = Array.isArray(extracted?.captureDiagnostics?.issues) ? extracted.captureDiagnostics.issues : [];
  for (const issue of captureIssues.filter((item: string) => ['scoreboard-resolution-too-small', 'scoreboard-aspect-ratio-unexpected', 'scoreboard-row-offset-extreme'].includes(item))) reasons.push(`capture-${issue}`);
  if (!rounds.length || rounds.some((round: any) => round?.result !== 'W' && round?.result !== 'L')) reasons.push('round-results-incomplete');
  if (extracted?.reconciled?.missing?.length) reasons.push('round-captures-missing');
  const players = Array.isArray(extracted?.players) ? extracted.players : [];
  const allied = players.filter((player: any) => player?.include);
  const alliedPlayerKeys = allied.map((player: any) => String(player.matchedPlayerId || `name:${normalizeCaptureName(player.extractedName)}`)).filter(Boolean);
  if (allied.length !== 5) reasons.push('allied-five-unresolved');
  if (new Set(alliedPlayerKeys).size !== alliedPlayerKeys.length || alliedPlayerKeys.some(key => key === 'name:')) reasons.push('allied-identities-ambiguous');
  const unconfirmed = rounds.filter((round: any) => round?.screenshotEvidence?.reviewStatus !== 'confirmed');
  // At most a third of the rounds may wait for review; more than that points at a bad capture, not a few hard frames.
  if (unconfirmed.some((round: any) => !deferrableRound(round)) || unconfirmed.length * 3 > rounds.length) reasons.push('round-evidence-needs-review');
  const roundsNeedingReview = unconfirmed.map((round: any) => Number(round?.roundNo)).filter(Number.isInteger).sort((a: number, b: number) => a - b);
  const consistency = captureConsistencyReport({ ourScore: extracted?.meta?.ourScore, theirScore: extracted?.meta?.theirScore, rounds, players });
  reasons.push(...consistency.errors.map((_: string, index: number) => `consistency-error-${index + 1}`));
  if (findDuplicateScoreboardMatch(players, existingStats)) reasons.push('possible-duplicate-match');
  return { automatic: reasons.length === 0, reasons: [...new Set(reasons)], warnings: consistency.warnings, map, alliedPlayerKeys, roundsNeedingReview };
}

export type OcrFallbackMode = 'local-only' | 'local-then-cloud';
export function shouldRequestCloudFallback(mode: OcrFallbackMode, localAttempts: number, unresolvedRequiredFields: number) {
  return mode === 'local-then-cloud' && localAttempts >= 2 && unresolvedRequiredFields > 0;
}

/** Merge only independently linkable cloud scoreboard facts into a local draft. */
export function mergeScoreboardFallback(extracted: any, fallback: any, knownMaps: readonly string[] = []) {
  const output = structuredClone(extracted); const fallbackStats = Array.isArray(fallback?.stats) ? fallback.stats : [];
  output.meta ||= {};
  const fallbackMap = canonicalKnownMap(fallback?.match?.map, knownMaps);
  if (!canonicalKnownMap(output.meta.map, knownMaps) && fallbackMap) output.meta.map = fallbackMap;
  const decided = Array.isArray(output.rounds) ? output.rounds.filter((round: any) => round?.result === 'W' || round?.result === 'L') : [];
  const roundScore = decided.length && decided.length === output.rounds.length ? { ourScore: decided.filter((round: any) => round.result === 'W').length, theirScore: decided.filter((round: any) => round.result === 'L').length } : null;
  const fallbackScoreMatchesRounds = roundScore && fallback?.match?.ourScore === roundScore.ourScore && fallback?.match?.theirScore === roundScore.theirScore;
  if ((!Number.isInteger(output.meta.ourScore) || fallbackScoreMatchesRounds) && Number.isInteger(fallback?.match?.ourScore)) output.meta.ourScore = fallback.match.ourScore;
  if ((!Number.isInteger(output.meta.theirScore) || fallbackScoreMatchesRounds) && Number.isInteger(fallback?.match?.theirScore)) output.meta.theirScore = fallback.match.theirScore;
  const key = (row: any) => [row?.kills, row?.deaths, row?.assists].every(Number.isInteger) ? `${row.kills}/${row.deaths}/${row.assists}` : null;
  const localCounts = new Map<string, number>(); const fallbackCounts = new Map<string, number>();
  for (const row of output.players || []) if (key(row)) localCounts.set(key(row)!, (localCounts.get(key(row)!) || 0) + 1);
  for (const row of fallbackStats) if (key(row)) fallbackCounts.set(key(row)!, (fallbackCounts.get(key(row)!) || 0) + 1);
  output.players = (output.players || []).map((row: any) => {
    const kda = key(row); if (!kda || localCounts.get(kda) !== 1 || fallbackCounts.get(kda) !== 1) return row;
    const candidate = fallbackStats.find((item: any) => key(item) === kda);
    if (!candidate) return row;
    const matchedPlayerId = candidate.matchedPlayerId || candidate.playerId || row.matchedPlayerId || null;
    return { ...row, extractedName: candidate.extractedName || candidate.player || row.extractedName, agent: candidate.agent || row.agent, matchedPlayerId, rosterMatch: candidate.rosterMatch || row.rosterMatch, include: row.include || !!matchedPlayerId, fallbackSource: 'gemini-scoreboard' };
  });
  output.fallback = { provider: fallback?.sourceMetadata?.provider || 'gemini', model: fallback?.sourceMetadata?.model || null, applied: true };
  return output;
}
