import type { TrackerData } from '../src/types';
import { autonomousCaptureDecision } from './ocrAutonomy';
import { suggestOpponentFromEnemyRoster } from './ocrLearning';
import { captureRoundRows, captureSideTallies, sideForRound } from './captureRoundRows';
import { praccSlotAt } from './praccMatchContext';

const numberOrNull = (value: unknown) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

function cairoDate(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function buildAutomaticCaptureImport(extracted: any, data: TrackerData, captureId: string | null, capturedAt: string | null = null) {
  const maps = data.settings?.maps || [];
  const decision = autonomousCaptureDecision(extracted, maps, data.playerStats || []);
  if (!decision.automatic || !decision.map || !extracted.startingSide.firstHalf) return { decision, payload: null };
  const firstHalf = extracted.startingSide.firstHalf as 'Att' | 'Def';
  const rounds = extracted.rounds as any[];
  const { attW, attL, defW, defL } = captureSideTallies(rounds, firstHalf);
  const result = (roundNo: number) => rounds.find(round => round.roundNo === roundNo)?.result || '';
  const special = (roundNo: number) => ({ side: sideForRound(roundNo, firstHalf), result: result(roundNo) });
  const pistol = [special(1), special(13)];
  const bonus = [result(1) === 'W' && result(2) === 'W' ? special(3) : null, result(13) === 'W' && result(14) === 'W' ? special(15) : null].filter(Boolean) as Array<{ side: 'Att' | 'Def'; result: string }>;
  const included = extracted.players.filter((player: any) => player.include);
  const activeCoreIds = new Set((data.coreMemberships || []).filter(member => !member.endedAt).map(member => member.playerId));
  const activeTryoutIds = new Set((data.tryoutBatches || []).filter(batch => batch.status === 'active').flatMap(batch => batch.candidatePlayerIds));
  const sourceMetadata = { ...extracted.sourceMetadata, model: `${extracted.sourceMetadata?.model || 'tesseract-local'}+${decision.map ? 'autonomous-v1' : 'review'}` };
  const opponentSuggestion = suggestOpponentFromEnemyRoster(extracted.players, data.matches || []);
  // The game was played when it was captured, not when OCR finished. A PRACC
  // booking covering that moment names the date and the opponent.
  const playedAt = capturedAt && Number.isFinite(Date.parse(capturedAt)) ? new Date(capturedAt) : new Date();
  const praccSlot = praccSlotAt(data.schedule, playedAt);
  const match = {
    date: praccSlot?.date || cairoDate(playedAt), type: 'Scrim', opponent: praccSlot?.opponent || opponentSuggestion?.opponent || 'Unknown opponent', map: decision.map,
    attW, attL, defW, defL, ourScore: extracted.meta.ourScore, theirScore: extracted.meta.theirScore,
    pistolAtt: pistol.find(item => item.side === 'Att')?.result || '', pistolDef: pistol.find(item => item.side === 'Def')?.result || '',
    bonusAtt: bonus.find(item => item.side === 'Att')?.result || '', bonusDef: bonus.find(item => item.side === 'Def')?.result || '',
    notes: decision.roundsNeedingReview.length
      ? `Automatically saved from a consistent local capture. Round${decision.roundsNeedingReview.length === 1 ? '' : 's'} ${decision.roundsNeedingReview.join(', ')} still need${decision.roundsNeedingReview.length === 1 ? 's' : ''} review; until then only the result counts. Editable by staff.`
      : 'Automatically saved from a complete, internally consistent local capture. Editable by staff.',
    source: 'scrim-import', sourceMetadata, reviewConfirmation: { alliedSideConfirmed: true },
    rosterContext: { kind: included.every((player: any) => player.matchedPlayerId) ? 'mixed' : 'unclassified' },
    automation: { mode: decision.roundsNeedingReview.length ? 'partial-round-review' : 'complete-capture-consensus', editable: true, reasons: decision.reasons, roundsNeedingReview: decision.roundsNeedingReview, opponentSuggestion: opponentSuggestion || null, praccScheduleId: praccSlot?.scheduleId || null },
    screenshotEvidence: { schemaVersion: 1, captureId, diagnostics: extracted.captureDiagnostics || null, scoreboardPlayers: extracted.players.map((player: any) => ({ name: player.extractedName, agent: player.agent || null, kills: numberOrNull(player.kills), deaths: numberOrNull(player.deaths), assists: numberOrNull(player.assists), fk: numberOrNull(player.fk), trades: numberOrNull(player.trades), plants: numberOrNull(player.plants), defuses: numberOrNull(player.defuses), allied: !!player.include })) },
  };
  const stats = included.map((player: any) => ({
    player: player.extractedName, displayNameSnapshot: player.extractedName,
    ...(player.matchedPlayerId ? { playerId: player.matchedPlayerId, appearanceType: activeCoreIds.has(player.matchedPlayerId) ? 'core' : activeTryoutIds.has(player.matchedPlayerId) ? 'tryout' : 'standIn' } : {}),
    agent: player.agent || '', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null,
    kills: numberOrNull(player.kills), deaths: numberOrNull(player.deaths), assists: numberOrNull(player.assists), acs: numberOrNull(player.acs), adr: numberOrNull(player.adr), hs: numberOrNull(player.hs), fk: numberOrNull(player.fk), fd: numberOrNull(player.fd), performanceScore: numberOrNull(player.performanceScore), trades: numberOrNull(player.trades), plants: numberOrNull(player.plants), defuses: numberOrNull(player.defuses), ...(player.headToHead ? { headToHead: player.headToHead } : {}), sourceMetadata,
  }));
  const roundRows = captureRoundRows(rounds, firstHalf);
  return { decision, payload: { match, stats, roundRows } };
}
