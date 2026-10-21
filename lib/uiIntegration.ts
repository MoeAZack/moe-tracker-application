import type { CoreMembership, Match, PlayerStats, TrackerData, VodReview } from '../src/types';
import { toCairoDateKey } from './coachAnalytics';
import { buildPlayerScreenshotMetrics, combinePlayerScreenshotMetrics, combineStoredScreenshotMetrics } from './scrimRoundAnalytics';
import { identityOcrKey } from './identityResolver';
import { currentAnalyticsPlayerStats } from './activePlayerAnalytics';
import { DEFAULT_MINIMUM_METRIC_SAMPLES, playerRowKastEvidence, publishKast, screenshotKastEvidence, type KastEvidence, type MetricPublication } from './metricTrust';

export type IntegrationReadiness =
  | { status: 'ready'; detail: string }
  | { status: 'unavailable'; reason: 'provider-ineligible' | 'consent-missing' | 'evidence-missing' | 'baseline-missing'; detail: string };

export function normalizedMatchDate(value: string): string | null { return toCairoDateKey(value); }

export function cairoDateKeyAt(date: Date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function matchDateWindow(matches: readonly Match[]) {
  const dates = matches.map(match => normalizedMatchDate(match.date)).filter((date): date is string => date !== null).sort();
  return dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

export function activeRosterCount(data: { coreMemberships?: CoreMembership[]; settings: TrackerData['settings'] }): { count: number; source: 'membership' | 'legacy' } {
  if (Array.isArray(data.coreMemberships)) return { count: data.coreMemberships.filter((member: CoreMembership) => !member.endedAt).length, source: 'membership' };
  return { count: data.settings.players.length, source: 'legacy' };
}

export function resolveInitialVodSelection(reviews: readonly VodReview[], initialMatchId: string | null | undefined): string | null {
  return initialMatchId ? reviews.find(review => review.matchId === initialMatchId)?.id || null : reviews[0]?.id || null;
}

export function selectedVodMatchId(reviews: readonly VodReview[], selectedId: string | null): string | null {
  return reviews.find(review => review.id === selectedId)?.matchId || null;
}

export function vodContextMatchId(reviews: readonly VodReview[], selectedId: string | null, initialMatchId: string | null | undefined, explicitlySelected: boolean): string | null {
  const selected = selectedVodMatchId(reviews, selectedId);
  return selected || (!explicitlySelected && selectedId === null ? initialMatchId || null : null);
}

export interface ObservedPlayerKd {
  identity: string; playerId: string | null; displayName: string; recordedRows: number; pairedSamples: number; kd: number | null;
}

export interface ObservedPlayerDashboard extends ObservedPlayerKd {
  sourceRowIds: string[];
  matches: number; wins: number; losses: number; winRate: number | null; kills: number | null; deaths: number | null; assists: number | null;
  mainAgent: string | null; avgAcs: number | null; avgAdr: number | null; avgHs: number | null;
  firstKills: number | null; firstDeaths: number | null; kast: number | null; kastPublication: MetricPublication;
  recentForm: Array<'W' | 'L' | '—'>; status: 'core' | 'standIn' | 'tryout';
  attackKd: number | null; defenseKd: number | null; plants: number | null; defuses: number | null; trades: number | null;
  multikills: { two: number | null; three: number | null; four: number | null; ace: number | null };
  lowBudgetWins: number | null; highBudgetLosses: number | null; antiEcoLosses: number | null;
  agents: Array<{ name: string; matches: number; wins: number }>;
  maps: Array<{ name: string; matches: number; wins: number }>;
  weapons: Array<{ name: string; rounds: number; wins: number; kills: number; deaths: number }>;
  identityEvidence: { confidence: 'verified' | 'inferred'; aliases: string[]; sourceIdentities: string[] };
  evidence: { performanceRows: number; openingRows: number; screenshotRounds: number; duplicateRowsReconciled: number };
}

export const PLAYER_METRIC_EVIDENCE_LABELS = {
  firstKills: 'First kills', firstDeaths: 'First deaths', trades: 'Trades', twoK: '2K rounds', threeK: '3K rounds', fourK: '4K rounds', aces: 'Aces',
  lowBudgetWins: 'Low-buy wins', highBudgetLosses: 'Full-buy losses', antiEcoLosses: 'Anti-eco losses',
} as const;
export type PlayerMetricEvidenceKey = keyof typeof PLAYER_METRIC_EVIDENCE_LABELS;
export interface PlayerMetricRoundEvidence { metric: PlayerMetricEvidenceKey; matchId: string; roundId: string; roundNo: number; value: number; }

const observedName = (row: PlayerStats) => row.displayNameSnapshot?.trim() || row.player?.trim() || 'Unknown player';
const normalizedObservedName = (value: string) => value.trim().toLocaleLowerCase('en');
const observedIdentity = (row: PlayerStats) => row.playerId?.trim() || `unlinked-name:${normalizedObservedName(observedName(row))}`;

const observedNameKey = (value: string) => identityOcrKey(value) || normalizedObservedName(value);

/**
 * Keep archived-only people out of the live dashboard without throwing away a
 * current player's older appearances. Replay repair can create a new observed
 * identity after the original roster identity was retired; once that happens,
 * every OCR-equivalent historical row belongs to the live observed player.
 */
export function activeObservedPlayerStats(data: Pick<TrackerData, 'playerStats' | 'rosterPlayers'>): PlayerStats[] {
  return currentAnalyticsPlayerStats(data);
}

const reconciledFields: Array<keyof PlayerStats> = ['agent', 'appearanceType', 'kAtt', 'kDef', 'dAtt', 'dDef', 'aAtt', 'aDef', 'kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'fk', 'fd', 'plants', 'defuses', 'trades', 'kastSuccessful', 'kastCovered', 'ultimateUses', 'orbPoints'];
function evidencePriority(row: PlayerStats, field: keyof PlayerStats) {
  const corrected = row.corrections?.some(item => item.fields?.includes(String(field))) ? 100 : 0;
  const source = row.sourceMetadata?.method === 'provider-import' ? 30 : row.sourceMetadata?.method === 'screenshot' ? 25 : row.sourceMetadata?.method === 'manual' ? 20 : 10;
  return corrected + source;
}

/** Reconcile one canonical player contribution per match so duplicate identity
 * rows cannot count once as a match while inflating combat totals twice. */
export function reconcileObservedPlayerRows(rows: readonly PlayerStats[]): PlayerStats[] {
  const byMatch = new Map<string, PlayerStats[]>();
  for (const row of rows) byMatch.set(row.matchId, [...(byMatch.get(row.matchId) || []), row]);
  return [...byMatch.values()].map(group => {
    if (group.length === 1) return group[0];
    const merged = { ...group[0], screenshotMetrics: undefined } as PlayerStats;
    for (const field of reconciledFields) {
      const candidates = group.filter(row => row[field] !== null && row[field] !== undefined && row[field] !== '');
      if (!candidates.length) continue;
      candidates.sort((left, right) => evidencePriority(right, field) - evidencePriority(left, field)
        || String(right.sourceMetadata?.capturedAt || '').localeCompare(String(left.sourceMetadata?.capturedAt || '')));
      (merged as any)[field] = candidates[0][field];
    }
    return merged;
  });
}

export function aggregateObservedPlayerKd(rows: readonly PlayerStats[]): ObservedPlayerKd[] {
  const groups = new Map<string, { playerId: string | null; displayName: string; rows: PlayerStats[] }>();
  rows.forEach(row => {
    const displayName = observedName(row);
    const identity = observedIdentity(row);
    const current = groups.get(identity) || { playerId: row.playerId || null, displayName, rows: [] };
    current.rows.push(row); groups.set(identity, current);
  });
  return [...groups.entries()].map(([identity, group]) => {
    const paired = group.rows.filter(row => typeof row.kills === 'number' && Number.isFinite(row.kills) && row.kills >= 0 && typeof row.deaths === 'number' && Number.isFinite(row.deaths) && row.deaths >= 0);
    const kills = paired.reduce((sum, row) => sum + Number(row.kills), 0);
    const deaths = paired.reduce((sum, row) => sum + Number(row.deaths), 0);
    return { identity, playerId: group.playerId, displayName: group.displayName, recordedRows: group.rows.length, pairedSamples: paired.length, kd: paired.length && deaths > 0 ? kills / deaths : null };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName, 'en') || a.identity.localeCompare(b.identity, 'en'));
}

const knownNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const completeTotal = (rows: readonly PlayerStats[], selector: (row: PlayerStats) => unknown): number | null => {
  const values = rows.map(selector);
  return rows.length > 0 && values.every(knownNumber) ? values.reduce((sum, value) => sum + value, 0) : null;
};
const matchWon = (match: Match | undefined): boolean | null => {
  if (!match) return null;
  if (knownNumber(match.ourScore) && knownNumber(match.theirScore)) return match.ourScore === match.theirScore ? null : match.ourScore > match.theirScore;
  if (![match.attW, match.attL, match.defW, match.defL].every(knownNumber)) return null;
  const won = match.attW + match.defW; const lost = match.attL + match.defL;
  return won + lost > 0 && won !== lost ? won > lost : null;
};

export function aggregateObservedPlayerDashboard(data: Pick<TrackerData, 'playerStats' | 'matches' | 'rosterPlayers' | 'coreMemberships' | 'tryoutBatches'> & { rounds?: TrackerData['rounds']; settings?: Pick<TrackerData['settings'], 'stats'> }): ObservedPlayerDashboard[] {
  const minimumSamples = data.settings?.stats?.lowSample || DEFAULT_MINIMUM_METRIC_SAMPLES;
  const matches = new Map((data.matches || []).map(match => [match.id, match]));
  const playerById = new Map((data.rosterPlayers || []).map(player => [player.id, player]));
  const activeCore = new Set((data.coreMemberships || []).filter(item => !item.endedAt).map(item => item.playerId));
  const activeTryouts = new Set((data.tryoutBatches || []).filter(batch => batch.status === 'active').flatMap(batch => batch.candidatePlayerIds));
  const dashboardNameKey = observedNameKey;
  const activePlayersByName = new Map<string, typeof data.rosterPlayers>();
  for (const player of (data.rosterPlayers || []).filter(player => !player.retiredAt)) {
    const key = dashboardNameKey(player.displayName); if (!key) continue;
    activePlayersByName.set(key, [...(activePlayersByName.get(key) || []), player]);
  }
  const groups = new Map<string, { playerId: string | null; displayName: string; rows: PlayerStats[] }>();
  for (const row of (data.playerStats || [])) {
    const displayName = observedName(row);
    const nameKey = dashboardNameKey(displayName) || normalizedObservedName(displayName);
    const directlyActive = row.playerId?.trim() ? playerById.get(row.playerId.trim()) : undefined;
    const nameCandidates = activePlayersByName.get(nameKey) || [];
    const matchedPlayer = directlyActive && !directlyActive.retiredAt ? directlyActive : nameCandidates.length === 1 ? nameCandidates[0] : null;
    // Replay/name repair can leave historical rows carrying different orphaned
    // IDs for the same observed person. Active roster IDs remain authoritative;
    // otherwise merge exact/OCR-equivalent names for this read-only dashboard.
    const matchedPlayerId = matchedPlayer?.id || null;
    const identity = matchedPlayerId ? `player:${matchedPlayerId}` : `observed-name:${nameKey}`;
    const group = groups.get(identity) || { playerId: matchedPlayerId, displayName, rows: [] };
    group.rows.push(row); groups.set(identity, group);
  }
  const groupIdentitiesByName = new Map<string, Set<string>>();
  for (const [identity, group] of groups) {
    for (const nameKey of new Set(group.rows.map(row => dashboardNameKey(observedName(row))).filter(Boolean))) {
      const identities = groupIdentitiesByName.get(nameKey) || new Set<string>();
      identities.add(identity); groupIdentitiesByName.set(nameKey, identities);
    }
  }
  return [...groups.entries()].map(([identity, group]) => {
    const rawRows = group.rows; const rows = reconcileObservedPlayerRows(rawRows); const matchIds = [...new Set(rows.map(row => row.matchId))];
    const stored = group.playerId ? playerById.get(group.playerId) : undefined;
    if (stored?.displayName) group.displayName = stored.displayName;
    else {
      const names = new Map<string, { value: string; count: number; last: number }>();
      rawRows.forEach((row, index) => { const value = observedName(row); const key = normalizedObservedName(value); const current = names.get(key) || { value, count: 0, last: index }; current.count += 1; current.last = index; names.set(key, current); });
      group.displayName = [...names.values()].sort((a, b) => b.count - a.count || b.last - a.last)[0]?.value || group.displayName;
    }
    const outcomes = matchIds.map(id => matchWon(matches.get(id))); const wins = outcomes.filter(value => value === true).length; const losses = outcomes.filter(value => value === false).length;
    const paired = rows.filter(row => knownNumber(row.kills) && knownNumber(row.deaths));
    const kills = completeTotal(rows, row => row.kills);
    const deaths = completeTotal(rows, row => row.deaths);
    const assists = completeTotal(rows, row => row.assists);
    const average = (selector: (row: PlayerStats) => unknown) => { const found = rows.map(selector); return rows.length > 0 && found.every(knownNumber) ? found.reduce((a, b) => a + b, 0) / found.length : null; };
    const agentMap = new Map<string, { matches: Set<string>; wins: number }>();
    const mapMap = new Map<string, { matches: Set<string>; wins: number }>();
    for (const row of rows) {
      const outcome = matchWon(matches.get(row.matchId)); const agent = row.agent?.trim(); const map = matches.get(row.matchId)?.map?.trim();
      if (agent) { const item = agentMap.get(agent) || { matches: new Set(), wins: 0 }; if (!item.matches.has(row.matchId) && outcome) item.wins++; item.matches.add(row.matchId); agentMap.set(agent, item); }
      if (map) { const item = mapMap.get(map) || { matches: new Set(), wins: 0 }; if (!item.matches.has(row.matchId) && outcome) item.wins++; item.matches.add(row.matchId); mapMap.set(map, item); }
    }
    const agents = [...agentMap].map(([name, item]) => ({ name, matches: item.matches.size, wins: item.wins })).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
    const maps = [...mapMap].map(([name, item]) => ({ name, matches: item.matches.size, wins: item.wins })).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
    const groupNameKeys = new Set(rawRows.map(row => dashboardNameKey(observedName(row))));
    const groupPlayerIds = new Set(rawRows.map(row => row.playerId?.trim()).filter((item): item is string => !!item)); if (group.playerId) groupPlayerIds.add(group.playerId);
    const screenshotCoveredMatches = new Set<string>(); const kastParts: Array<KastEvidence | null> = [];
    const perMatchScreenshots = matchIds.flatMap(matchId => {
      const live = buildPlayerScreenshotMetrics((data.rounds || []).filter(round => round.matchId === matchId))
        .filter(metric => {
          if (groupPlayerIds.has(metric.identity)) return true;
          // A stable screenshot identity may never be overridden by an equal
          // display name. Name fallback is reserved for unlinked evidence and
          // only when exactly one dashboard identity owns that observed name.
          if (!metric.identity.startsWith('unlinked:')) return false;
          const nameKey = dashboardNameKey(metric.displayName);
          return groupNameKeys.has(nameKey) && groupIdentitiesByName.get(nameKey)?.size === 1;
        });
      const evidence = live.length ? live : combineStoredScreenshotMetrics(rawRows.filter(row => row.matchId === matchId));
      const matchRows = rows.filter(row => row.matchId === matchId);
      if (evidence.some(item => item.coveredRounds > 0)) {
        screenshotCoveredMatches.add(matchId);
        kastParts.push(screenshotKastEvidence(evidence.reduce<{ coveredRounds: number; kast?: KastEvidence }>((sum, item) => ({ coveredRounds: sum.coveredRounds + item.coveredRounds, kast: sum.kast && item.kast ? { successful: sum.kast.successful + item.kast.successful, covered: sum.kast.covered + item.kast.covered } : undefined }), { coveredRounds: 0, kast: { successful: 0, covered: 0 } })));
      } else kastParts.push(matchRows.length === 1 ? playerRowKastEvidence(matchRows[0]) : null);
      return evidence;
    });
    const screenshot = combinePlayerScreenshotMetrics(perMatchScreenshots);
    const screenshotCoverageComplete = matchIds.length > 0 && screenshotCoveredMatches.size === matchIds.length;
    const recordedTrades = rows.map(row => row.trades).filter(knownNumber);
    const weapons = new Map<string, { rounds: number; wins: number; kills: number; deaths: number }>();
    for (const metric of screenshot) for (const weapon of metric.weapons || []) { const item = weapons.get(weapon.weapon) || { rounds: 0, wins: 0, kills: 0, deaths: 0 }; item.rounds += weapon.rounds; item.wins += weapon.wins; item.kills += weapon.kills; item.deaths += weapon.deaths; weapons.set(weapon.weapon, item); }
    const attackKills = completeTotal(rows, row => row.kAtt); const attackDeaths = completeTotal(rows, row => row.dAtt);
    const defenseKills = completeTotal(rows, row => row.kDef); const defenseDeaths = completeTotal(rows, row => row.dDef);
    const directFirstKills = completeTotal(rows, row => row.fk); const directFirstDeaths = completeTotal(rows, row => row.fd);
    const firstKills = directFirstKills !== null ? directFirstKills : screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.firstKills, 0) : null;
    const firstDeaths = directFirstDeaths !== null ? directFirstDeaths : screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.firstDeaths, 0) : null;
    const kast = publishKast(kastParts, minimumSamples);
    const appearanceCounts = new Map<'core' | 'standIn' | 'tryout', { count: number; last: number }>();
    rows.forEach((row, index) => { if (!row.appearanceType) return; const current = appearanceCounts.get(row.appearanceType) || { count: 0, last: index }; current.count += 1; current.last = index; appearanceCounts.set(row.appearanceType, current); });
    const observedStatus = [...appearanceCounts].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last)[0]?.[0];
    const status = (group.playerId && activeCore.has(group.playerId) ? 'core' : stored?.rosterStatus || (group.playerId && activeTryouts.has(group.playerId) ? 'tryout' : observedStatus)) || 'tryout';
    return {
      identity, playerId: group.playerId, displayName: group.displayName, sourceRowIds: rawRows.map(row => row.id), recordedRows: rows.length, pairedSamples: paired.length,
      matches: matchIds.length, wins, losses, winRate: outcomes.length > 0 && outcomes.every(value => value !== null) ? wins / outcomes.length : null,
      kills, deaths, assists, kd: kills !== null && deaths !== null ? ratio(kills, deaths) : null, mainAgent: agents[0]?.name || null,
      avgAcs: average(row => row.acs), avgAdr: average(row => row.adr), avgHs: average(row => row.hs), firstKills, firstDeaths,
      kast: kast.value === null ? null : kast.value / 100, kastPublication: kast,
      recentForm: matchIds.sort((a, b) => String(matches.get(b)?.date || '').localeCompare(String(matches.get(a)?.date || ''))).slice(0, 5).map(id => { const won = matchWon(matches.get(id)); return won === null ? '—' : won ? 'W' : 'L'; }),
      status, attackKd: attackKills !== null && attackDeaths !== null ? ratio(attackKills, attackDeaths) : null,
      defenseKd: defenseKills !== null && defenseDeaths !== null ? ratio(defenseKills, defenseDeaths) : null,
      plants: completeTotal(rows, row => row.plants),
      defuses: completeTotal(rows, row => row.defuses),
      trades: recordedTrades.length === rows.length ? recordedTrades.reduce((sum, value) => sum + value, 0) : screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + (item.trades || 0), 0) : null,
      multikills: { two: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.multikills.two, 0) : null, three: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.multikills.three, 0) : null, four: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.multikills.four, 0) : null, ace: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.multikills.ace, 0) : null },
      lowBudgetWins: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.lowBudgetWins, 0) : null, highBudgetLosses: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.highBudgetLosses, 0) : null, antiEcoLosses: screenshotCoverageComplete ? screenshot.reduce((sum, item) => sum + item.antiEcoLosses, 0) : null,
      agents, maps, weapons: [...weapons].map(([name, item]) => ({ name, ...item })).sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)),
      identityEvidence: { confidence: (group.playerId ? 'verified' : 'inferred') as 'verified' | 'inferred', aliases: [...new Set(rawRows.map(observedName))].sort(), sourceIdentities: [...new Set(rawRows.map(observedIdentity))].sort() },
      evidence: { performanceRows: rows.filter(row => knownNumber(row.acs) || knownNumber(row.adr) || knownNumber(row.hs)).length, openingRows: rows.filter(row => knownNumber(row.fk) || knownNumber(row.fd)).length, screenshotRounds: screenshot.reduce((sum, item) => sum + item.coveredRounds, 0), duplicateRowsReconciled: rawRows.length - rows.length },
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName, 'en') || a.identity.localeCompare(b.identity, 'en'));
}

/** Return only confirmed screenshot rounds that actually contributed to one
 * displayed metric. Stable identities are exact; an unlinked name is accepted
 * only when the dashboard has one unambiguous candidate for that name. */
export function playerMetricRoundEvidence(
  data: Pick<TrackerData, 'playerStats' | 'matches' | 'rosterPlayers' | 'coreMemberships' | 'tryoutBatches'> & { rounds?: TrackerData['rounds'] },
  player: Pick<ObservedPlayerDashboard, 'identity' | 'sourceRowIds'>,
): Record<PlayerMetricEvidenceKey, PlayerMetricRoundEvidence[]> {
  const output = Object.fromEntries(Object.keys(PLAYER_METRIC_EVIDENCE_LABELS).map(key => [key, []])) as Record<PlayerMetricEvidenceKey, PlayerMetricRoundEvidence[]>;
  const sourceIds = new Set(player.sourceRowIds);
  const sourceRows = (data.playerStats || []).filter(row => sourceIds.has(row.id));
  const matchIds = new Set(sourceRows.map(row => row.matchId));
  const stableIds = new Set(sourceRows.map(row => row.playerId?.trim()).filter((id): id is string => !!id));
  const nameKeys = new Set(sourceRows.map(row => observedNameKey(observedName(row))).filter(Boolean));
  const identitiesByName = new Map<string, Set<string>>();
  for (const dashboard of aggregateObservedPlayerDashboard(data)) {
    for (const alias of dashboard.identityEvidence.aliases) {
      const key = observedNameKey(alias); if (!key) continue;
      const identities = identitiesByName.get(key) || new Set<string>(); identities.add(dashboard.identity); identitiesByName.set(key, identities);
    }
  }
  const belongsToPlayer = (metric: ReturnType<typeof buildPlayerScreenshotMetrics>[number]) => {
    if (stableIds.has(metric.identity)) return true;
    if (!metric.identity.startsWith('unlinked:')) return false;
    const key = observedNameKey(metric.displayName);
    return nameKeys.has(key) && identitiesByName.get(key)?.size === 1;
  };
  const add = (metric: PlayerMetricEvidenceKey, round: TrackerData['rounds'][number], value: number) => {
    if (value > 0) output[metric].push({ metric, matchId: round.matchId, roundId: round.id, roundNo: round.roundNo, value });
  };
  for (const round of data.rounds || []) {
    if (!matchIds.has(round.matchId) || round.screenshotEvidence?.reviewStatus !== 'confirmed') continue;
    for (const metric of buildPlayerScreenshotMetrics([round]).filter(belongsToPlayer)) {
      add('firstKills', round, metric.firstKills); add('firstDeaths', round, metric.firstDeaths); add('trades', round, metric.trades || 0);
      add('twoK', round, metric.multikills.two); add('threeK', round, metric.multikills.three); add('fourK', round, metric.multikills.four); add('aces', round, metric.multikills.ace);
      add('lowBudgetWins', round, metric.lowBudgetWins); add('highBudgetLosses', round, metric.highBudgetLosses); add('antiEcoLosses', round, metric.antiEcoLosses);
    }
  }
  return output;
}

const values = (value: any): any[] => Array.isArray(value) ? value : Object.values(value || {});
export function replayIntegrationReadiness(payload: any): IntegrationReadiness {
  const records = values(payload?.replay);
  const accepted = records.filter(item => item?.status === 'accepted').length;
  return records.length ? { status: 'ready', detail: `${records.length} persisted replay review${records.length === 1 ? '' : 's'}; ${accepted} accepted.` } : { status: 'unavailable', reason: 'evidence-missing', detail: 'No persisted replay evidence exists for the active season.' };
}
export function shadowRatingReadiness(payload?: any): IntegrationReadiness {
  const records = values(Array.isArray(payload?.ratings) ? payload.ratings : payload?.ratings?.records);
  const eligible = records.filter(item => item?.status === 'accepted' && (item?.acceptedWithCoverage === true || item?.result?.eligibleForShadowAggregate === true)).length;
  const calibrated = records.filter(item => item?.calibrationStatus === 'calibrated').length;
  return records.length ? { status: 'ready', detail: `${records.length} persisted shadow record${records.length === 1 ? '' : 's'}; ${eligible} accepted with coverage; ${calibrated} calibrated.` } : { status: 'unavailable', reason: 'baseline-missing', detail: 'No recomputed rating record exists for the active season.' };
}
export function rankedIntegrationReadiness(payload?: any): IntegrationReadiness {
  const providers = values(payload?.ranked?.providers); const accounts = values(payload?.ranked?.accounts);
  const consents = values(payload?.ranked?.consents).filter(item => !item?.revokedAt); const states = values(payload?.ranked?.states);
  if (!providers.length && !accounts.length && !states.length) return { status: 'unavailable', reason: 'provider-ineligible', detail: 'No persisted ranked provider capability or active-season account exists.' };
  if (!consents.length) return { status: 'unavailable', reason: 'consent-missing', detail: `${accounts.length} persisted account${accounts.length === 1 ? '' : 's'}; explicit player consent is missing.` };
  const counts = ['fresh', 'partial', 'stale', 'error', 'blocked', 'never-synced'].map(status => `${states.filter(item => item?.status === status).length} ${status}`).join(', ');
  return { status: 'ready', detail: `${consents.length} active consent${consents.length === 1 ? '' : 's'}; sync remains disabled. Health: ${counts}.` };
}
export const canOpenPrivateMatchReview = (role: string | null): boolean => role === 'coach';

export function engineAdapterUiSummary(payload: any) {
  const replay = Array.isArray(payload?.replay) ? payload.replay : Object.values(payload?.replay || {});
  const ratings = Array.isArray(payload?.ratings) ? payload.ratings : Object.values(payload?.ratings?.records || {});
  const consents = Object.values(payload?.ranked?.consents || {});
  return {
    replay: { configured: replay.some((item: any) => item?.status === 'accepted'), note: `${replay.length} persisted review${replay.length === 1 ? '' : 's'}; acceptance required` },
    shadowRating: { configured: ratings.some((item: any) => item?.status === 'accepted'), note: `${ratings.length} recomputed shadow record${ratings.length === 1 ? '' : 's'}; uncalibrated results stay experimental and never authoritative` },
    rankedConsent: { configured: consents.some((item: any) => !item?.revokedAt), note: 'Offline consent/status only; provider sync remains disabled' },
  };
}
