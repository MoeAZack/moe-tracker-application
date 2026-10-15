import type { CoreMembership, Match, PlayerStats, PracticeBlock, RosterPlayer, Round, TryoutDecisionNote } from '../src/types';
import { isInCairoDateWindow, type CairoDateWindow } from './coachAnalytics';
import { resolvePracticeBlocks } from './practiceBlocks';

export const TRYOUT_COMPARISON_VERSION = 'tryout-comparison/v1' as const;
export type ComparisonMode = 'player-player' | 'tryout-core-average' | 'own-previous-period' | 'block-block' | 'agent-split' | 'map-split' | 'att-def';
export type ComparisonSide = 'all' | 'ATT' | 'DEF';
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export type MetricDirection = 'higher-better' | 'lower-better' | 'neutral';

export interface ComparisonFilter {
  window?: CairoDateWindow;
  maps?: string[];
  agents?: string[];
  roles?: string[];
  side?: ComparisonSide;
  compositions?: string[];
  opponentCategories?: string[];
  blockIds?: string[];
}

export interface ComparisonQuery {
  mode: ComparisonMode;
  leftId: string;
  rightId?: string;
  previousWindow?: CairoDateWindow;
  leftContext?: string;
  rightContext?: string;
  filters?: ComparisonFilter;
  minimumSamples?: number;
  mapScope?: { mode: 'all' | 'active'; sourceMatchCount: number; includedMatchCount: number; excludedMatchCount: number; emptyActivePool: boolean };
}

export interface ComparisonData {
  matches: readonly Match[];
  playerStats: readonly PlayerStats[];
  rounds: readonly Round[];
  rosterPlayers: readonly RosterPlayer[];
  coreMemberships?: readonly CoreMembership[];
  practiceBlocks?: readonly PracticeBlock[];
}

export interface ComparisonMetric {
  id: string;
  label: string;
  direction: MetricDirection;
  left: number | null;
  right: number | null;
  delta: number | null;
  leftSamples: number;
  rightSamples: number;
  leftCoverage: { covered: number; total: number };
  rightCoverage: { covered: number; total: number };
  leftNumerator: number | null;
  leftDenominator: number | null;
  rightNumerator: number | null;
  rightDenominator: number | null;
  confidence: Confidence;
  unknownReason: string | null;
}

type Acc = { total: number; samples: number; covered: number; possible: number };
type MetricSpec = { id: string; label: string; direction: MetricDirection; finish: (a: Accumulator) => { value: number | null; samples: number; coverage: { covered: number; total: number }; numerator?: number | null; denominator?: number | null } };
type Accumulator = Record<string, Acc> & { matchIds: Set<string> };

const add = (a: Acc, value: unknown) => { a.possible += 1; if (typeof value === 'number' && Number.isFinite(value) && value >= 0) { a.total += value; a.samples += 1; a.covered += 1; } };
const counter = (): Acc => ({ total: 0, samples: 0, covered: 0, possible: 0 });
const average = (id: string, label: string, direction: MetricDirection): MetricSpec => ({ id, label, direction, finish: a => ({ value: a[id].samples ? a[id].total / a[id].samples : null, samples: a[id].samples, coverage: { covered: a[id].covered, total: a[id].possible } }) });
const total = (id: string, label: string, direction: MetricDirection): MetricSpec => ({ id, label, direction, finish: a => ({ value: a[id].samples ? a[id].total / a[id].samples : null, samples: a[id].samples, coverage: { covered: a[id].covered, total: a[id].possible }, numerator: a[id].samples ? a[id].total : null, denominator: a[id].samples || null }) });
const ratio = (id: string, label: string, numerator: string, denominator: string, direction: MetricDirection): MetricSpec => ({ id, label, direction, finish: a => ({ value: a[numerator].samples && a[denominator].samples && a[denominator].total > 0 ? a[numerator].total / a[denominator].total : null, samples: Math.min(a[numerator].samples, a[denominator].samples), coverage: { covered: Math.min(a[numerator].covered, a[denominator].covered), total: Math.max(a[numerator].possible, a[denominator].possible) }, numerator: a[numerator].samples ? a[numerator].total : null, denominator: a[denominator].samples ? a[denominator].total : null }) });

const specs: MetricSpec[] = [
  total('kills', 'Kills / covered match', 'higher-better'), total('deaths', 'Deaths / covered match', 'lower-better'), total('assists', 'Assists / covered match', 'higher-better'),
  ratio('kd', 'K/D', 'pairedKills', 'pairedDeaths', 'higher-better'),
  { id: 'kda', label: 'KDA', direction: 'higher-better', finish: a => ({ value: a.pairedKdaDeaths.samples && a.pairedKdaDeaths.total > 0 ? (a.pairedKdaKills.total + a.pairedKdaAssists.total) / a.pairedKdaDeaths.total : null, samples: a.pairedKdaDeaths.samples, coverage: { covered: a.pairedKdaDeaths.covered, total: a.pairedKdaDeaths.possible }, numerator: a.pairedKdaDeaths.samples ? a.pairedKdaKills.total + a.pairedKdaAssists.total : null, denominator: a.pairedKdaDeaths.samples ? a.pairedKdaDeaths.total : null }) },
  average('acs', 'ACS', 'higher-better'), average('adr', 'ADR', 'higher-better'),
  ratio('hsRate', 'Headshot rate', 'headshots', 'headshotEligible', 'neutral'),
  total('fk', 'First kills', 'higher-better'), total('fd', 'First deaths', 'lower-better'),
  { id: 'openingSuccess', label: 'Opening success', direction: 'higher-better', finish: a => ({ value: a.pairedFk.samples && a.pairedFk.total + a.pairedFd.total > 0 ? a.pairedFk.total / (a.pairedFk.total + a.pairedFd.total) : null, samples: a.pairedFk.samples, coverage: { covered: a.pairedFk.covered, total: a.pairedFk.possible }, numerator: a.pairedFk.samples ? a.pairedFk.total : null, denominator: a.pairedFk.samples ? a.pairedFk.total + a.pairedFd.total : null }) },
  ratio('kast', 'KAST', 'kastSuccess', 'kastCovered', 'higher-better'),
  total('objectives', 'Objectives', 'higher-better'), total('multikills', 'Multikills', 'higher-better'),
  total('lowBudgetWins', 'Low-buy wins', 'higher-better'), total('highBudgetLosses', 'Full-buy losses', 'lower-better'), total('antiEcoLosses', 'Anti-eco losses', 'lower-better'),
  total('weaponRounds', 'Weapon observations', 'neutral'), ratio('teamRecord', 'Team win rate', 'teamWins', 'teamResults', 'neutral'),
];

function newAccumulator(): Accumulator {
  return Object.assign(Object.fromEntries(['kills','deaths','assists','pairedKills','pairedDeaths','pairedKdaKills','pairedKdaDeaths','pairedKdaAssists','acs','adr','headshots','headshotEligible','fk','fd','pairedFk','pairedFd','kastSuccess','kastCovered','objectives','multikills','lowBudgetWins','highBudgetLosses','antiEcoLosses','weaponRounds','teamWins','teamResults'].map(id => [id, counter()])), { matchIds: new Set<string>() }) as Accumulator;
}

const normalized = (value: string | null | undefined) => (value || '').trim().toLocaleLowerCase();
const observedId = (name: string) => `observed:${normalized(name)}`;
const observedName = (row: PlayerStats) => (row.displayNameSnapshot || row.player || '').trim();
const matchesParticipant = (data: ComparisonData, row: PlayerStats, id: string | undefined) => {
  if (!id) return false;
  if (id.startsWith('observed:')) return !row.playerId && observedId(observedName(row)) === id;
  if (row.playerId === id) return true;
  const player = data.rosterPlayers.find(item => item.id === id && !item.retiredAt);
  return !row.playerId && !!player && normalized(observedName(row)) === normalized(player.displayName);
};

export function comparisonParticipants(data: ComparisonData) {
  const retiredIds = new Set(data.rosterPlayers.filter(player => player.retiredAt).map(player => player.id));
  const retiredNames = new Set(data.rosterPlayers.filter(player => player.retiredAt).map(player => normalized(player.displayName)));
  const roster = data.rosterPlayers.filter(player => !player.retiredAt).map(player => ({ id: player.id, displayName: player.displayName, rosterPlayerId: player.id }));
  const rosterNames = new Set(roster.map(player => normalized(player.displayName)));
  const observed = new Map<string, string>();
  for (const row of data.playerStats) {
    if (row.playerId) { if (retiredIds.has(row.playerId)) continue; else continue; }
    const name = observedName(row); const key = normalized(name);
    if (!key || retiredNames.has(key) || rosterNames.has(key) || observed.has(key)) continue;
    observed.set(key, name);
  }
  return [...roster, ...[...observed].map(([key, displayName]) => ({ id: `observed:${key}`, displayName, rosterPlayerId: null }))]
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'en'));
}
function score(match: Match) { if (typeof match.ourScore === 'number' && typeof match.theirScore === 'number') return { ours: match.ourScore, theirs: match.theirScore }; if ([match.attW,match.defW,match.attL,match.defL].every(value => typeof value === 'number')) return { ours: match.attW! + match.defW!, theirs: match.attL! + match.defL! }; return null; }
function composition(matchId: string, stats: readonly PlayerStats[]) { const agents = stats.filter(row => row.matchId === matchId && row.playerId && row.agent?.trim()).map(row => row.agent.trim()); return agents.length === 5 && new Set(agents.map(normalized)).size === 5 ? agents.sort().join(' / ') : null; }
function accepted(match: Match) { return match.comparisonEvidence?.accepted === true || (match.sourceMetadata?.method === 'screenshot' ? match.reviewConfirmation?.alliedSideConfirmed === true : !!match.sourceMetadata && match.sourceMetadata.method !== 'unknown'); }

function filterMatches(data: ComparisonData, filters: ComparisonFilter = {}) {
  const blocks = resolvePracticeBlocks(data.matches, data.practiceBlocks);
  const blockMatchIds = filters.blockIds?.length ? new Set(blocks.filter(block => filters.blockIds!.includes(block.id)).flatMap(block => block.matchIds)) : null;
  const maps = filters.maps?.map(normalized); const opponents = filters.opponentCategories?.map(normalized); const compositions = filters.compositions?.map(normalized);
  return data.matches.filter(match => accepted(match) && (!filters.window || isInCairoDateWindow(match.date, filters.window))
    && (!maps?.length || maps.includes(normalized(match.map)))
    && (!opponents?.length || ('opponentCategory' in match && opponents.includes(normalized((match as any).opponentCategory))))
    && (!compositions?.length || compositions.includes(normalized(composition(match.id, data.playerStats))))
    && (!blockMatchIds || blockMatchIds.has(match.id)));
}

function comparableStrata(data: ComparisonData, matches: readonly Match[], predicate: (row: PlayerStats) => boolean, omitMap: boolean, omitComposition: boolean, agent?: string) {
  const matchById = new Map(matches.map(match => [match.id, match])); const keys = new Set<string>();
  for (const row of data.playerStats) {
    const match = matchById.get(row.matchId); if (!match || !predicate(row) || (agent && normalized(row.agent) !== normalized(agent))) continue;
    keys.add(JSON.stringify([omitMap ? null : normalized(match.map), normalized((match as any).opponentCategory), omitComposition ? null : normalized(composition(match.id, data.playerStats))]));
  }
  return keys;
}

function retainStrata(data: ComparisonData, matches: readonly Match[], allowed: Set<string>, omitMap: boolean, omitComposition: boolean) {
  return matches.filter(match => allowed.has(JSON.stringify([omitMap ? null : normalized(match.map), normalized((match as any).opponentCategory), omitComposition ? null : normalized(composition(match.id, data.playerStats))])));
}

function sideValue(stat: PlayerStats, field: 'k'|'d'|'a', side: ComparisonSide) {
  if (side === 'ATT') return stat[`${field}Att` as keyof PlayerStats];
  if (side === 'DEF') return stat[`${field}Def` as keyof PlayerStats];
  const total = stat[field === 'k' ? 'kills' : field === 'd' ? 'deaths' : 'assists']; if (typeof total === 'number') return total;
  const attack = stat[`${field}Att` as keyof PlayerStats]; const defence = stat[`${field}Def` as keyof PlayerStats]; return typeof attack === 'number' && typeof defence === 'number' ? attack + defence : null;
}

function accumulate(data: ComparisonData, matches: readonly Match[], predicate: (row: PlayerStats) => boolean, side: ComparisonSide, agents?: string[], roles?: string[]) {
  const acc = newAccumulator(); const matchMap = new Map(matches.map(match => [match.id, match])); const wantedAgents = agents?.map(normalized);
  const wantedRoles = roles?.map(normalized);
  const rows = data.playerStats.filter(row => matchMap.has(row.matchId) && predicate(row) && (!wantedAgents?.length || wantedAgents.includes(normalized(row.agent))) && (!wantedRoles?.length || wantedRoles.includes(normalized(row.roleSnapshot))));
  for (const row of rows) {
    const match = matchMap.get(row.matchId)!; acc.matchIds.add(match.id);
    const kills = sideValue(row, 'k', side); const deaths = sideValue(row, 'd', side); const assists = sideValue(row, 'a', side);
    add(acc.kills, kills); add(acc.deaths, deaths); add(acc.assists, assists);
    add(acc.pairedKills, typeof kills === 'number' && typeof deaths === 'number' ? kills : null); add(acc.pairedDeaths, typeof kills === 'number' && typeof deaths === 'number' ? deaths : null);
    const kdaCovered = typeof kills === 'number' && typeof deaths === 'number' && typeof assists === 'number'; add(acc.pairedKdaKills, kdaCovered ? kills : null); add(acc.pairedKdaDeaths, kdaCovered ? deaths : null); add(acc.pairedKdaAssists, kdaCovered ? assists : null);
    add(acc.acs, side === 'all' ? row.acs : null); add(acc.adr, side === 'all' ? row.adr : null);
    const eligible = row.headshotEligibleKills ?? row.kills; const headshots = row.headshots ?? (typeof row.hs === 'number' && typeof eligible === 'number' ? eligible * row.hs / 100 : null);
    add(acc.headshots, side === 'all' ? headshots : null); add(acc.headshotEligible, side === 'all' ? eligible : null);
    const hasOpeningEvidence = row.comparisonEvidence?.openingAccepted === true || (!!row.sourceMetadata && row.sourceMetadata.method !== 'unknown'); const fk = side === 'all' && hasOpeningEvidence ? row.fk : null; const fd = side === 'all' && hasOpeningEvidence ? row.fd : null; add(acc.fk, fk); add(acc.fd, fd); const openingCovered = typeof fk === 'number' && typeof fd === 'number'; add(acc.pairedFk, openingCovered ? fk : null); add(acc.pairedFd, openingCovered ? fd : null);
    const screenshot = side === 'all' ? row.screenshotMetrics : undefined;
    const kast = screenshot?.kast && screenshot.kast.covered > 0 && screenshot.kast.covered === screenshot.coveredRounds ? screenshot.kast : null;
    acc.kastSuccess.possible += screenshot?.coveredRounds || 0; acc.kastCovered.possible += screenshot?.coveredRounds || 0;
    if (kast) { acc.kastSuccess.total += kast.successful; acc.kastSuccess.samples += kast.covered; acc.kastSuccess.covered += kast.covered; acc.kastCovered.total += kast.covered; acc.kastCovered.samples += kast.covered; acc.kastCovered.covered += kast.covered; }
    add(acc.objectives, side === 'all' && (row.plants !== undefined || row.defuses !== undefined) ? (row.plants || 0) + (row.defuses || 0) : null);
    add(acc.multikills, side === 'all' ? screenshot ? screenshot.multikills.three + screenshot.multikills.four + screenshot.multikills.ace : (row.mk3 !== undefined || row.mk4 !== undefined || row.mk5 !== undefined ? (row.mk3 || 0) + (row.mk4 || 0) + (row.mk5 || 0) : null) : null);
    add(acc.lowBudgetWins, screenshot?.lowBudgetWins); add(acc.highBudgetLosses, screenshot?.highBudgetLosses); add(acc.antiEcoLosses, screenshot?.antiEcoLosses);
    add(acc.weaponRounds, screenshot?.weapons?.reduce((sum, weapon) => sum + weapon.rounds, 0));
  }
  for (const matchId of acc.matchIds) { const result = score(matchMap.get(matchId)!); add(acc.teamWins, result ? Number(result.ours > result.theirs) : null); add(acc.teamResults, result ? 1 : null); }
  return acc;
}

function confidence(left: ReturnType<MetricSpec['finish']>, right: ReturnType<MetricSpec['finish']>, minimum: number): Confidence {
  if (left.value === null || right.value === null) return 'unknown';
  const samples = Math.min(left.samples, right.samples); const coverage = Math.min(left.coverage.total ? left.coverage.covered / left.coverage.total : 0, right.coverage.total ? right.coverage.covered / right.coverage.total : 0);
  if (samples >= minimum * 2 && coverage >= .8) return 'high';
  if (samples >= minimum && coverage >= .5) return 'medium';
  return 'low';
}

export function buildTryoutComparison(data: ComparisonData, query: ComparisonQuery) {
  const minimum = query.minimumSamples ?? 3; if (!Number.isInteger(minimum) || minimum < 1) throw new RangeError('minimumSamples must be positive.');
  const filters = query.filters || {}; const side = filters.side || 'all'; const currentMatches = filterMatches(data, filters);
  let leftMatches = currentMatches; let rightMatches = currentMatches; let leftSide = side; let rightSide = side; let leftAgents = filters.agents; let rightAgents = filters.agents;
  let leftPredicate = (row: PlayerStats) => matchesParticipant(data, row, query.leftId); let rightPredicate = (row: PlayerStats) => matchesParticipant(data, row, query.rightId);
  if (query.mode === 'tryout-core-average') rightPredicate = row => row.appearanceType === 'core' && !!row.playerId && row.playerId !== query.leftId;
  if (query.mode === 'own-previous-period') {
    if (!query.previousWindow || !filters.window) throw new RangeError('Previous-period comparison requires current and previous date windows.');
    if (query.previousWindow.end >= filters.window.start) throw new RangeError('Previous period must end before the current period begins.');
    rightMatches = filterMatches(data, { ...filters, window: query.previousWindow }); rightPredicate = leftPredicate;
  }
  if (query.mode === 'block-block') {
    const blocks = resolvePracticeBlocks(data.matches, data.practiceBlocks); const leftIds = new Set(blocks.find(block => block.id === query.leftId)?.matchIds || []); const rightIds = new Set(blocks.find(block => block.id === query.rightId)?.matchIds || []);
    leftMatches = currentMatches.filter(match => leftIds.has(match.id)); rightMatches = currentMatches.filter(match => rightIds.has(match.id)); leftPredicate = () => true; rightPredicate = () => true;
  }
  if (query.mode === 'agent-split') { if (!query.leftContext || !query.rightContext) throw new RangeError('Agent split requires both agents.'); leftAgents = [query.leftContext]; rightAgents = [query.rightContext]; rightPredicate = leftPredicate; }
  if (query.mode === 'map-split') { if (!query.leftContext || !query.rightContext) throw new RangeError('Map split requires both maps.'); leftMatches = filterMatches(data, { ...filters, maps: [query.leftContext] }); rightMatches = filterMatches(data, { ...filters, maps: [query.rightContext] }); rightPredicate = leftPredicate; }
  if (query.mode === 'att-def') { leftSide = 'ATT'; rightSide = 'DEF'; rightPredicate = leftPredicate; }
  // Compare only strata represented on both sides. A map split intentionally
  // omits map from the key; an agent split intentionally selects different agents.
  const omitComposition = query.mode === 'agent-split';
  const leftStrata = comparableStrata(data, leftMatches, leftPredicate, query.mode === 'map-split', omitComposition, query.mode === 'agent-split' ? query.leftContext : undefined);
  const rightStrata = comparableStrata(data, rightMatches, rightPredicate, query.mode === 'map-split', omitComposition, query.mode === 'agent-split' ? query.rightContext : undefined);
  const commonStrata = new Set([...leftStrata].filter(key => rightStrata.has(key)));
  leftMatches = retainStrata(data, leftMatches, commonStrata, query.mode === 'map-split', omitComposition); rightMatches = retainStrata(data, rightMatches, commonStrata, query.mode === 'map-split', omitComposition);
  const left = accumulate(data, leftMatches, leftPredicate, leftSide, leftAgents, filters.roles); const right = accumulate(data, rightMatches, rightPredicate, rightSide, rightAgents, filters.roles);
  const coreIds = query.mode === 'tryout-core-average' ? [...new Set(data.playerStats.filter(row => row.playerId && row.playerId !== query.leftId && row.appearanceType === 'core').map(row => row.playerId!))].sort() : [];
  const coreAccumulators = coreIds.map(id => accumulate(data, rightMatches, row => row.playerId === id && row.appearanceType === 'core', rightSide, rightAgents, filters.roles));
  const rightMetric = (spec: MetricSpec) => {
    if (query.mode !== 'tryout-core-average') return spec.finish(right);
    const values = coreAccumulators.map(accumulator => spec.finish(accumulator)); const known = values.filter(item => item.value !== null);
    return { value: known.length ? known.reduce((sum, item) => sum + item.value!, 0) / known.length : null, samples: values.reduce((sum, item) => sum + item.samples, 0), coverage: { covered: values.reduce((sum, item) => sum + item.coverage.covered, 0), total: values.reduce((sum, item) => sum + item.coverage.total, 0) }, numerator: null, denominator: known.length || null };
  };
  const metrics: ComparisonMetric[] = specs.map(spec => { const l = spec.finish(left); const r = rightMetric(spec); const level = confidence(l, r, minimum); return { id: spec.id, label: spec.label, direction: spec.direction, left: l.value, right: r.value, delta: l.value === null || r.value === null ? null : l.value - r.value, leftSamples: l.samples, rightSamples: r.samples, leftCoverage: l.coverage, rightCoverage: r.coverage, leftNumerator: l.numerator ?? null, leftDenominator: l.denominator ?? null, rightNumerator: r.numerator ?? null, rightDenominator: r.denominator ?? null, confidence: level, unknownReason: l.value === null || r.value === null ? 'unsupported-or-missing-evidence' : null }; });
  const allFiltered = new Set(currentMatches.map(match => match.id)); const used = new Set([...left.matchIds, ...right.matchIds]);
  return { schema: 'moetracker.tryout-comparison/v1', calculationVersion: TRYOUT_COMPARISON_VERSION, query: structuredClone(query), leftMatchIds: [...left.matchIds].sort(), rightMatchIds: [...right.matchIds].sort(), excluded: { unmatchedMatches: [...allFiltered].filter(id => !used.has(id)).length, unlinkedRows: data.playerStats.filter(row => allFiltered.has(row.matchId) && !row.playerId).length }, metrics };
}

export function buildCoverageGatedRanks(data: ComparisonData, filters: ComparisonFilter = {}, minimumSamples = 3) {
  const active = comparisonParticipants(data); const rows = active.map(player => ({ player, result: buildTryoutComparison(data, { mode: 'player-player', leftId: player.id, rightId: player.id, filters, minimumSamples }) }));
  const coveredMatches = (playerId: string, metricId: string) => {
    const matches = new Set(filterMatches(data, filters).map(match => match.id)); const agents = filters.agents?.map(normalized); const roles = filters.roles?.map(normalized); const side = filters.side || 'all';
    const ids = data.playerStats.filter(row => matchesParticipant(data, row, playerId) && matches.has(row.matchId) && (!agents?.length || agents.includes(normalized(row.agent))) && (!roles?.length || roles.includes(normalized(row.roleSnapshot)))).filter(row => {
      const k=sideValue(row,'k',side),d=sideValue(row,'d',side),a=sideValue(row,'a',side); const screenshot=side==='all'?row.screenshotMetrics:undefined; const opening=!!row.sourceMetadata&&row.sourceMetadata.method!=='unknown';
      if(metricId==='kills')return typeof k==='number'; if(metricId==='deaths')return typeof d==='number'; if(metricId==='assists')return typeof a==='number'; if(metricId==='kd')return typeof k==='number'&&typeof d==='number'; if(metricId==='kda')return typeof k==='number'&&typeof d==='number'&&typeof a==='number'; if(metricId==='acs'||metricId==='adr')return side==='all'&&typeof row[metricId]==='number'; if(metricId==='hsRate')return side==='all'&&typeof (row.headshotEligibleKills??row.kills)==='number'&&(typeof row.headshots==='number'||typeof row.hs==='number'); if(metricId==='fk')return opening&&typeof row.fk==='number'; if(metricId==='fd')return opening&&typeof row.fd==='number'; if(metricId==='openingSuccess')return opening&&typeof row.fk==='number'&&typeof row.fd==='number'; if(metricId==='kast')return !!screenshot?.kast&&screenshot.kast.covered>0&&screenshot.kast.covered===screenshot.coveredRounds; if(metricId==='objectives')return side==='all'&&(row.plants!==undefined||row.defuses!==undefined); if(metricId==='multikills')return side==='all'&&(!!screenshot||row.mk3!==undefined||row.mk4!==undefined||row.mk5!==undefined); if(metricId==='lowBudgetWins'||metricId==='highBudgetLosses'||metricId==='antiEcoLosses'||metricId==='weaponRounds')return !!screenshot; if(metricId==='teamRecord')return !!score(data.matches.find(match=>match.id===row.matchId)!); return false;
    }).map(row=>row.matchId); return [...new Set(ids)].sort();
  };
  return specs.map(spec => {
    const eligible = rows.map(row => { const metric=row.result.metrics.find(metric => metric.id===spec.id)!; return { playerId:row.player.id,displayName:row.player.displayName,cohort:JSON.stringify([coveredMatches(row.player.id,spec.id),metric.leftCoverage.total,filters]),metric }; }).filter(row => row.metric.left !== null && row.metric.leftSamples >= minimumSamples && row.metric.leftCoverage.total > 0 && row.metric.leftCoverage.covered / row.metric.leftCoverage.total >= .5);
    const cohorts = new Map<string, typeof eligible>(); for (const row of eligible) cohorts.set(row.cohort, [...(cohorts.get(row.cohort) || []), row]);
    const largestCohort = [...cohorts.values()].sort((a,b)=>b.length-a.length||a[0]?.cohort.localeCompare(b[0]?.cohort||'')||0)[0] || []; const comparable = largestCohort.length >= 2 ? largestCohort : [];
    const ordered = spec.direction === 'neutral' ? comparable : comparable.sort((a, b) => { const delta = spec.direction === 'lower-better' ? a.metric.left! - b.metric.left! : b.metric.left! - a.metric.left!; return delta || a.displayName.localeCompare(b.displayName, 'en') || a.playerId.localeCompare(b.playerId); });
    return { metricId: spec.id, ranked: spec.direction !== 'neutral', minimumSamples, entries: ordered.map((row, index) => ({ playerId: row.playerId, displayName: row.displayName, rank: spec.direction === 'neutral' ? null : index + 1, value: row.metric.left, samples: row.metric.leftSamples, smallSample: row.metric.leftSamples < minimumSamples * 2 })) };
  });
}

export function buildEvaluationExport(data: ComparisonData, query: ComparisonQuery, notes: readonly TryoutDecisionNote[] = []) {
  const comparison = buildTryoutComparison(data, query); const safe = (value: unknown) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; }; const row = (...cells: unknown[]) => cells.map(safe).join(',');
  const cairoGeneratedAt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'long' }).format(new Date());
  const playerNames = new Map(data.rosterPlayers.map(player => [player.id, player.displayName])); const blockNames = new Map(resolvePracticeBlocks(data.matches, data.practiceBlocks).map(block => [block.id, block.name]));
  const lines = [row('MoeTracker tryout evaluation'), row('Generated at', `${cairoGeneratedAt} Africa/Cairo`), row('Calculation', comparison.calculationVersion), row('Mode', query.mode), row('Comparison contexts', JSON.stringify({ left: query.leftContext || null, right: query.rightContext || null, previousWindow: query.previousWindow || null })), row('Map scope', JSON.stringify(query.mapScope || { mode: 'all', sourceMatchCount: data.matches.length, includedMatchCount: data.matches.length, excludedMatchCount: 0, emptyActivePool: false })), row('Left identity', playerNames.get(query.leftId) || blockNames.get(query.leftId) || query.leftId), row('Right identity', playerNames.get(query.rightId || '') || blockNames.get(query.rightId || '') || query.rightId || ''), row('Exact filters', JSON.stringify(query.filters || {})), '', row('Evidence limitations'), row('Accepted recorded evidence only; missing fields remain unknown.'), row('Rankings require identical context, comparable coverage and minimum samples.'), row('Team results and neutral metrics are context, not player blame.'), row('Screenshot evidence cannot prove positioning, utility use, or unobserved trades.'), '', row('Metric','Left','Right','Delta','Left numerator','Left denominator','Right numerator','Right denominator','Left sample','Right sample','Left coverage','Right coverage','Confidence','Unknown reason')];
  for (const metric of comparison.metrics) lines.push(row(metric.label, metric.left ?? 'unknown', metric.right ?? 'unknown', metric.delta ?? 'unknown', metric.leftNumerator ?? 'unknown', metric.leftDenominator ?? 'unknown', metric.rightNumerator ?? 'unknown', metric.rightDenominator ?? 'unknown', metric.leftSamples, metric.rightSamples, `${metric.leftCoverage.covered}/${metric.leftCoverage.total}`, `${metric.rightCoverage.covered}/${metric.rightCoverage.total}`, metric.confidence, metric.unknownReason || ''));
  if (notes.length) { lines.push('', 'Private staff notes are intentionally excluded from shareable evaluation exports.'); }
  lines.push('', row('Supporting matches', [...new Set([...comparison.leftMatchIds, ...comparison.rightMatchIds])].join('; ') || 'none'), row('Excluded unmatched matches', comparison.excluded.unmatchedMatches), row('Excluded unlinked rows', comparison.excluded.unlinkedRows));
  return { filename: `moetracker-evaluation-${query.leftId}.csv`, mimeType: 'text/csv', content: lines.join('\n'), comparison };
}
