import type { Match, PlayerStats, VodSubmission, VodSubmissionPlayer, VodTimelineEvidence } from '../src/types';

type SubmissionInput = {
  vodUrl: string; imageSha256: string; matchId?: string; playerId: string; date: string; map: string | null; opponent: string | null;
  ourScore: number | null; theirScore: number | null;
  players: Array<Omit<VodSubmissionPlayer, 'rosterPlayerId' | 'rosterDisplayName'>>;
  timelineEvidence?: VodTimelineEvidence | null;
};

const METRIC_FIELDS = ['kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'fk', 'fd', 'plants', 'defuses', 'trades'] as const;

export function normalizeVodName(value: string) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function similarVodName(left: string, right: string) {
  const a = normalizeVodName(left); const b = normalizeVodName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) * .2));
}

function resolveFive(db: any, rows: SubmissionInput['players']): VodSubmissionPlayer[] {
  const roster = (db.rosterPlayers || []).filter((player: any) => !player.retiredAt);
  const resolved = rows.map(row => {
    const candidates = roster.filter((player: any) => similarVodName(row.observedName, player.displayName));
    if (candidates.length !== 1) throw Object.assign(new Error(`“${row.observedName}” must match exactly one active roster player before this VOD can be integrated.`), { status: 409 });
    return { ...row, rosterPlayerId: candidates[0].id, rosterDisplayName: candidates[0].displayName };
  });
  if (new Set(resolved.map(row => row.rosterPlayerId)).size !== 5) throw Object.assign(new Error('The VOD must identify five different active roster players.'), { status: 409 });
  return resolved;
}

function matchRosterIds(db: any, matchId: string) {
  return new Set((db.playerStats || []).filter((row: any) => row.matchId === matchId).map((row: any) => row.playerId || (db.rosterPlayers || []).find((player: any) => similarVodName(row.displayNameSnapshot || row.player, player.displayName))?.id).filter(Boolean));
}

function identityMatches(input: SubmissionInput, match: Match) {
  const sameDate = match.date === input.date;
  const sameMap = !input.map || !match.map || normalizeVodName(match.map) === normalizeVodName(input.map);
  const sameOpponent = !input.opponent || !match.opponent || similarVodName(input.opponent, match.opponent);
  const sameScore = input.ourScore === null || input.theirScore === null || match.ourScore === null || match.ourScore === undefined || match.theirScore === null || match.theirScore === undefined || (match.ourScore === input.ourScore && match.theirScore === input.theirScore);
  return sameDate && sameMap && sameOpponent && sameScore;
}

function appearanceType(db: any, playerId: string) {
  if ((db.coreMemberships || []).some((member: any) => member.playerId === playerId && !member.endedAt)) return 'core';
  if ((db.tryoutBatches || []).some((batch: any) => batch.status === 'active' && batch.candidatePlayerIds?.includes(playerId))) return 'tryout';
  return 'standIn';
}

export function integrateVodSubmission(db: any, input: SubmissionInput, actorName: string, ids: { submissionId: string; matchId: string; statId: () => string; reviewId: string }, now = new Date().toISOString()): VodSubmission {
  db.vodSubmissions ||= [];
  const duplicate = db.vodSubmissions.find((item: VodSubmission) => item.submittedByPlayerId === input.playerId && item.imageSha256 === input.imageSha256 && item.vodUrl === input.vodUrl);
  if (duplicate && (!input.timelineEvidence || duplicate.timelineEvidence)) return duplicate;
  if (duplicate) { input.matchId = duplicate.linkedMatchId; ids.submissionId = duplicate.id; }
  const players = resolveFive(db, input.players);
  if (!players.some(row => row.rosterPlayerId === input.playerId)) throw Object.assign(new Error('The submitting player must be one of the five identified players.'), { status: 403 });
  const requested = input.matchId ? (db.matches || []).find((match: Match) => match.id === input.matchId) : null;
  if (input.matchId && !requested) throw Object.assign(new Error('The selected match no longer exists.'), { status: 404 });
  const rosterIds = new Set(players.map(row => row.rosterPlayerId));
  if (requested && [...rosterIds].filter(id => matchRosterIds(db, requested.id).has(id)).length < 5) throw Object.assign(new Error('The selected match does not contain the same five-player roster. Choose the correct match or create a new VOD entry.'), { status: 409 });
  const automatic = !requested ? (db.matches || []).filter((match: Match) => identityMatches(input, match) && [...rosterIds].every(id => matchRosterIds(db, match.id).has(id))) : [];
  let match: Match | undefined = requested || (automatic.length === 1 ? automatic[0] : undefined);
  const createdMatch = !match;
  if (!match) {
    match = {
      id: ids.matchId, date: input.date, type: 'VOD submission', opponent: input.opponent || 'Unknown opponent', map: input.map || 'Unknown map',
      attW: null, attL: null, defW: null, defL: null, ourScore: input.ourScore, theirScore: input.theirScore, vod: input.vodUrl,
      notes: 'Created automatically from a player VOD submission after five roster identities matched.', source: 'vod-submission',
      sourceMetadata: { method: 'vod-submission', capturedAt: now, provider: 'local-ocr', externalId: ids.submissionId },
      comparisonEvidence: { accepted: true }, rosterContext: { kind: 'mixed' }, vodSubmissionIds: [ids.submissionId],
    };
    db.matches.push(match);
  } else {
    match.vod ||= input.vodUrl;
    match.vodSubmissionIds = [...new Set([...(match.vodSubmissionIds || []), ids.submissionId])];
  }
  let createdStats = 0; let filledFields = 0; let preservedFields = 0;
  for (const observed of players) {
    let stat: PlayerStats | undefined = (db.playerStats || []).find((row: PlayerStats) => row.matchId === match!.id && (row.playerId === observed.rosterPlayerId || similarVodName(row.displayNameSnapshot || row.player, observed.rosterDisplayName)));
    if (!stat) {
      stat = { id: ids.statId(), matchId: match.id, playerId: observed.rosterPlayerId, player: observed.rosterDisplayName, displayNameSnapshot: observed.rosterDisplayName, appearanceType: appearanceType(db, observed.rosterPlayerId), agent: observed.agent || 'Unknown', kAtt: null, kDef: null, dAtt: null, dDef: null, aAtt: null, aDef: null, kills: null, deaths: null, assists: null, sourceMetadata: { method: 'vod-submission', capturedAt: now, provider: 'local-ocr', externalId: ids.submissionId } };
      db.playerStats.push(stat); createdStats += 1;
    }
    const fields: string[] = [];
    if ((!stat.agent || stat.agent === 'Unknown') && observed.agent) { stat.agent = observed.agent; fields.push('agent'); } else if (observed.agent) preservedFields += 1;
    for (const field of METRIC_FIELDS) {
      const candidate = observed[field];
      if ((stat as any)[field] === null || (stat as any)[field] === undefined) { if (candidate !== null) { (stat as any)[field] = candidate; fields.push(field); } }
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
    stat.vodEvidence = {
      submissionIds: [...new Set([...(stat.vodEvidence?.submissionIds || []), ids.submissionId])], fields: [...new Set([...(stat.vodEvidence?.fields || []), ...fields])], updatedAt: now,
      ...(timelineMetric && input.timelineEvidence ? { timeline: { submissionId: ids.submissionId, grade: 'video-observation' as const, coverage: input.timelineEvidence.coverage.signals, metrics: { observedKills: timelineMetric.kills, observedDeaths: timelineMetric.deaths, trades: timelineMetric.trades, ultimateUses: timelineMetric.ultimateUses ?? null, orbCaptures: timelineMetric.orbCaptures ?? null, kastSuccessful: timelineMetric.kastSuccessful ?? null, kastCovered: timelineMetric.kastCovered ?? null } } } : {}),
    };
    filledFields += timelineFields.length;
  }
  db.vodReviews ||= [];
  if (!db.vodReviews.some((review: any) => review.matchId === match!.id && review.vodUrl === input.vodUrl)) db.vodReviews.unshift({ id: ids.reviewId, matchId: match.id, title: `${players.find(row => row.rosterPlayerId === input.playerId)?.rosterDisplayName || actorName} VOD · ${match.map}`, vodUrl: input.vodUrl, date: input.date, createdAt: now, notes: [] });
  const submission: VodSubmission = { schema: 'moetracker.vod-submission/v1', id: ids.submissionId, submittedByPlayerId: input.playerId, submittedByName: players.find(row => row.rosterPlayerId === input.playerId)?.rosterDisplayName || actorName, vodUrl: input.vodUrl, imageSha256: input.imageSha256, date: input.date, map: input.map, opponent: input.opponent, ourScore: input.ourScore, theirScore: input.theirScore, requestedMatchId: input.matchId || null, linkedMatchId: match.id, linkMode: createdMatch ? 'new-match' : 'existing-match', status: 'integrated', rosterMatchCount: 5, players, timelineEvidence: input.timelineEvidence || null, integration: { createdMatch, createdStats, filledFields, preservedFields }, createdAt: now, integratedAt: now };
  if (duplicate) { Object.assign(duplicate, { timelineEvidence: submission.timelineEvidence, integration: submission.integration, integratedAt: now }); return duplicate; }
  db.vodSubmissions.unshift(submission); return submission;
}
