import type { CoachingAction, CoachingSignal, DashboardView, Match, PlayerStats, PracticeBlock, Round, TrackerData } from '../src/types';
import { resolvePracticeBlocks } from './practiceBlocks';

export const COACHING_WORKFLOW_VERSION = 'moetracker.coaching-workflow/v1' as const;
export const DASHBOARD_LAYOUT_VERSION = 1 as const;

type WorkflowData = Pick<TrackerData, 'matches' | 'playerStats' | 'rounds' | 'practiceBlocks' | 'rosterPlayers' | 'settings'>;

function stableId(parts: unknown[]) {
  const text = JSON.stringify(parts); let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `cw-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function accepted(match: Match) {
  if (match.sourceMetadata?.method === 'screenshot') return match.reviewConfirmation?.alliedSideConfirmed === true;
  return match.comparisonEvidence?.accepted === true || (!!match.sourceMetadata && match.sourceMetadata.method !== 'unknown');
}

function score(match: Match) {
  if (typeof match.ourScore === 'number' && typeof match.theirScore === 'number') return { ours: match.ourScore, theirs: match.theirScore };
  if ([match.attW, match.attL, match.defW, match.defL].every(value => typeof value === 'number')) return { ours: Number(match.attW) + Number(match.defW), theirs: Number(match.attL) + Number(match.defL) };
  return null;
}

function knownResult(round: Round) { return round.result === 'W' || round.result === 'L'; }
function won(round: Round) { return round.result === 'W'; }
function side(round: Round) { return /^att/i.test(round.side || '') ? 'ATT' : /^def/i.test(round.side || '') ? 'DEF' : 'UNKNOWN'; }
function buy(round: Round) { return String(round.buy || '').toLowerCase(); }
function enemyBuy(round: Round) { return String(round.enemyBuy || '').toLowerCase(); }
function rate(wins: number, samples: number) { return samples ? Math.round(wins / samples * 1000) / 10 : null; }
function total(rows: PlayerStats[], key: keyof PlayerStats) { return rows.reduce((sum, row) => sum + (typeof row[key] === 'number' ? Number(row[key]) : 0), 0); }
function average(rows: PlayerStats[], key: keyof PlayerStats) { const values = rows.map(row => row[key]).filter((value): value is number => typeof value === 'number'); return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null; }

export interface PracticeBlockSummary {
  schema: typeof COACHING_WORKFLOW_VERSION;
  blockId: string;
  name: string;
  matchIds: string[];
  generatedAt: string;
  coverage: { matches: number; acceptedMatches: number; rounds: number; knownRounds: number; playerRows: number; evidenceHealth: 'complete' | 'partial' | 'empty' };
  header: { opponents: string[]; maps: string[]; result: { wins: number; losses: number; undecided: number }; sources: string[]; rosterStatuses: string[] };
  openings: { pistols: Record<'ATT' | 'DEF', { wins: number; samples: number; rate: number | null }>; firstThree: Record<'ATT' | 'DEF', { wins: number; samples: number; rate: number | null }>; firstKills: number; firstDeaths: number; recoveriesAfterFirstDeath: number | null; firstDeathSamples: number };
  economy: { lowBuyWins: number; fullBuyLosses: number; antiEcoLosses: number; knownBuyRounds: number; totalRounds: number; weaponObservations: number };
  roster: Array<{ playerId: string | null; player: string; agents: string[]; matches: number; kills: number; deaths: number; assists: number; kd: number | null; acs: number | null; adr: number | null; hs: number | null; fk: number; fd: number; kast: number | null; plants: number; defuses: number; multikills: number }>;
  compositions: Array<{ agents: string[]; matches: number; wins: number; losses: number }>;
  mapResults: Array<{ map: string; matches: number; wins: number; losses: number; active: boolean }>;
}

export function buildPracticeBlockSummary(data: WorkflowData, block: Pick<PracticeBlock, 'id' | 'name' | 'matchIds'>, now = new Date().toISOString()): PracticeBlockSummary {
  const selected = new Set(block.matchIds);
  const matches = (data.matches || []).filter(match => selected.has(match.id));
  const acceptedMatches = matches.filter(accepted); const acceptedIds = new Set(acceptedMatches.map(match => match.id));
  const rounds = (data.rounds || []).filter(round => acceptedIds.has(round.matchId));
  const knownRounds = rounds.filter(knownResult); const stats = (data.playerStats || []).filter(row => acceptedIds.has(row.matchId));
  const decided = acceptedMatches.map(match => ({ match, score: score(match) })).filter((item): item is { match: Match; score: { ours: number; theirs: number } } => !!item.score && item.score.ours !== item.score.theirs);
  const pistol = (roundSide: 'ATT' | 'DEF') => { const rows = rounds.filter(round => side(round) === roundSide && [1, 13].includes(round.roundNo) && knownResult(round)); const wins = rows.filter(won).length; return { wins, samples: rows.length, rate: rate(wins, rows.length) }; };
  const firstThree = (roundSide: 'ATT' | 'DEF') => { const rows = rounds.filter(round => side(round) === roundSide && knownResult(round)).filter(round => { const sideRounds = rounds.filter(item => item.matchId === round.matchId && side(item) === roundSide).sort((a, b) => a.roundNo - b.roundNo); return sideRounds.slice(0, 3).some(item => item.id === round.id); }); const wins = rows.filter(won).length; return { wins, samples: rows.length, rate: rate(wins, rows.length) }; };
  const grouped = new Map<string, PlayerStats[]>();
  for (const row of stats) { const key = row.playerId || `name:${String(row.player || '').toLowerCase()}`; grouped.set(key, [...(grouped.get(key) || []), row]); }
  const roster = [...grouped.entries()].map(([key, rows]) => ({
    playerId: key.startsWith('name:') ? null : key, player: rows[0].displayNameSnapshot || rows[0].player || 'Unknown', agents: [...new Set(rows.map(row => row.agent).filter(Boolean))].sort(), matches: new Set(rows.map(row => row.matchId)).size,
    kills: total(rows, 'kills'), deaths: total(rows, 'deaths'), assists: total(rows, 'assists'), kd: total(rows, 'deaths') ? Math.round(total(rows, 'kills') / total(rows, 'deaths') * 100) / 100 : null,
    acs: average(rows, 'acs'), adr: average(rows, 'adr'), hs: average(rows, 'hs'), fk: total(rows, 'fk'), fd: total(rows, 'fd'), kast: (() => { const covered = total(rows, 'kastCovered'); return covered ? Math.round(total(rows, 'kastSuccessful') / covered * 1000) / 10 : null; })(), plants: total(rows, 'plants'), defuses: total(rows, 'defuses'), multikills: rows.reduce((sum, row) => sum + Number(row.screenshotMetrics?.multikills?.two || 0) + Number(row.screenshotMetrics?.multikills?.three || 0) + Number(row.screenshotMetrics?.multikills?.four || 0) + Number(row.screenshotMetrics?.multikills?.ace || 0), 0),
  })).sort((a, b) => b.kills - a.kills || a.player.localeCompare(b.player));
  const compositionGroups = new Map<string, { agents: string[]; matches: number; wins: number; losses: number }>();
  for (const match of acceptedMatches) { const agents = [...new Set(stats.filter(row => row.matchId === match.id).map(row => row.agent).filter(Boolean))].sort(); if (!agents.length) continue; const key = agents.join('|'); const current = compositionGroups.get(key) || { agents, matches: 0, wins: 0, losses: 0 }; current.matches += 1; const result = score(match); if (result && result.ours > result.theirs) current.wins += 1; else if (result && result.ours < result.theirs) current.losses += 1; compositionGroups.set(key, current); }
  const mapGroups = new Map<string, { map: string; matches: number; wins: number; losses: number; active: boolean }>(); const inactiveMaps = new Set(data.settings.inactiveMaps || []);
  for (const match of acceptedMatches) { const map = match.map || 'Unknown'; const current = mapGroups.get(map) || { map, matches: 0, wins: 0, losses: 0, active: !inactiveMaps.has(map) }; current.matches += 1; const result = score(match); if (result && result.ours > result.theirs) current.wins += 1; else if (result && result.ours < result.theirs) current.losses += 1; mapGroups.set(map, current); }
  const fdRounds = rounds.filter(round => !!round.firstDeathBy && knownResult(round));
  return {
    schema: COACHING_WORKFLOW_VERSION, blockId: block.id, name: block.name, matchIds: [...block.matchIds], generatedAt: now,
    coverage: { matches: matches.length, acceptedMatches: acceptedMatches.length, rounds: rounds.length, knownRounds: knownRounds.length, playerRows: stats.length, evidenceHealth: !acceptedMatches.length ? 'empty' : acceptedMatches.length === matches.length && knownRounds.length === rounds.length ? 'complete' : 'partial' },
    header: { opponents: [...new Set(acceptedMatches.map(match => match.opponent).filter(Boolean))].sort(), maps: [...new Set(acceptedMatches.map(match => match.map).filter(Boolean))].sort(), result: { wins: decided.filter(item => item.score.ours > item.score.theirs).length, losses: decided.filter(item => item.score.ours < item.score.theirs).length, undecided: acceptedMatches.length - decided.length }, sources: [...new Set(acceptedMatches.map(match => match.sourceMetadata?.method || match.source || 'unknown'))].sort(), rosterStatuses: [...new Set(stats.map(row => row.appearanceType || 'unclassified'))].sort() },
    openings: { pistols: { ATT: pistol('ATT'), DEF: pistol('DEF') }, firstThree: { ATT: firstThree('ATT'), DEF: firstThree('DEF') }, firstKills: total(stats, 'fk'), firstDeaths: total(stats, 'fd'), recoveriesAfterFirstDeath: fdRounds.length ? fdRounds.filter(won).length : null, firstDeathSamples: fdRounds.length },
    economy: { lowBuyWins: rounds.filter(round => ['eco', 'low', 'half', 'force'].includes(buy(round)) && won(round)).length, fullBuyLosses: rounds.filter(round => buy(round) === 'full' && !won(round) && knownResult(round)).length, antiEcoLosses: rounds.filter(round => enemyBuy(round) === 'eco' && !won(round) && knownResult(round)).length, knownBuyRounds: rounds.filter(round => !!round.buy).length, totalRounds: rounds.length, weaponObservations: stats.reduce((sum, row) => sum + (row.screenshotMetrics?.weapons?.length || 0), 0) },
    roster, compositions: [...compositionGroups.values()].sort((a, b) => b.matches - a.matches), mapResults: [...mapGroups.values()].sort((a, b) => b.matches - a.matches || a.map.localeCompare(b.map)),
  };
}

export function buildAllPracticeBlockSummaries(data: WorkflowData, now = new Date().toISOString()) {
  return resolvePracticeBlocks(data.matches || [], data.practiceBlocks || []).map(block => buildPracticeBlockSummary(data, block, now));
}

type SignalDraft = Omit<CoachingSignal, 'id' | 'status' | 'audit'>;
function signal(block: PracticeBlockSummary, type: CoachingSignal['type'], severity: CoachingSignal['severity'], title: string, explanation: string, metric: CoachingSignal['metric'], context: CoachingSignal['context'] = {}): SignalDraft {
  return { schema: COACHING_WORKFLOW_VERSION, generatorVersion: 1, fingerprint: stableId([block.blockId, type, context, metric]), blockId: block.blockId, matchIds: block.matchIds, type, severity, title, explanation, metric, context, evidence: { matchIds: block.matchIds, sourceTypes: block.header.sources, confidence: block.coverage.evidenceHealth === 'complete' ? 'high' : block.coverage.evidenceHealth === 'partial' ? 'medium' : 'low' }, createdAt: block.generatedAt, updatedAt: block.generatedAt };
}

export function generateReviewSignalDrafts(summary: PracticeBlockSummary, thresholds: { minimumSamples?: number; fullBuyLosses?: number; antiEcoLosses?: number; firstDeathCollapseRate?: number } = {}) {
  const drafts: SignalDraft[] = []; const min = Math.max(1, thresholds.minimumSamples || 2);
  if (summary.coverage.evidenceHealth !== 'complete') drafts.push(signal(summary, 'evidence-health', 'warning', 'Evidence needs review', `${summary.coverage.acceptedMatches}/${summary.coverage.matches} matches and ${summary.coverage.knownRounds}/${summary.coverage.rounds} rounds are accepted and complete.`, { value: summary.coverage.acceptedMatches, samples: summary.coverage.matches, unit: 'matches' }));
  for (const sideName of ['ATT', 'DEF'] as const) { const pistol = summary.openings.pistols[sideName]; if (pistol.samples >= min && pistol.rate !== null && pistol.rate < 50) drafts.push(signal(summary, 'pistol-conversion', 'warning', `${sideName} pistol conversion`, `${sideName} pistol rounds were won ${pistol.wins}/${pistol.samples} times.`, { value: pistol.rate, samples: pistol.samples, unit: '%' }, { side: sideName })); }
  if (summary.economy.fullBuyLosses >= (thresholds.fullBuyLosses || 2)) drafts.push(signal(summary, 'full-buy-loss', 'critical', 'Repeated full-buy losses', `${summary.economy.fullBuyLosses} full-buy rounds were lost.`, { value: summary.economy.fullBuyLosses, samples: summary.economy.knownBuyRounds, unit: 'rounds' }, { economy: 'full' }));
  if (summary.economy.antiEcoLosses >= (thresholds.antiEcoLosses || 1)) drafts.push(signal(summary, 'anti-eco-loss', 'critical', 'Anti-eco loss', `${summary.economy.antiEcoLosses} rounds were lost against a known enemy eco.`, { value: summary.economy.antiEcoLosses, samples: summary.economy.knownBuyRounds, unit: 'rounds' }, { economy: 'anti-eco' }));
  if (summary.openings.firstDeathSamples >= min) { const recoveries = summary.openings.recoveriesAfterFirstDeath || 0; const collapse = 100 - Number(rate(recoveries, summary.openings.firstDeathSamples)); if (collapse >= (thresholds.firstDeathCollapseRate || 70)) drafts.push(signal(summary, 'first-death-collapse', 'warning', 'First-death collapse', `The team recovered ${recoveries}/${summary.openings.firstDeathSamples} covered rounds after conceding first death.`, { value: collapse, samples: summary.openings.firstDeathSamples, unit: '%' })); }
  for (const player of summary.roster) if (player.fd >= 3 && player.fd > player.fk) drafts.push(signal(summary, 'repeated-player-first-death', 'warning', `${player.player} opening deaths`, `${player.player} recorded ${player.fk} first kills and ${player.fd} first deaths.`, { value: player.fd, samples: player.fk + player.fd, unit: 'duels' }, { playerId: player.playerId || undefined, player: player.player }));
  for (const map of summary.mapResults) if (map.active && map.matches >= min && map.losses > map.wins) drafts.push(signal(summary, 'map-underperformance', 'info', `${map.map} block result`, `${map.wins}W–${map.losses}L across ${map.matches} accepted matches.`, { value: map.wins, samples: map.matches, unit: 'wins' }, { map: map.map }));
  return drafts.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] - { critical: 0, warning: 1, info: 2 }[b.severity] || a.fingerprint.localeCompare(b.fingerprint)));
}

export function reconcileReviewSignals(existing: readonly CoachingSignal[], drafts: readonly SignalDraft[], actor = 'system') {
  const byFingerprint = new Map(existing.map(item => [item.fingerprint, item])); const now = new Date().toISOString();
  const next = drafts.map(draft => { const prior = byFingerprint.get(draft.fingerprint); if (prior) return { ...prior, ...draft, id: prior.id, status: prior.status, audit: prior.audit, updatedAt: now }; return { ...draft, id: stableId(['signal', draft.fingerprint]), status: 'new' as const, audit: [{ at: now, by: actor, from: null, to: 'new' as const }] }; });
  const fingerprints = new Set(drafts.map(item => item.fingerprint)); return [...next, ...existing.filter(item => !fingerprints.has(item.fingerprint))];
}

export function transitionSignal(signalRecord: CoachingSignal, status: CoachingSignal['status'], actor: string, reason?: string, now = new Date().toISOString()) {
  if (signalRecord.status === status) return signalRecord;
  return { ...signalRecord, status, updatedAt: now, audit: [...signalRecord.audit, { at: now, by: actor, from: signalRecord.status, to: status, ...(reason ? { reason } : {}) }] };
}

export function createCoachingAction(input: { signal: CoachingSignal; title?: string; kind: CoachingAction['kind']; ownerIds: string[]; dueBlockId?: string; dueDate?: string; priority: CoachingAction['priority']; visibility: CoachingAction['visibility']; check?: CoachingAction['check'] }, actor: string, now = new Date().toISOString()): CoachingAction {
  if (input.signal.status !== 'accepted') throw Object.assign(new Error('Only an accepted review signal can become an action.'), { status: 409 });
  return { schema: COACHING_WORKFLOW_VERSION, id: stableId(['action', input.signal.id, now]), sourceSignalId: input.signal.id, sourceFingerprint: input.signal.fingerprint, evidence: structuredClone(input.signal.evidence), title: input.title?.trim() || input.signal.title, kind: input.kind, ownerIds: [...new Set(input.ownerIds)], dueBlockId: input.dueBlockId || null, dueDate: input.dueDate || null, priority: input.priority, visibility: input.visibility, state: 'assigned', check: input.check || null, outcome: null, createdAt: now, updatedAt: now, audit: [{ at: now, by: actor, from: null, to: 'assigned' }] };
}

export function evaluateAction(action: CoachingAction, summaries: readonly PracticeBlockSummary[], signals: readonly CoachingSignal[], now = new Date().toISOString()) {
  if (!action.check) return action;
  const later = summaries.find(summary => summary.blockId === action.dueBlockId) || summaries.find(summary => summary.generatedAt > action.createdAt);
  if (!later) return { ...action, outcome: { status: 'inconclusive' as const, baseline: action.check.baseline, later: null, change: null, confidence: 'low' as const, evaluatedAt: now, reason: 'No later accepted block is available.' } };
  const recurrence = signals.find(item => item.blockId === later.blockId && item.type === action.check?.signalType);
  const laterValue = recurrence?.metric.value ?? 0; const change = laterValue - action.check.baseline; const passes = action.check.direction === 'decrease' ? laterValue <= action.check.target : laterValue >= action.check.target;
  return { ...action, outcome: { status: passes ? 'satisfied' as const : 'regressed' as const, baseline: action.check.baseline, later: laterValue, change, confidence: recurrence?.evidence.confidence || 'medium' as const, evaluatedAt: now, reason: passes ? 'The configured next-block threshold was met.' : 'The later accepted block did not meet the configured threshold.' } };
}

export const DASHBOARD_CARDS = [
  { id: 'latest-block', label: 'Latest practice block', sizes: ['wide', 'full'], critical: false }, { id: 'review-queue', label: 'Review inbox', sizes: ['half', 'wide'], critical: true },
  { id: 'active-actions', label: 'Active coaching actions', sizes: ['half', 'wide'], critical: false }, { id: 'evidence-health', label: 'Evidence health', sizes: ['half'], critical: true },
  { id: 'openings', label: 'Opening rounds', sizes: ['half', 'wide'], critical: false }, { id: 'economy', label: 'Economy discipline', sizes: ['half', 'wide'], critical: false },
  { id: 'roster', label: 'Player development', sizes: ['wide', 'full'], critical: false }, { id: 'maps', label: 'Map pool', sizes: ['half', 'wide'], critical: false },
] as const;

export const DASHBOARD_PRESETS: Record<string, string[]> = {
  'practice-block': ['latest-block', 'review-queue', 'active-actions', 'evidence-health', 'openings', 'economy'],
  'tryout-evaluation': ['review-queue', 'roster', 'latest-block', 'evidence-health'], 'opening-rounds': ['openings', 'review-queue', 'latest-block', 'evidence-health'],
  'economy-discipline': ['economy', 'review-queue', 'latest-block', 'evidence-health'], 'map-pool': ['maps', 'latest-block', 'review-queue', 'evidence-health'],
  'player-development': ['active-actions', 'roster', 'review-queue', 'evidence-health'], 'evidence-health': ['evidence-health', 'review-queue', 'latest-block'],
};

export function normalizeDashboardView(view: Partial<DashboardView> | undefined, ownerId: string): DashboardView {
  const allowed = new Map<string, (typeof DASHBOARD_CARDS)[number]>(DASHBOARD_CARDS.map(card => [card.id, card])); const preset = view?.preset && DASHBOARD_PRESETS[view.preset] ? view.preset : 'practice-block'; const submitted = view?.cards || []; const ids = [...new Set(submitted.map(card => card.id).filter(id => allowed.has(id)))];
  if (!submitted.length) for (const id of DASHBOARD_PRESETS[preset]) if (!ids.includes(id)) ids.push(id); for (const card of DASHBOARD_CARDS) if (card.critical && !ids.includes(card.id)) ids.push(card.id);
  return { schema: 'moetracker.dashboard-view/v1', id: view?.id || `personal:${ownerId}`, name: String(view?.name || 'My coach dashboard').slice(0, 80), ownerId, scope: view?.scope === 'team' ? 'team' : 'personal', version: DASHBOARD_LAYOUT_VERSION, preset, cards: ids.map(id => { const requested = view?.cards?.find(card => card.id === id); const catalog = allowed.get(id)!; return { id, size: catalog.sizes.includes(requested?.size as never) ? requested!.size : catalog.sizes[0], minimized: !!requested?.minimized && !catalog.critical }; }), filters: { blockId: view?.filters?.blockId || null, map: view?.filters?.map || null, source: view?.filters?.source || null, confidence: view?.filters?.confidence || null }, updatedAt: new Date().toISOString() };
}
