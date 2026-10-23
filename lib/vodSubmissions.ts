import type { Match, PlayerStats, VodSubmission, VodSubmissionPlayer, VodTimelineEvidence } from '../src/types';
import evidenceModule from '../desktop/vod-timeline-evidence.cjs';
import { deriveRoundAdvantage } from './roundAdvantage';
import { findMatchCandidates, normalizedMatchName, similarMatchName } from './matchIdentity';
import { captureRosterFromIdentity } from './identityResolver';
import { refreshDuplicateQuarantine } from './matchIntegrity';
import { activeCorePlayerIds, ensureObservedRosterPlayer, setObservedRosterStatus, setTryoutsMode } from './roster';
import { applyVerifiedMatchScore, applyVodHudScore, applyVodPartialScore } from './vodScore';

const { fuseVodEvidence } = evidenceModule as { fuseVodEvidence: (items: VodTimelineEvidence[]) => VodTimelineEvidence | null };

type SubmissionInput = {
  vodUrl: string; imageSha256: string; matchId?: string; playerId: string | null; date: string; map: string | null; opponent: string | null;
  ourScore: number | null; theirScore: number | null;
  players: Array<Omit<VodSubmissionPlayer, 'rosterPlayerId' | 'rosterDisplayName'>>;
  timelineEvidence?: VodTimelineEvidence | null;
  /**
   * Coach imports only: a scoreboard name that matches nobody on the roster
   * becomes a new tryout player under that observed name, instead of
   * stopping the import.
   */
  addObservedPlayers?: boolean;
  scoreProvenance?: 'confirmed-scoreboard';
};

const METRIC_FIELDS = ['kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'fk', 'fd', 'plants', 'defuses', 'trades'] as const;

export const normalizeVodName = (value: string) => normalizedMatchName(value);
export const similarVodName = (left: string, right: string) => similarMatchName(left, right);

const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });

function resolveFive(db: any, rows: SubmissionInput['players'], addObservedPlayers = false): VodSubmissionPlayer[] {
  // A coach timeline-only import (no readable scoreboard, or no roster yet) names nobody; that is allowed, never padded.
  if (!rows.length) return [];
  // Known aliases (coach corrections, tryout aliases, accepted names) count, so a fix made once applies to VOD too.
  const roster = captureRosterFromIdentity(db);
  const candidatesFor = rows.map(row => roster.filter(player => [player.displayName, ...player.aliases].some(name => similarVodName(row.observedName, name))));
  rows.forEach((row, index) => {
    if (candidatesFor[index].length > 1 || (!candidatesFor[index].length && !addObservedPlayers)) throw conflict(`“${row.observedName}” must match exactly one active roster player before this VOD can be integrated.`);
  });
  const unknown = rows.filter((_, index) => !candidatesFor[index].length);
  // Everything is checked before any player is added, so a refused import adds nobody.
  if (unknown.some((row, index) => unknown.some((other, otherIndex) => otherIndex !== index && similarVodName(row.observedName, other.observedName)))) throw conflict('Two scoreboard names on our side look like the same player. Nothing was imported.');
  const archived = unknown.find(row => (db.rosterPlayers || []).some((player: any) => player.retiredAt && similarVodName(row.observedName, player.displayName)));
  if (archived) throw conflict(`“${archived.observedName}” is archived under Roster. Restore or permanently delete that player, then import this VOD again.`);
  // With no core players yet, the new players are candidates of a tryout phase.
  if (unknown.length && activeCorePlayerIds(db).size === 0 && !db.settings?.tryoutsMode) setTryoutsMode(db, true);
  // During a tryout phase every new name is a candidate; otherwise beside a core it is a stand-in.
  const newStatus = db.settings?.tryoutsMode || activeCorePlayerIds(db).size === 0 ? 'tryout' as const : 'standIn' as const;
  const resolved = rows.map((row, index) => {
    const known = candidatesFor[index][0];
    if (known) return { ...row, rosterPlayerId: known.id, rosterDisplayName: known.displayName };
    // The new identity is the name as the scoreboard showed it; nothing is invented or merged.
    const player = ensureObservedRosterPlayer(db, row.observedName);
    player.addedFrom ||= 'vod-import';
    if (!player.rosterStatus) setObservedRosterStatus(db, { playerId: player.id, displayName: player.displayName, status: newStatus });
    return { ...row, rosterPlayerId: String(player.id), rosterDisplayName: String(player.displayName) };
  });
  if (new Set(resolved.map(row => row.rosterPlayerId)).size !== 5) throw conflict('The VOD must identify five different active roster players.');
  return resolved;
}

function matchRosterIds(db: any, matchId: string) {
  return new Set<string>((db.playerStats || []).filter((row: any) => row.matchId === matchId).map((row: any) => row.playerId || (db.rosterPlayers || []).find((player: any) => similarVodName(row.displayNameSnapshot || row.player, player.displayName))?.id).filter(Boolean));
}

function hasUniqueKdaCoverage(db: any, matchId: string, players: VodSubmissionPlayer[]) {
  const rows: PlayerStats[] = (db.playerStats || []).filter((row: PlayerStats) => row.matchId === matchId);
  const claimed = new Set<string>();
  const metric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  return players.every(player => {
    const candidates = rows.filter(row => !claimed.has(row.id) && metric(row.kills) === metric(player.kills) && metric(row.deaths) === metric(player.deaths) && metric(row.assists) === metric(player.assists));
    if (candidates.length !== 1) return false;
    claimed.add(candidates[0].id); return true;
  });
}

function appearanceType(db: any, playerId: string) {
  if ((db.coreMemberships || []).some((member: any) => member.playerId === playerId && !member.endedAt)) return 'core';
  if ((db.tryoutBatches || []).some((batch: any) => batch.status === 'active' && batch.candidatePlayerIds?.includes(playerId))) return 'tryout';
  return 'standIn';
}

export function integrateVodSubmission(db: any, input: SubmissionInput, actorName: string, ids: { submissionId: string; matchId: string; statId: () => string; reviewId: string }, now = new Date().toISOString()): VodSubmission {
  if (input.timelineEvidence) {
    input.timelineEvidence = structuredClone(input.timelineEvidence);
    // v1 is sampled OCR evidence. It cannot prove exact trade timing, complete
    // KAST, orb ownership, or an ultimate cast strongly enough for trusted stats.
    if (input.timelineEvidence.schema === 'moetracker.vod-timeline-evidence/v1') for (const signal of ['trades', 'kast', 'ultimateUse', 'orbCapture', 'objectives']) if (input.timelineEvidence.coverage.signals[signal] === 'complete') input.timelineEvidence.coverage.signals[signal] = 'partial';
  }
  db.vodSubmissions ||= [];
  const duplicate = db.vodSubmissions.find((item: VodSubmission) => item.submittedByPlayerId === input.playerId && item.imageSha256 === input.imageSha256 && item.vodUrl === input.vodUrl);
  // Re-import is an enrichment operation. Older builds persisted the timeline
  // but discarded its five player rows, so an early return here made repair
  // impossible even though the evidence was retained.
  if (duplicate) { input.matchId = duplicate.linkedMatchId; ids.submissionId = duplicate.id; }
  const rosterBefore = new Set((db.rosterPlayers || []).map((player: any) => player.id));
  const players = resolveFive(db, input.players, input.addObservedPlayers === true && !input.playerId);
  const addedPlayers = players.filter(row => !rosterBefore.has(row.rosterPlayerId)).map(row => row.rosterDisplayName);
  if (input.playerId && !players.some(row => row.rosterPlayerId === input.playerId)) throw Object.assign(new Error('The submitting player must be one of the five identified players.'), { status: 403 });
  const requested = input.matchId ? (db.matches || []).find((match: Match) => match.id === input.matchId) : null;
  if (input.matchId && !requested) throw Object.assign(new Error('The selected match no longer exists.'), { status: 404 });
  const rosterIds = new Set(players.map(row => row.rosterPlayerId));
  const requestedRosterIds = requested ? matchRosterIds(db, requested.id) : new Set<string>();
  const duplicateOwnMatch = Boolean(duplicate && duplicate.linkedMatchId === requested?.id);
  if (duplicateOwnMatch && requestedRosterIds.size < 5 && [...requestedRosterIds].some(id => !rosterIds.has(id))) throw Object.assign(new Error('Duplicate repair conflicts with identities already linked to this match.'), { status: 409 });
  const repairsOwnDuplicate = Boolean(duplicateOwnMatch && requestedRosterIds.size < 5);
  if (duplicate && duplicate.linkedMatchId === requested?.id && requestedRosterIds.size >= 5 && [...rosterIds].some(id => !requestedRosterIds.has(id))) throw Object.assign(new Error('A duplicate enrichment must keep the same five-player roster as its linked match.'), { status: 409 });
  if (requested && !repairsOwnDuplicate && [...rosterIds].filter(id => matchRosterIds(db, requested.id).has(id)).length < 5 && !hasUniqueKdaCoverage(db, requested.id, players)) throw Object.assign(new Error('The selected match does not contain the same five-player roster or five unique K/D/A rows. Choose the correct match or create a new VOD entry.'), { status: 409 });
  const incomingIdentityRows = players.map(player => ({ playerId: player.rosterPlayerId, player: player.rosterDisplayName }));
  // One shared identity answer; a header-only candidate must also hold all five players.
  // With no identities a date/map header alone could land on another game, so an unnamed import only ever creates its own match.
  const found = !requested && players.length ? findMatchCandidates(db, input, { stats: incomingIdentityRows, unknownMatches: true }) : { basis: null, matches: [] };
  // A match that already holds a submission from this same VOD is another game of it (a re-import of
  // the same game was caught as a duplicate above), so typed or shared names never fold two games into one.
  const otherGameOfThisVod = (match: Match) => (db.vodSubmissions as VodSubmission[]).some(item => item.linkedMatchId === match.id && item.vodUrl === input.vodUrl && item.id !== ids.submissionId);
  const automatic = (found.basis === 'header' ? found.matches.filter((match: Match) => [...rosterIds].every(id => matchRosterIds(db, match.id).has(id))) : found.matches).filter((match: Match) => !otherGameOfThisVod(match));
  let match: Match | undefined = requested || (automatic.length === 1 ? automatic[0] : undefined);
  const createdMatch = !match;
  if (!match) {
    match = {
      id: ids.matchId, date: input.date, type: 'VOD submission', opponent: input.opponent || 'Unknown opponent', map: input.map || 'Unknown map',
      attW: null, attL: null, defW: null, defL: null, ourScore: input.ourScore, theirScore: input.theirScore, vod: input.vodUrl,
      notes: `Created automatically from a ${input.playerId ? 'player' : 'coach'} VOD submission ${players.length ? 'after five roster identities matched' : 'with no player identities yet; scoreboard totals are pending'}.`, source: 'vod-submission',
      sourceMetadata: { method: 'vod-submission', capturedAt: now, provider: 'local-ocr', externalId: ids.submissionId },
      comparisonEvidence: { accepted: true }, rosterContext: { kind: 'mixed' }, vodSubmissionIds: [ids.submissionId],
    };
    db.matches.push(match);
  } else {
    match.vod ||= input.vodUrl;
    match.vodSubmissionIds = [...new Set([...(match.vodSubmissionIds || []), ids.submissionId])];
    if (input.scoreProvenance === 'confirmed-scoreboard' && players.length === 5 && Number.isSafeInteger(input.ourScore) && Number.isSafeInteger(input.theirScore)) applyVerifiedMatchScore(match, input.ourScore, input.theirScore, 'scoreboard');
  }
  let createdStats = 0; let filledFields = 0; let preservedFields = 0;
  const claimedStatIds = new Set<string>();
  for (const observed of players) {
    const matchRows: PlayerStats[] = (db.playerStats || []).filter((row: PlayerStats) => row.matchId === match!.id && !claimedStatIds.has(row.id));
    const candidateNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const kdaMatches = matchRows.filter(row => candidateNumber(row.kills) === candidateNumber(observed.kills) && candidateNumber(row.deaths) === candidateNumber(observed.deaths) && candidateNumber(row.assists) === candidateNumber(observed.assists));
    let stat: PlayerStats | undefined = matchRows.find(row => row.playerId === observed.rosterPlayerId || similarVodName(row.displayNameSnapshot || row.player, observed.rosterDisplayName)) || (kdaMatches.length === 1 ? kdaMatches[0] : undefined);
    if (!stat) {
      stat = { id: ids.statId(), matchId: match.id, playerId: observed.rosterPlayerId, player: observed.rosterDisplayName, displayNameSnapshot: observed.rosterDisplayName, appearanceType: appearanceType(db, observed.rosterPlayerId), agent: observed.agent || 'Unknown', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: null, deaths: null, assists: null, sourceMetadata: { method: 'vod-submission', capturedAt: now, provider: 'local-ocr', externalId: ids.submissionId } };
      db.playerStats.push(stat); createdStats += 1;
    }
    claimedStatIds.add(stat.id);
    // A five-player roster match is accepted identity evidence. Canonicalize
    // legacy anonymous/parser rows instead of leaving a duplicate beside them.
    stat.playerId = observed.rosterPlayerId;
    stat.player = observed.rosterDisplayName;
    stat.displayNameSnapshot = observed.rosterDisplayName;
    stat.appearanceType = appearanceType(db, observed.rosterPlayerId);
    const fields: string[] = [];
    if ((!stat.agent || stat.agent === 'Unknown') && observed.agent) { stat.agent = observed.agent; fields.push('agent'); } else if (observed.agent) preservedFields += 1;
    // A field counted from a kill feed is partial: a board's value replaces it.
    const feedFields = new Set<string>(stat.vodEvidence?.killFeed?.fields || []);
    for (const field of METRIC_FIELDS) {
      const candidate = observed[field];
      if ((stat as any)[field] === null || (stat as any)[field] === undefined || (feedFields.has(field) && candidate !== null)) { if (candidate !== null) { (stat as any)[field] = candidate; fields.push(field); feedFields.delete(field); } }
      else if (candidate !== null) preservedFields += 1;
    }
    filledFields += fields.length;
    const timelineMetric = input.timelineEvidence?.playerMetrics.find(metric => similarVodName(metric.playerName, observed.observedName) || similarVodName(metric.playerName, observed.rosterDisplayName));
    const timelineFields: string[] = [];
    const support = input.timelineEvidence?.coverage.signals || {};
    const setTimelineMetric = (field: keyof PlayerStats, candidate: number | null, signal: string) => {
      if (support[signal] !== 'complete' || candidate === null || candidate === undefined) return;
      if ((stat as any)[field] === null || (stat as any)[field] === undefined) { (stat as any)[field] = candidate; fields.push(String(field)); timelineFields.push(String(field)); }
      else preservedFields += 1;
    };
    if (timelineMetric) {
      setTimelineMetric('trades', timelineMetric.trades, 'trades');
      setTimelineMetric('ultimateUses', timelineMetric.ultimateUses ?? null, 'ultimateUse');
      setTimelineMetric('orbPoints', timelineMetric.orbCaptures ?? null, 'orbCapture');
      setTimelineMetric('kastSuccessful', timelineMetric.kastSuccessful ?? null, 'kast');
      setTimelineMetric('kastCovered', timelineMetric.kastCovered ?? null, 'kast');
    }
    // No board gave kills or deaths: count them from this VOD's kill feed when it resolved any kill at
    // all (zero events means the feed was unread, not that nobody died). Marked partial, never complete.
    const feedResolved = (input.timelineEvidence?.playerMetrics || []).some(metric => (metric.kills || 0) + (metric.deaths || 0) > 0);
    // A TAB board the coach opened mid-game is the base for these (plus the feed after it), and gives assists.
    if (timelineMetric && feedResolved) for (const field of ['kills', 'deaths', 'assists'] as const) {
      const value = timelineMetric[field]; if (!Number.isInteger(value)) continue;
      if ((stat as any)[field] === null || (stat as any)[field] === undefined || feedFields.has(field)) { stat[field] = value as number; feedFields.add(field); fields.push(field); }
    }
    const killFeed = feedFields.size ? { submissionId: ids.submissionId, fields: [...feedFields] as Array<'kills' | 'deaths' | 'assists'>, coverage: 'partial' as const, ...(timelineMetric?.source ? { source: timelineMetric.source } : {}) } : null;
    stat.vodEvidence = {
      ...(killFeed ? { killFeed } : {}),
      submissionIds: [...new Set([...(stat.vodEvidence?.submissionIds || []), ids.submissionId])], fields: [...new Set([...(stat.vodEvidence?.fields || []), ...fields])], updatedAt: now,
      ...(timelineMetric && input.timelineEvidence ? { timeline: { submissionId: ids.submissionId, grade: 'video-observation' as const, coverage: input.timelineEvidence.coverage.signals, metrics: { observedKills: timelineMetric.kills, observedDeaths: timelineMetric.deaths, trades: timelineMetric.trades, ultimateUses: timelineMetric.ultimateUses ?? null, orbCaptures: timelineMetric.orbCaptures ?? null, kastSuccessful: timelineMetric.kastSuccessful ?? null, kastCovered: timelineMetric.kastCovered ?? null } } } : {}),
    };
    filledFields += timelineFields.length;
  }
  db.vodReviews ||= [];
  if (!db.vodReviews.some((review: any) => review.matchId === match!.id && review.vodUrl === input.vodUrl)) db.vodReviews.unshift({ id: ids.reviewId, matchId: match.id, title: `${players.find(row => row.rosterPlayerId === input.playerId)?.rosterDisplayName || actorName} VOD · ${match.map}`, vodUrl: input.vodUrl, date: input.date, createdAt: now, notes: [] });
  const submission: VodSubmission = { schema: 'moetracker.vod-submission/v1', id: ids.submissionId, submittedByPlayerId: input.playerId, submittedByName: players.find(row => row.rosterPlayerId === input.playerId)?.rosterDisplayName || duplicate?.submittedByName || actorName, vodUrl: input.vodUrl, imageSha256: input.imageSha256, date: input.date, map: input.map ?? duplicate?.map ?? null, opponent: input.opponent ?? duplicate?.opponent ?? null, ourScore: input.ourScore ?? duplicate?.ourScore ?? null, theirScore: input.theirScore ?? duplicate?.theirScore ?? null, requestedMatchId: duplicate?.requestedMatchId ?? input.matchId ?? null, linkedMatchId: match.id, linkMode: duplicate?.linkMode || (createdMatch ? 'new-match' : 'existing-match'), status: 'integrated', rosterMatchCount: players.length, players: players.length ? players : duplicate?.players || [], timelineEvidence: input.timelineEvidence || duplicate?.timelineEvidence || null, integration: { createdMatch, createdStats, filledFields, preservedFields, ...(addedPlayers.length ? { addedPlayers } : {}) }, createdAt: duplicate?.createdAt || now, integratedAt: now };
  if (duplicate) Object.assign(duplicate, submission);
  else db.vodSubmissions.unshift(submission);
  const fused = fuseVodEvidence((db.vodSubmissions as VodSubmission[]).filter(item => item.linkedMatchId === match!.id && item.timelineEvidence).map(item => item.timelineEvidence!));
  let derivedScore: ReturnType<typeof applyVodHudScore> = null; let partialScore: ReturnType<typeof applyVodPartialScore> = null;
  if (fused) {
    (match as any).vodTimelineEvidence = fused;
    derivedScore = applyVodHudScore(match, fused, now);
    partialScore = derivedScore ? null : applyVodPartialScore(match, fused, now);
    if (derivedScore) Object.assign(duplicate || submission, { ourScore: match.ourScore, theirScore: match.theirScore });
    db.rounds ||= [];
    const submissionIds = (db.vodSubmissions as VodSubmission[]).filter(item => item.linkedMatchId === match!.id && item.timelineEvidence).map(item => item.id);
    const completeEliminations = fused.coverage.signals.eliminations === 'complete';
    for (const observedRound of fused.rounds || []) {
      const events = (observedRound.events || []).filter((event: any) => event.kind === 'elimination');
      const advantageEvidence = deriveRoundAdvantage({ source: 'vod', complete: completeEliminations && events.length > 0, winner: 'unknown', events: events.map((event: any, index: number) => ({ sequence: index + 1, victimTeam: event.victimTeam })) });
      const existing = db.rounds.find((row: any) => row.matchId === match!.id && row.roundNo === observedRound.roundNumber);
      const automaticResult = advantageEvidence.roundOutcome === 'converted' ? 'W' : advantageEvidence.roundOutcome === 'lost' ? 'L' : '';
      const vodEvidence = { sourceSubmissionIds: submissionIds, roundNumber: observedRound.roundNumber, observations: structuredClone(observedRound.events || []), updatedAt: now };
      if (existing) {
        existing.vodEvidence = vodEvidence;
        if ((!existing.advantageEvidence || existing.advantageEvidence.status !== 'complete') && advantageEvidence.status === 'complete') existing.advantageEvidence = advantageEvidence;
        if (!existing.result && automaticResult) existing.result = automaticResult;
      } else db.rounds.push({ id: `vod:${match!.id}:round:${observedRound.roundNumber}`, matchId: match!.id, roundNo: observedRound.roundNumber, side: '', result: automaticResult, winBy: '', advantageEvidence, vodEvidence, sourceMetadata: { method: 'vod-submission', capturedAt: now, provider: 'local-ocr', externalId: ids.submissionId } });
    }
  }
  if (derivedScore) (duplicate || submission).integration = { ...(duplicate || submission).integration, scoreFromHud: { ourScore: derivedScore.left, theirScore: derivedScore.right, basis: derivedScore.basis } };
  if (partialScore) (duplicate || submission).integration = { ...(duplicate || submission).integration, partialScoreFromHud: { ourScore: partialScore.left, theirScore: partialScore.right } };
  refreshDuplicateQuarantine(db, now);
  return duplicate || submission;
}
