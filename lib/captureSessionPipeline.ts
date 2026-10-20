/**
 * One post-match capture session -> reviewable draft.
 *
 * Shared by the desktop importer (ScrimImport) and the offline backtest so the
 * accuracy numbers measured in backtests are the numbers the app produces.
 * Browser-only: the classifiers read pixels through canvas.
 */
import type { LocalOcrAdapter, LocalOcrProfile, LocalOcrRecognition } from './localOcrEngine';
import { measureScoreDigitBoxes, measureScoreboardRowOffset, createValorantEndScreenProfile, createValorantHeadToHeadProfile, createValorantPerformanceProfile, createValorantRoundSummaryProfile, extractLocalScoreboardDraft } from './localOcrEngine';
import { parseLocalRoundRecognitions } from './localRoundOcrEngine';
import { classifyValorantRoundEvents } from './localRoundEventClassifier';
import { canonicalScoreboardName, cleanCaptureDisplayName, cleanCaptureMap, inferAlliedScoreboardNames, normalizeCaptureName, inferStartingSide, reconcileCapturedRoundNumbers, scoreFromCompleteRounds } from './scrimCaptureImport';
import { canonicalKnownMap, consensusDisplayName } from './ocrAutonomy';
import { applyLocalCorrection, type LocalCorrectionModel, type OcrLearningField } from './ocrLearning';
import { classifyValorantScoreboardAgents } from './localAgentClassifier';
import { addSurvivalEvidence, canonicalizeRoundIdentities, enrichObjectiveRows, enrichScreenshotEvents } from './screenshotEvidence';
import { parseLocalHeadToHeadRecognitions, parseLocalPerformanceRecognitions } from './localPerformanceOcrEngine';
import { matchExtractedRosterName } from './entryEngine';

function imagePixels(image: LoadedImage) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable for scoreboard measurement.');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export const INFORMATIONAL_ROUND_ISSUES = new Set(['round-rekeyed-from-header']);

export interface CaptureImage { kind: string; round?: number | null; name?: string; base64: string; mediaType: string }
type LoadedImage = HTMLImageElement & { naturalWidth: number; naturalHeight: number };

export async function extractCaptureSession(input: {
  captures: readonly CaptureImage[];
  rosterPlayers: Array<{ id?: string; displayName: string; aliases?: string[] }>;
  adapter: LocalOcrAdapter;
  loadImage: (capture: CaptureImage) => Promise<LoadedImage>;
  recognize?: (capture: CaptureImage, image: LoadedImage, profile: LocalOcrProfile) => Promise<LocalOcrRecognition[]>;
  knownMaps?: readonly string[];
  correctionModel?: LocalCorrectionModel;
  progress?: (message: string) => void;
}) {
  const { captures, rosterPlayers, adapter, loadImage } = input;
  const progress = input.progress || (() => {});
  const recognize = input.recognize || ((_capture: CaptureImage, image: LoadedImage, profile: LocalOcrProfile) => adapter.recognize(image, profile));
  const scoreboardCapture = captures.find(item => item.kind === 'scoreboard');
  if (!scoreboardCapture) throw new Error('The capture session has no scoreboard image.');
  progress('Reading the final scoreboard locally…');
  const scoreboardImage = await loadImage(scoreboardCapture);
  // Matchmaking summaries have a Performance tab and a wider scoreboard
  // (Performance Score | KDA | Trades | FB | Plants | Defuses).
  const scoreboardLayout = captures.some(item => item.kind === 'performance') ? 'competitive' : 'custom';
  const scoreboardPixels = imagePixels(scoreboardImage);
  const rowOffset = measureScoreboardRowOffset(scoreboardPixels);
  const aspect = scoreboardImage.naturalWidth / Math.max(1, scoreboardImage.naturalHeight);
  const captureIssues = [
    ...(scoreboardImage.naturalWidth < 1280 || scoreboardImage.naturalHeight < 720 ? ['scoreboard-resolution-too-small'] : []),
    ...(aspect < 1.65 || aspect > 1.85 ? ['scoreboard-aspect-ratio-unexpected'] : []),
    ...(Math.abs(rowOffset) > scoreboardImage.naturalHeight * 0.08 ? ['scoreboard-row-offset-extreme'] : []),
  ];
  const scoreboardProfile = createValorantEndScreenProfile(scoreboardImage.naturalWidth, scoreboardImage.naturalHeight, scoreboardLayout, measureScoreDigitBoxes(scoreboardPixels), rowOffset);
  const scoreboardAdapter: LocalOcrAdapter = {
    recognize: (image, profile) => recognize(scoreboardCapture, image as LoadedImage, profile),
    terminate: () => Promise.resolve(),
  };
  const draft = await extractLocalScoreboardDraft(scoreboardAdapter, scoreboardImage, scoreboardProfile.dimensions, { capturedAt: new Date().toISOString(), rosterPlayers }, scoreboardProfile);
  progress('Identifying agent portraits locally…');
  // Portraits keep the calibrated grid. The separator row offset measures the
  // text rows, and a few pixels of it push the 48px portrait crop off its cell.
  const detectedAgents = await classifyValorantScoreboardAgents(scoreboardImage, scoreboardLayout).catch(() => Array<string | null>(10).fill(null));
  draft.stats = draft.stats.map((player, index) => {
    const corrected = { ...player, agent: detectedAgents[index] || player.agent } as any;
    const correctionContext = { sourceModel: draft.sourceMetadata.model, layout: scoreboardLayout, resolution: `${scoreboardImage.naturalWidth}x${scoreboardImage.naturalHeight}` };
    for (const field of ['agent', 'kills', 'deaths', 'assists', 'fk', 'fd', 'plants', 'defuses', 'trades'] as OcrLearningField[]) corrected[field] = applyLocalCorrection(input.correctionModel, field, corrected[field], { ...correctionContext, sourceRegion: `player.${index}.${field}` });
    return corrected;
  });
  const performanceCapture = captures.find(item => item.kind === 'performance');
  const headToHeadCapture = captures.find(item => item.kind === 'head-to-head');
  const performance = performanceCapture ? await (async () => {
    const image = await loadImage(performanceCapture);
    const profile = createValorantPerformanceProfile(image.naturalWidth, image.naturalHeight);
    return parseLocalPerformanceRecognitions(await recognize(performanceCapture, image, profile));
  })() : null;
  const headToHead = headToHeadCapture ? await (async () => {
    const image = await loadImage(headToHeadCapture);
    const profile = createValorantHeadToHeadProfile(image.naturalWidth, image.naturalHeight);
    return parseLocalHeadToHeadRecognitions(await recognize(headToHeadCapture, image, profile));
  })() : null;
  if (headToHead?.totals) {
    const ownerRows = draft.stats.map((player, index) => ({ player, index })).filter(({ player }) => player.kills === headToHead.totals!.kills && player.deaths === headToHead.totals!.deaths && player.assists === headToHead.totals!.assists);
    if (ownerRows.length === 1) {
      const ownerIndex = ownerRows[0].index;
      draft.stats = draft.stats.map((player, index) => index === ownerIndex ? {
        ...player, headToHead: headToHead.rows,
        ...(performance?.performanceScore !== null && performance?.performanceScore !== undefined ? { performanceScore: performance.performanceScore } : {}),
        ...(performance?.hs !== null && performance?.hs !== undefined ? { hs: performance.hs } : {}),
        ...(performance?.firstBloods !== null && performance?.firstBloods !== undefined ? { fk: performance.firstBloods } : {}),
      } : player);
    }
  }
  const roundCaptures = captures.filter(item => item.kind === 'round' && Number.isInteger(item.round)).sort((a, b) => Number(a.round) - Number(b.round));
  const extractedRounds = [];
  for (let index = 0; index < roundCaptures.length; index += 1) {
    const capture = roundCaptures[index];
    progress(`Reading round ${capture.round} locally · ${index + 1} of ${roundCaptures.length}`);
    const image = await loadImage(capture);
    const profile = createValorantRoundSummaryProfile(image.naturalWidth, image.naturalHeight);
    const parsed = parseLocalRoundRecognitions(await recognize(capture, image, profile), capture.name);
    if (parsed.displayedRoundNo === null) parsed.issues = [...new Set([...parsed.issues, 'round-number-unreadable'])];
    else if (parsed.displayedRoundNo !== capture.round) parsed.issues = [...new Set([...parsed.issues, 'round-number-mismatch'])];
    const eventPlayers = parsed.evidence.players.map(player => {
      const canonical = canonicalScoreboardName(player.displayName, draft.stats);
      const scoreboardPlayer = draft.stats.find(candidate => normalizeCaptureName(candidate.extractedName) === normalizeCaptureName(canonical));
      return { ...player, agent: scoreboardPlayer?.agent || null };
    });
    // Tesseract can occasionally miss the bottom scoreboard name while
    // the portrait is still perfectly visible. Restore that tenth row
    // from the final scoreboard so event/FK/FD matching stays automatic.
    if (eventPlayers.length >= 8 && eventPlayers.length < 10) {
      const present = new Set(eventPlayers.map(player => normalizeCaptureName(canonicalScoreboardName(player.displayName, draft.stats))));
      const missing = draft.stats.filter(player => !present.has(normalizeCaptureName(player.extractedName)));
      const ours = eventPlayers.filter(player => player.team === 'ours').length;
      const theirs = eventPlayers.filter(player => player.team === 'theirs').length;
      const shortTeam = ours === 5 && theirs < 5 ? 'theirs' : theirs === 5 && ours < 5 ? 'ours' : null;
      if (shortTeam && missing.length === 10 - eventPlayers.length) for (const player of missing) eventPlayers.push({
        displayName: player.extractedName,
        team: shortTeam,
        agent: player.agent || null,
      });
    }
    const eventClassification = await classifyValorantRoundEvents(image, eventPlayers);
    parsed.evidence.events = enrichScreenshotEvents(eventClassification.events, parsed.eventDetails);
    parsed.evidence.objectives = enrichObjectiveRows(eventClassification.objectives || [], parsed.eventDetails);
    parsed.evidence.openingEventComplete = eventClassification.openingComplete;
    parsed.evidence.eventsComplete = eventClassification.complete;
    if (!eventClassification.complete) parsed.issues = [...new Set([...parsed.issues, 'event-log'])];
    parsed.evidence.extractionIssues = parsed.issues;
    parsed.evidence.players = parsed.evidence.players.map(player => {
      if (player.team !== 'ours') return player;
      const matched = matchExtractedRosterName(player.displayName, rosterPlayers);
      return { ...player, playerId: matched.rosterMatch.status === 'matched' ? matched.matchedPlayerId : null };
    });
    extractedRounds.push({ roundNo: capture.round!, result: parsed.result || '', winBy: parsed.winBy || '', screenshotEvidence: parsed.evidence, extractionIssues: parsed.issues });
  }
  const scoreboardRoundCount = Number.isInteger(draft.match.ourScore) && Number.isInteger(draft.match.theirScore) ? Number(draft.match.ourScore) + Number(draft.match.theirScore) : null;
  const reconciled = reconcileCapturedRoundNumbers(extractedRounds, scoreboardRoundCount);
  extractedRounds.splice(0, extractedRounds.length, ...(reconciled.rounds as typeof extractedRounds));
  const completeScore = scoreFromCompleteRounds(extractedRounds);
  const normalizedMap = input.knownMaps?.length ? canonicalKnownMap(draft.match.map, input.knownMaps) : cleanCaptureMap(draft.match.map);
  const meta = { map: normalizedMap || cleanCaptureMap(draft.match.map), ourScore: completeScore?.ourScore ?? draft.match.ourScore, theirScore: completeScore?.theirScore ?? draft.match.theirScore };
  const alliedNames = inferAlliedScoreboardNames(draft.stats, extractedRounds);
  const resolvedPlayers = draft.stats.map(player => {
    const observations = [player.extractedName];
    for (const round of extractedRounds) for (const observed of round.screenshotEvidence?.players || []) {
      if (normalizeCaptureName(canonicalScoreboardName(observed.displayName, draft.stats)) === normalizeCaptureName(player.extractedName)) observations.push(observed.displayName);
    }
    return ({
    ...player,
    extractedName: consensusDisplayName(observations, cleanCaptureDisplayName(player.extractedName)) || cleanCaptureDisplayName(player.extractedName),
    include: player.rosterMatch.status === 'matched' || alliedNames.has(normalizeCaptureName(player.extractedName)),
  }); });
  // Stabilize OCR variants across all round images so economy/weapon
  // summaries attach to the same five match-stat rows.
  const canonicalIdentity = (rawName: string) => {
    const displayName = canonicalScoreboardName(rawName, resolvedPlayers);
    const matched = matchExtractedRosterName(displayName, rosterPlayers);
    const playerId = matched.rosterMatch.status === 'matched' && matched.matchedPlayerId
      ? matched.matchedPlayerId
      : `name:${normalizeCaptureName(displayName)}`;
    return { displayName, playerId };
  };
  const restoredRawNames = [...draft.stats.map(stat => stat.extractedName), ...resolvedPlayers.map(stat => stat.extractedName)];
  for (const round of extractedRounds) {
    if (!round.screenshotEvidence) continue;
    const canonical = canonicalizeRoundIdentities({
      players: round.screenshotEvidence.players,
      events: round.screenshotEvidence.events || [],
      objectives: round.screenshotEvidence.objectives || [],
      resolve: canonicalIdentity,
      extraRawNames: restoredRawNames,
    });
    round.screenshotEvidence.players = canonical.players;
    round.screenshotEvidence.events = canonical.events;
    round.screenshotEvidence.objectives = canonical.objectives;
    round.screenshotEvidence.players = addSurvivalEvidence(round.screenshotEvidence.players, round.screenshotEvidence.events, round.screenshotEvidence.eventsComplete === true);
    round.screenshotEvidence.reviewStatus = round.screenshotEvidence.confidence === 'high' && round.extractionIssues.every(issue => INFORMATIONAL_ROUND_ISSUES.has(issue))
      ? 'confirmed'
      : 'review-required';
  }
  const firstDeaths = new Map<string, number>();
  // FK/FD only needs the earliest kill row. Do not throw away a valid opening
  // because a later trade or cleanup kill was unreadable.
  const firstDeathCoverageComplete = extractedRounds.length > 0 && extractedRounds.every(round => round.screenshotEvidence?.openingEventComplete === true);
  for (const round of extractedRounds) {
    const first = round.screenshotEvidence?.events?.[0];
    if (first?.victimTeam === 'ours' && first.victimPlayerId) firstDeaths.set(first.victimPlayerId, (firstDeaths.get(first.victimPlayerId) || 0) + 1);
  }
  for (const player of resolvedPlayers) {
    const identity = canonicalIdentity(player.extractedName).playerId;
    player.fd = firstDeathCoverageComplete ? (firstDeaths.get(identity) || 0) : null;
  }
  const startingSide = inferStartingSide(extractedRounds);
  return {
    draft, meta, startingSide, players: resolvedPlayers, rounds: extractedRounds, performance, headToHead, reconciled, scoreboardLayout, sourceMetadata: draft.sourceMetadata,
    captureDiagnostics: {
      schemaVersion: 1,
      resolution: `${scoreboardImage.naturalWidth}x${scoreboardImage.naturalHeight}`,
      width: scoreboardImage.naturalWidth,
      height: scoreboardImage.naturalHeight,
      aspectRatio: Number(aspect.toFixed(4)),
      rowOffset,
      layout: scoreboardLayout,
      requestedRoundCaptures: roundCaptures.length,
      reconciledRounds: extractedRounds.length,
      confirmedRounds: extractedRounds.filter(round => round.screenshotEvidence?.reviewStatus === 'confirmed').length,
      issues: [...new Set([
        ...captureIssues,
        ...(roundCaptures.length === 0 ? ['round-captures-missing'] : []),
        ...(reconciled.missing?.length ? ['round-captures-incomplete'] : []),
        ...(scoreboardRoundCount !== null && extractedRounds.length !== scoreboardRoundCount ? ['round-count-score-mismatch'] : []),
        ...extractedRounds.flatMap(round => round.extractionIssues || []),
      ])],
    },
  };
}
