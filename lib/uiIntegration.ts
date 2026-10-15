import type { CoreMembership, Match, PlayerStats, TrackerData, VodReview } from '../src/types';
import { toCairoDateKey } from './coachAnalytics';
import { buildPlayerScreenshotMetrics, combinePlayerScreenshotMetrics, combineStoredScreenshotMetrics } from './scrimRoundAnalytics';

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
  matches: number; wins: number; losses: number; winRate: number | null; kills: number; deaths: number; assists: number;
  mainAgent: string | null; avgAcs: number | null; avgAdr: number | null; avgHs: number | null;
  firstKills: number | null; firstDeaths: number | null; kast: number | null;
  recentForm: Array<'W' | 'L' | '—'>; status: 'core' | 'standIn' | 'tryout';
  attackKd: number | null; defenseKd: number | null; plants: number; defuses: number; trades: number | null;
  multikills: { two: number; three: number; four: number; ace: number };
  lowBudgetWins: number; highBudgetLosses: number; antiEcoLosses: number;
  agents: Array<{ name: string; matches: number; wins: number }>;
  maps: Array<{ name: string; matches: number; wins: number }>;
  weapons: Array<{ name: string; rounds: number; wins: number; kills: number; deaths: number }>;
  evidence: { performanceRows: number; openingRows: number; screenshotRounds: number };
}

const observedName = (row: PlayerStats) => row.displayNameSnapshot?.trim() || row.player?.trim() || 'Unknown player';
const normalizedObservedName = (value: string) => value.trim().toLocaleLowerCase('en');
const observedIdentity = (row: PlayerStats) => row.playerId?.trim() || `unlinked-name:${normalizedObservedName(observedName(row))}`;

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
const matchWon = (match: Match | undefined): boolean | null => {
  if (!match) return null;
  if (knownNumber(match.ourScore) && knownNumber(match.theirScore)) return match.ourScore > match.theirScore;
  const won = (match.attW || 0) + (match.defW || 0); const lost = (match.attL || 0) + (match.defL || 0);
  return won + lost > 0 ? won > lost : null;
};

export function aggregateObservedPlayerDashboard(data: Pick<TrackerData, 'playerStats' | 'matches' | 'rosterPlayers' | 'coreMemberships' | 'tryoutBatches'> & { rounds?: TrackerData['rounds'] }): ObservedPlayerDashboard[] {
  const matches = new Map((data.matches || []).map(match => [match.id, match]));
  const playerById = new Map((data.rosterPlayers || []).map(player => [player.id, player]));
  const activeCore = new Set((data.coreMemberships || []).filter(item => !item.endedAt).map(item => item.playerId));
  const activeTryouts = new Set((data.tryoutBatches || []).filter(batch => batch.status === 'active').flatMap(batch => batch.candidatePlayerIds));
  const activePlayerByName = new Map((data.rosterPlayers || []).filter(player => !player.retiredAt).map(player => [normalizedObservedName(player.displayName), player.id]));
  const liveScreenshotByIdentity = new Map(combinePlayerScreenshotMetrics(buildPlayerScreenshotMetrics(data.rounds || []))
    .map(metric => [metric.identity, metric]));
  const groups = new Map<string, { playerId: string | null; displayName: string; rows: PlayerStats[] }>();
  for (const row of (data.playerStats || [])) {
    const displayName = observedName(row);
    const matchedPlayerId = row.playerId?.trim() || activePlayerByName.get(normalizedObservedName(displayName)) || null;
    const identity = matchedPlayerId || `unlinked-name:${normalizedObservedName(displayName)}`;
    const group = groups.get(identity) || { playerId: matchedPlayerId, displayName, rows: [] };
    group.rows.push(row); groups.set(identity, group);
  }
  return [...groups.entries()].map(([identity, group]) => {
    const rows = group.rows; const matchIds = [...new Set(rows.map(row => row.matchId))];
    const outcomes = matchIds.map(id => matchWon(matches.get(id))); const wins = outcomes.filter(value => value === true).length; const losses = outcomes.filter(value => value === false).length;
    const paired = rows.filter(row => knownNumber(row.kills) && knownNumber(row.deaths));
    const kills = rows.reduce((sum, row) => sum + (knownNumber(row.kills) ? row.kills : 0), 0);
    const deaths = rows.reduce((sum, row) => sum + (knownNumber(row.deaths) ? row.deaths : 0), 0);
    const assists = rows.reduce((sum, row) => sum + (knownNumber(row.assists) ? row.assists : 0), 0);
    const average = (selector: (row: PlayerStats) => unknown) => { const found = rows.map(selector).filter(knownNumber); return found.length ? found.reduce((a, b) => a + b, 0) / found.length : null; };
    const agentMap = new Map<string, { matches: Set<string>; wins: number }>();
    const mapMap = new Map<string, { matches: Set<string>; wins: number }>();
    for (const row of rows) {
      const outcome = matchWon(matches.get(row.matchId)); const agent = row.agent?.trim(); const map = matches.get(row.matchId)?.map?.trim();
      if (agent) { const item = agentMap.get(agent) || { matches: new Set(), wins: 0 }; if (!item.matches.has(row.matchId) && outcome) item.wins++; item.matches.add(row.matchId); agentMap.set(agent, item); }
      if (map) { const item = mapMap.get(map) || { matches: new Set(), wins: 0 }; if (!item.matches.has(row.matchId) && outcome) item.wins++; item.matches.add(row.matchId); mapMap.set(map, item); }
    }
    const agents = [...agentMap].map(([name, item]) => ({ name, matches: item.matches.size, wins: item.wins })).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
    const maps = [...mapMap].map(([name, item]) => ({ name, matches: item.matches.size, wins: item.wins })).sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));
    const liveScreenshot = liveScreenshotByIdentity.get(group.playerId || `unlinked-name:${normalizedObservedName(group.displayName)}`);
    const storedScreenshot = combineStoredScreenshotMetrics(rows);
    const screenshot = liveScreenshot ? [liveScreenshot] : storedScreenshot;
    const recordedTrades = rows.map(row => row.trades).filter(knownNumber);
    const weapons = new Map<string, { rounds: number; wins: number; kills: number; deaths: number }>();
    for (const metric of screenshot) for (const weapon of metric.weapons || []) { const item = weapons.get(weapon.weapon) || { rounds: 0, wins: 0, kills: 0, deaths: 0 }; item.rounds += weapon.rounds; item.wins += weapon.wins; item.kills += weapon.kills; item.deaths += weapon.deaths; weapons.set(weapon.weapon, item); }
    const attackKills = rows.reduce((sum, row) => sum + (knownNumber(row.kAtt) ? row.kAtt : 0), 0); const attackDeaths = rows.reduce((sum, row) => sum + (knownNumber(row.dAtt) ? row.dAtt : 0), 0);
    const defenseKills = rows.reduce((sum, row) => sum + (knownNumber(row.kDef) ? row.kDef : 0), 0); const defenseDeaths = rows.reduce((sum, row) => sum + (knownNumber(row.dDef) ? row.dDef : 0), 0);
    const firstKills = rows.some(row => knownNumber(row.fk)) ? rows.reduce((sum, row) => sum + (knownNumber(row.fk) ? row.fk : 0), 0) : screenshot.length ? screenshot.reduce((sum, item) => sum + item.firstKills, 0) : null;
    const firstDeaths = rows.some(row => knownNumber(row.fd)) ? rows.reduce((sum, row) => sum + (knownNumber(row.fd) ? row.fd : 0), 0) : screenshot.length ? screenshot.reduce((sum, item) => sum + item.firstDeaths, 0) : null;
    const directKastRows = rows.filter(row => !row.screenshotMetrics && knownNumber(row.kastSuccessful) && knownNumber(row.kastCovered) && row.kastCovered > 0);
    const kastSuccessful = screenshot.reduce((sum, item) => sum + (item.kast?.successful || 0), 0) + directKastRows.reduce((sum, row) => sum + row.kastSuccessful!, 0);
    const kastCovered = screenshot.reduce((sum, item) => sum + (item.kast?.covered || 0), 0) + directKastRows.reduce((sum, row) => sum + row.kastCovered!, 0);
    const stored = group.playerId ? playerById.get(group.playerId) : undefined;
    const status = (group.playerId && activeCore.has(group.playerId) ? 'core' : stored?.rosterStatus || (group.playerId && activeTryouts.has(group.playerId) ? 'tryout' : rows.find(row => row.appearanceType)?.appearanceType)) || 'tryout';
    return {
      identity, playerId: group.playerId, displayName: group.displayName, recordedRows: rows.length, pairedSamples: paired.length,
      matches: matchIds.length, wins, losses, winRate: outcomes.some(value => value !== null) ? wins / outcomes.filter(value => value !== null).length : null,
      kills, deaths, assists, kd: paired.length ? ratio(kills, deaths) : null, mainAgent: agents[0]?.name || null,
      avgAcs: average(row => row.acs), avgAdr: average(row => row.adr), avgHs: average(row => row.hs), firstKills, firstDeaths,
      kast: kastCovered ? kastSuccessful / kastCovered : null,
      recentForm: matchIds.sort((a, b) => String(matches.get(b)?.date || '').localeCompare(String(matches.get(a)?.date || ''))).slice(0, 5).map(id => { const won = matchWon(matches.get(id)); return won === null ? '—' : won ? 'W' : 'L'; }),
      status, attackKd: rows.some(row => knownNumber(row.kAtt) && knownNumber(row.dAtt)) ? ratio(attackKills, attackDeaths) : null,
      defenseKd: rows.some(row => knownNumber(row.kDef) && knownNumber(row.dDef)) ? ratio(defenseKills, defenseDeaths) : null,
      plants: rows.reduce((sum, row) => sum + (knownNumber(row.plants) ? row.plants : 0), 0), defuses: rows.reduce((sum, row) => sum + (knownNumber(row.defuses) ? row.defuses : 0), 0), trades: recordedTrades.length ? recordedTrades.reduce((sum, value) => sum + value, 0) : screenshot.length ? screenshot.reduce((sum, item) => sum + (item.trades || 0), 0) : null,
      multikills: { two: screenshot.reduce((sum, item) => sum + item.multikills.two, 0), three: screenshot.reduce((sum, item) => sum + item.multikills.three, 0), four: screenshot.reduce((sum, item) => sum + item.multikills.four, 0), ace: screenshot.reduce((sum, item) => sum + item.multikills.ace, 0) },
      lowBudgetWins: screenshot.reduce((sum, item) => sum + item.lowBudgetWins, 0), highBudgetLosses: screenshot.reduce((sum, item) => sum + item.highBudgetLosses, 0), antiEcoLosses: screenshot.reduce((sum, item) => sum + item.antiEcoLosses, 0),
      agents, maps, weapons: [...weapons].map(([name, item]) => ({ name, ...item })).sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)),
      evidence: { performanceRows: rows.filter(row => knownNumber(row.acs) || knownNumber(row.adr) || knownNumber(row.hs)).length, openingRows: rows.filter(row => knownNumber(row.fk) || knownNumber(row.fd)).length, screenshotRounds: screenshot.reduce((sum, item) => sum + item.coveredRounds, 0) },
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName, 'en') || a.identity.localeCompare(b.identity, 'en'));
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
