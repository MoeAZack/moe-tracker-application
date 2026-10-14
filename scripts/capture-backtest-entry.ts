import { createBrowserLocalTesseractAdapter, createValorantEndScreenProfile, createValorantHeadToHeadProfile, createValorantPerformanceProfile, createValorantRoundSummaryProfile, extractLocalScoreboardDraft } from '../lib/localOcrEngine';
import { parseLocalRoundRecognitions } from '../lib/localRoundOcrEngine';
import { classifyValorantRoundEvents } from '../lib/localRoundEventClassifier';
import { canonicalScoreboardName, cleanCaptureDisplayName, cleanCaptureMap, inferAlliedScoreboardNames, normalizeCaptureName, scoreFromCompleteRounds } from '../lib/scrimCaptureImport';
import { scoreValorantScoreboardAgents } from '../lib/localAgentClassifier';
import { addSurvivalEvidence, enrichScreenshotEvents } from '../lib/screenshotEvidence';
import { parseLocalHeadToHeadRecognitions, parseLocalPerformanceRecognitions } from '../lib/localPerformanceOcrEngine';

const imageFromBase64 = async (base64: string) => {
  const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode(); return image;
};

(window as any).__runCaptureBacktest = async (payload: { scoreboard: string; performance?: string | null; headToHead?: string | null; rounds: Array<{ round: number; name: string; base64: string }> }) => {
  const adapter = await createBrowserLocalTesseractAdapter();
  try {
    const scoreboardImage = await imageFromBase64(payload.scoreboard);
    const scoreboardProfile = createValorantEndScreenProfile(scoreboardImage.naturalWidth, scoreboardImage.naturalHeight);
    const draft = await extractLocalScoreboardDraft(adapter, scoreboardImage, scoreboardProfile.dimensions, { capturedAt: new Date().toISOString(), rosterPlayers: [] }, scoreboardProfile);
    const agentScores = await scoreValorantScoreboardAgents(scoreboardImage);
    const detectedAgents = agentScores.map(scores => scores.length ? (scores[0].score <= 9_500 && (scores[1]?.score || Infinity) / Math.max(1, scores[0].score) >= 1.04 ? scores[0].name : null) : null);
    draft.stats = draft.stats.map((player, index) => ({ ...player, agent: detectedAgents[index] || player.agent }));
    const performance = payload.performance ? await (async () => { const image = await imageFromBase64(payload.performance!); const profile = createValorantPerformanceProfile(image.naturalWidth, image.naturalHeight); return parseLocalPerformanceRecognitions(await adapter.recognize(image, profile)); })() : null;
    const headToHead = payload.headToHead ? await (async () => { const image = await imageFromBase64(payload.headToHead!); const profile = createValorantHeadToHeadProfile(image.naturalWidth, image.naturalHeight); return parseLocalHeadToHeadRecognitions(await adapter.recognize(image, profile)); })() : null;
    if (headToHead?.totals) {
      const ownerRows = draft.stats.map((player, index) => ({ player, index })).filter(({ player }) => player.kills === headToHead.totals!.kills && player.deaths === headToHead.totals!.deaths && player.assists === headToHead.totals!.assists);
      if (ownerRows.length === 1) draft.stats[ownerRows[0].index] = { ...draft.stats[ownerRows[0].index], headToHead: headToHead.rows, performanceScore: performance?.performanceScore ?? null, hs: performance?.hs ?? draft.stats[ownerRows[0].index].hs, fk: performance?.firstBloods ?? draft.stats[ownerRows[0].index].fk } as any;
    }
    const rounds = [];
    for (const item of payload.rounds) {
      const image = await imageFromBase64(item.base64);
      const profile = createValorantRoundSummaryProfile(image.naturalWidth, image.naturalHeight);
      const parsed = parseLocalRoundRecognitions(await adapter.recognize(image, profile), item.name);
      if (parsed.displayedRoundNo === null) parsed.issues = [...new Set([...parsed.issues, 'round-number-unreadable'])];
      else if (parsed.displayedRoundNo !== item.round) parsed.issues = [...new Set([...parsed.issues, 'round-number-mismatch'])];
      const eventPlayers = parsed.evidence.players.map(player => {
        const canonical = canonicalScoreboardName(player.displayName, draft.stats);
        const scoreboardPlayer = draft.stats.find(candidate => normalizeCaptureName(candidate.extractedName) === normalizeCaptureName(canonical));
        return { ...player, agent: scoreboardPlayer?.agent || null };
      });
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
      const classified = await classifyValorantRoundEvents(image, eventPlayers);
      parsed.evidence.events = enrichScreenshotEvents(classified.events, parsed.eventDetails);
      parsed.evidence.eventsComplete = classified.complete;
      parsed.evidence.players = addSurvivalEvidence(parsed.evidence.players, parsed.evidence.events, classified.complete);
      rounds.push({ roundNo: item.round, result: parsed.result || '', winBy: parsed.winBy || '', screenshotEvidence: parsed.evidence, extractionIssues: parsed.issues });
    }
    const allied = inferAlliedScoreboardNames(draft.stats, rounds);
    const players = draft.stats.map(player => ({ ...player, extractedName: cleanCaptureDisplayName(player.extractedName), include: allied.has(normalizeCaptureName(player.extractedName)) }));
    for (const round of rounds) round.screenshotEvidence.players = round.screenshotEvidence.players.map(player => ({ ...player, displayName: canonicalScoreboardName(player.displayName, players) }));
    const completeScore = rounds.every(round => !round.extractionIssues.includes('round-number-mismatch')) ? scoreFromCompleteRounds(rounds) : null;
    return { draft: { ...draft, match: { ...draft.match, map: cleanCaptureMap(draft.match.map), ...(completeScore || {}) } }, players, rounds, performance, headToHead, agentScores: agentScores.map(scores => scores.slice(0, 4)) };
  } finally { await adapter.terminate(); }
};
