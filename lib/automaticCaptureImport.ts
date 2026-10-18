import type { TrackerData } from '../src/types';
import { autonomousCaptureDecision } from './ocrAutonomy';
import { classifyAverageLoadout, classifyTeamEquipment } from './scrimRoundAnalytics';
import { suggestOpponentFromEnemyRoster } from './ocrLearning';

const numberOrNull = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function cairoDate(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

const sideForRound = (roundNo: number, firstHalf: 'Att' | 'Def') => {
  const opposite = firstHalf === 'Att' ? 'Def' : 'Att';
  if (roundNo <= 12) return firstHalf;
  if (roundNo <= 24) return opposite;
  return roundNo % 2 === 1 ? firstHalf : opposite;
};

export function buildAutomaticCaptureImport(extracted: any, data: TrackerData, captureId: string | null) {
  const maps = data.settings?.maps || [];
  const decision = autonomousCaptureDecision(extracted, maps, data.playerStats || []);
  if (!decision.automatic || !decision.map || !extracted.startingSide.firstHalf) return { decision, payload: null };
  const firstHalf = extracted.startingSide.firstHalf as 'Att' | 'Def';
  const rounds = extracted.rounds as any[];
  let attW = 0; let attL = 0; let defW = 0; let defL = 0;
  for (const round of rounds) {
    const side = sideForRound(round.roundNo, firstHalf);
    if (round.result === 'W') side === 'Att' ? attW++ : defW++;
    if (round.result === 'L') side === 'Att' ? attL++ : defL++;
  }
  const result = (roundNo: number) => rounds.find(round => round.roundNo === roundNo)?.result || '';
  const special = (roundNo: number) => ({ side: sideForRound(roundNo, firstHalf), result: result(roundNo) });
  const pistol = [special(1), special(13)];
  const bonus = [result(1) === 'W' && result(2) === 'W' ? special(3) : null, result(13) === 'W' && result(14) === 'W' ? special(15) : null].filter(Boolean) as Array<{ side: 'Att' | 'Def'; result: string }>;
  const included = extracted.players.filter((player: any) => player.include);
  const activeCoreIds = new Set((data.coreMemberships || []).filter(member => !member.endedAt).map(member => member.playerId));
  const activeTryoutIds = new Set((data.tryoutBatches || []).filter(batch => batch.status === 'active').flatMap(batch => batch.candidatePlayerIds));
  const sourceMetadata = { ...extracted.sourceMetadata, model: `${extracted.sourceMetadata?.model || 'tesseract-local'}+${decision.map ? 'autonomous-v1' : 'review'}` };
  const opponentSuggestion = suggestOpponentFromEnemyRoster(extracted.players, data.matches || []);
  const match = {
    date: cairoDate(), type: 'Scrim', opponent: opponentSuggestion?.opponent || 'Unknown opponent', map: decision.map,
    attW, attL, defW, defL, ourScore: extracted.meta.ourScore, theirScore: extracted.meta.theirScore,
    pistolAtt: pistol.find(item => item.side === 'Att')?.result || '', pistolDef: pistol.find(item => item.side === 'Def')?.result || '',
    bonusAtt: bonus.find(item => item.side === 'Att')?.result || '', bonusDef: bonus.find(item => item.side === 'Def')?.result || '',
    notes: 'Automatically saved from a complete, internally consistent local capture. Editable by staff.',
    source: 'scrim-import', sourceMetadata, reviewConfirmation: { alliedSideConfirmed: true, automatic: true },
    rosterContext: { kind: included.every((player: any) => player.matchedPlayerId) ? 'mixed' : 'unclassified' },
    automation: { mode: 'complete-capture-consensus', editable: true, reasons: decision.reasons, opponentSuggestion: opponentSuggestion || null },
    screenshotEvidence: { schemaVersion: 1, captureId, diagnostics: extracted.captureDiagnostics || null, scoreboardPlayers: extracted.players.map((player: any) => ({ name: player.extractedName, agent: player.agent || null, kills: numberOrNull(player.kills), deaths: numberOrNull(player.deaths), assists: numberOrNull(player.assists), fk: numberOrNull(player.fk), trades: numberOrNull(player.trades), plants: numberOrNull(player.plants), defuses: numberOrNull(player.defuses), allied: !!player.include })) },
  };
  const stats = included.map((player: any) => ({
    player: player.extractedName, displayNameSnapshot: player.extractedName,
    ...(player.matchedPlayerId ? { playerId: player.matchedPlayerId, appearanceType: activeCoreIds.has(player.matchedPlayerId) ? 'core' : activeTryoutIds.has(player.matchedPlayerId) ? 'tryout' : 'standIn' } : {}),
    agent: player.agent || '', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
    kills: numberOrNull(player.kills), deaths: numberOrNull(player.deaths), assists: numberOrNull(player.assists), acs: numberOrNull(player.acs), adr: numberOrNull(player.adr), hs: numberOrNull(player.hs), fk: numberOrNull(player.fk), fd: numberOrNull(player.fd), performanceScore: numberOrNull(player.performanceScore), trades: numberOrNull(player.trades), plants: numberOrNull(player.plants), defuses: numberOrNull(player.defuses), ...(player.headToHead ? { headToHead: player.headToHead } : {}), sourceMetadata,
  }));
  const economyLabel = (value: unknown, evidence: any, team: 'ours' | 'theirs') => {
    const equipment = classifyTeamEquipment(evidence?.players || [], team);
    const label = equipment !== 'unknown' ? equipment : classifyAverageLoadout(value);
    return label === 'unknown' ? '' : label[0].toUpperCase() + label.slice(1);
  };
  const roundRows = rounds.map(round => ({ roundNo: round.roundNo, side: sideForRound(round.roundNo, firstHalf), result: round.result, winBy: round.winBy || '', buy: economyLabel(round.screenshotEvidence?.ourAverageLoadout, round.screenshotEvidence, 'ours'), enemyBuy: economyLabel(round.screenshotEvidence?.enemyAverageLoadout, round.screenshotEvidence, 'theirs'), screenshotEvidence: round.screenshotEvidence }));
  return { decision, payload: { match, stats, roundRows } };
}
