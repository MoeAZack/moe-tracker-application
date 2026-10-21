import type { Round, TrackerData } from '../src/types';

export type EvidenceSource = 'coach' | 'replay' | 'screenshot' | 'vod' | 'manual';
export interface EvidenceCandidate { value: unknown; source: EvidenceSource; reference?: string }
export interface EvidenceResolutionAudit { at: string; by: string; source: EvidenceSource; value: unknown; reason: string; revision: number }
export interface EvidenceFusionResolution { id: string; matchId: string; roundId: string; field: string; selectedSource: EvidenceSource; selectedValue: unknown; reason: string; revision: number; updatedAt: string; updatedBy: string; history: EvidenceResolutionAudit[] }
export interface FusedFact { field: string; value: unknown; source: EvidenceSource; confidence: 'high' | 'medium' | 'low'; candidates: EvidenceCandidate[]; alternatives: EvidenceCandidate[]; conflict: boolean; resolved: boolean; resolutionId?: string }
export interface RoundFusion { roundId: string; roundNo: number; facts: FusedFact[]; conflicts: number; unresolvedConflicts: number; sources: EvidenceSource[] }
export interface PlayerFusion { playerStatId: string; playerId: string | null; displayName: string; facts: FusedFact[]; conflicts: number; unresolvedConflicts: number; sources: EvidenceSource[] }
export interface EvidenceFusionReport { schema: 'moetracker.evidence-fusion/v3'; matchId: string; rounds: RoundFusion[]; players: PlayerFusion[]; coverage: number; conflicts: number; unresolvedConflicts: number; sourceCounts: Record<EvidenceSource, number>; policy: string[]; calculationVersion: string }

const priority: EvidenceSource[] = ['coach', 'replay', 'screenshot', 'vod', 'manual'];
const present = (value: unknown) => value !== null && value !== undefined && value !== '' && value !== 'Unknown';
export const sameEvidenceValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const same = sameEvidenceValue;
function candidate(rows: EvidenceCandidate[], source: EvidenceSource, value: unknown, reference?: string) { if (present(value)) rows.push({ source, value, ...(reference ? { reference } : {}) }); }
const observationRound = (observation: any) => Number(observation?.roundNumber || observation?.attributes?.roundNumber || 0);

function fuseFields(fields: Record<string, EvidenceCandidate[]>, entityId: string, resolutionRows: EvidenceFusionResolution[]): FusedFact[] {
  return Object.entries(fields).filter(([, rows]) => rows.length > 0).map(([field, rows]) => {
    const ordered = [...rows].sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source));
    const resolution = resolutionRows.filter(item => item.roundId === entityId && item.field === field).sort((a, b) => b.revision - a.revision)[0];
    const winner = resolution ? { source: resolution.selectedSource, value: resolution.selectedValue, reference: `resolution:${resolution.id}` } : ordered[0];
    const alternatives = ordered.filter(item => item.source !== winner.source || !same(item.value, winner.value)).filter(item => !same(item.value, winner.value));
    const distinct = new Set(ordered.map(item => JSON.stringify(item.value))).size;
    return { field, value: winner.value, source: winner.source, confidence: resolution || winner.source === 'coach' || winner.source === 'replay' ? 'high' : winner.source === 'screenshot' ? 'medium' : 'low', candidates: ordered, alternatives, conflict: distinct > 1, resolved: !!resolution, ...(resolution ? { resolutionId: resolution.id } : {}) };
  });
}

function factsFor(round: Round, replayRecord: any, resolutionRows: EvidenceFusionResolution[]): FusedFact[] {
  const fields: Record<string, EvidenceCandidate[]> = {};
  const add = (field: string, source: EvidenceSource, value: unknown, reference?: string) => candidate(fields[field] ||= [], source, value, reference);
  const screenshot: any = round.screenshotEvidence; const vod = (round.vodEvidence?.observations || []) as any[]; const coach = round.reviewCockpit;
  const reconciled = new Set<string>();
  for (const comparison of (round as any).evidenceReconciliation?.comparisons || []) {
    reconciled.add(comparison.field); add(comparison.field, 'screenshot', comparison.screenshot, `round-screenshot:${round.id}`); add(comparison.field, 'replay', comparison.replay, `round-replay:${round.id}`);
  }
  for (const [field, value] of Object.entries({ result: round.result, side: round.side, buy: round.buy, enemyBuy: round.enemyBuy, plant: round.plant, site: round.site, firstKillBy: round.firstKillBy, firstDeathBy: round.firstDeathBy })) if (!reconciled.has(field)) add(field, 'manual', value, `round:${round.id}`);
  if (screenshot?.reviewStatus === 'confirmed') {
    if (!reconciled.has('result')) add('result', 'screenshot', screenshot.result ?? round.result, `screenshot:${round.id}`); if (!reconciled.has('buy')) add('buy', 'screenshot', screenshot.ourBuy || screenshot.ourAverageLoadout || round.buy, `screenshot:${round.id}`); if (!reconciled.has('enemyBuy')) add('enemyBuy', 'screenshot', screenshot.enemyBuy || screenshot.enemyAverageLoadout || round.enemyBuy, `screenshot:${round.id}`); add('events', 'screenshot', screenshot.events?.length, `screenshot:${round.id}`);
    if (screenshot.eventsComplete !== true) delete fields.events;
  }
  if (round.replayEvidence) { add('tradeOpportunities', 'replay', round.replayEvidence.tradeOpportunities, `replay:${round.id}`); add('successfulTrades', 'replay', round.replayEvidence.successfulTrades, `replay:${round.id}`); }
  if (round.advantageEvidence) add('advantageStates', 'replay', round.advantageEvidence.states, `replay:${round.id}`);
  const replayObservations = replayRecord?.status === 'accepted' ? (replayRecord?.draft?.evidence?.observations || []).filter((item: any) => observationRound(item) === round.roundNo) : [];
  if (replayObservations.length) {
    add('events', 'replay', replayObservations.length, `replay-round:${round.roundNo}`); add('ultimateUses', 'replay', replayObservations.filter((event: any) => String(event.signal || event.kind) === 'ultimate-use').length, `replay-round:${round.roundNo}`); add('orbCaptures', 'replay', replayObservations.filter((event: any) => String(event.signal || event.kind) === 'orb-capture').length, `replay-round:${round.roundNo}`);
  }
  if (vod.length) { add('events', 'vod', vod.length, `vod-round:${round.roundNo}`); add('ultimateUses', 'vod', vod.filter(event => event.kind === 'ultimate-use').length, `vod-round:${round.roundNo}`); add('orbCaptures', 'vod', vod.filter(event => event.kind === 'orb-capture').length, `vod-round:${round.roundNo}`); }
  if (coach?.note) add('coachNote', 'coach', coach.note, `coach:${round.id}`);
  return fuseFields(fields, round.id, resolutionRows);
}

function playerFacts(stat: any, resolutionRows: EvidenceFusionResolution[]) {
  const fields: Record<string, EvidenceCandidate[]> = {}; const add = (field: string, source: EvidenceSource, value: unknown, reference?: string) => candidate(fields[field] ||= [], source, value, reference);
  for (const comparison of stat.evidenceReconciliation?.comparisons || []) {
    add(comparison.field, 'screenshot', comparison.screenshot, `player-screenshot:${stat.id}`);
    add(comparison.field, 'replay', comparison.replay, `player-replay:${stat.id}`);
  }
  const method = stat.sourceMetadata?.method; const currentSource: EvidenceSource = method === 'provider-import' ? 'replay' : method === 'screenshot' ? 'screenshot' : method === 'vod-submission' ? 'vod' : 'manual';
  for (const field of ['kills', 'deaths', 'assists', 'acs', 'adr', 'hs', 'headshots', 'orbPoints', 'ultimateUses', 'kastSuccessful', 'kastCovered', 'fk', 'fd', 'plants', 'defuses', 'trades']) if (!(stat.evidenceReconciliation?.comparisons || []).some((item: any) => item.field === field)) add(field, currentSource, stat[field], `player:${stat.id}`);
  return fuseFields(fields, stat.id, resolutionRows);
}

export function buildEvidenceFusionReport(data: Pick<TrackerData, 'rounds' | 'playerStats'> & { evidenceFusionResolutions?: EvidenceFusionResolution[] }, matchId: string, replayRecord?: any): EvidenceFusionReport {
  const sourceCounts = { coach: 0, replay: 0, screenshot: 0, vod: 0, manual: 0 }; const resolutions = (data.evidenceFusionResolutions || []).filter(item => item.matchId === matchId);
  const rounds = (data.rounds || []).filter(round => round.matchId === matchId).sort((a, b) => a.roundNo - b.roundNo).map(round => { const facts = factsFor(round, replayRecord, resolutions); const sources = [...new Set(facts.flatMap(fact => fact.candidates.map(item => item.source)))]; for (const source of sources) sourceCounts[source] += 1; return { roundId: round.id, roundNo: round.roundNo, facts, conflicts: facts.filter(fact => fact.conflict).length, unresolvedConflicts: facts.filter(fact => fact.conflict && !fact.resolved).length, sources }; });
  const players = (data.playerStats || []).filter(stat => stat.matchId === matchId).map(stat => { const facts = playerFacts(stat, resolutions); const sources = [...new Set(facts.flatMap(fact => fact.candidates.map(item => item.source)))]; for (const source of sources) sourceCounts[source] += 1; return { playerStatId: stat.id, playerId: stat.playerId || null, displayName: stat.displayNameSnapshot || stat.player, facts, conflicts: facts.filter(fact => fact.conflict).length, unresolvedConflicts: facts.filter(fact => fact.conflict && !fact.resolved).length, sources }; });
  const covered = rounds.filter(round => round.facts.length > 0).length;
  return { schema: 'moetracker.evidence-fusion/v3', matchId, rounds, players, coverage: rounds.length ? Math.round(covered / rounds.length * 100) : 0, conflicts: [...rounds, ...players].reduce((sum, item) => sum + item.conflicts, 0), unresolvedConflicts: [...rounds, ...players].reduce((sum, item) => sum + item.unresolvedConflicts, 0), sourceCounts, policy: ['Coach resolution', 'Accepted replay', 'Confirmed screenshot', 'Corroborated VOD', 'Manual log'], calculationVersion: 'evidence-fusion/v3' };
}

export function upsertEvidenceResolution(rows: EvidenceFusionResolution[], input: Omit<EvidenceFusionResolution, 'id' | 'revision' | 'updatedAt' | 'updatedBy' | 'history'>, by: string, now = new Date().toISOString()) {
  const index = rows.findIndex(item => item.matchId === input.matchId && item.roundId === input.roundId && item.field === input.field); const current = index >= 0 ? rows[index] : null; const revision = (current?.revision || 0) + 1; const audit = { at: now, by, source: input.selectedSource, value: structuredClone(input.selectedValue), reason: input.reason, revision };
  const stableId = `${input.matchId}:${input.roundId}:${input.field}`.replace(/[^a-z0-9:_-]/gi, '-').slice(0, 180);
  const next: EvidenceFusionResolution = { id: current?.id || `fusion:${stableId}`, ...input, revision, updatedAt: now, updatedBy: by, history: [...(current?.history || []), audit] }; if (index >= 0) rows[index] = next; else rows.push(next); return next;
}

const FIELD_LABELS: Record<string, string> = {
  result: 'Round result', side: 'Side', buy: 'Our buy', enemyBuy: 'Enemy buy', plant: 'Spike plant', site: 'Site',
  firstKillBy: 'First kill', firstDeathBy: 'First death', events: 'Kill-feed events', tradeOpportunities: 'Trade opportunities',
  successfulTrades: 'Successful trades', advantageStates: 'Man-advantage sequence', ultimateUses: 'Ultimates used', orbCaptures: 'Orbs captured',
  coachNote: 'Coach note', kills: 'Kills', deaths: 'Deaths', assists: 'Assists', acs: 'ACS', adr: 'ADR', hs: 'Headshot %', headshots: 'Headshots',
  orbPoints: 'Orb points', kastSuccessful: 'KAST rounds', kastCovered: 'KAST rounds covered', fk: 'First kills', fd: 'First deaths',
  plants: 'Plants', defuses: 'Defuses', trades: 'Trades',
};
const SOURCE_LABELS: Record<EvidenceSource, string> = { coach: 'Coach', replay: 'Replay', screenshot: 'Screenshot', vod: 'VOD', manual: 'Manual log' };

/** Plain-language name for a fused field; unknown internal keys are split into words. */
export function fusionFieldLabel(field: string) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Field';
}

export const fusionSourceLabel = (source: EvidenceSource | string) => SOURCE_LABELS[source as EvidenceSource] || String(source);

/**
 * Readable candidate value for the conflict ledger. Structured values are
 * summarised (an advantage sequence reads "5v5 → 5v4"); the stored record
 * keeps the exact value, so nothing here is ever raw JSON.
 */
export function fusionValueLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Unknown';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : 'Unknown';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  if (Array.isArray(value)) {
    if (!value.length) return 'None';
    const labels = value.map(item => item && typeof item === 'object' && typeof (item as any).label === 'string' ? (item as any).label : null);
    if (labels.every((label): label is string => label !== null)) { const text = labels.join(' → '); return text.length > 60 ? `${labels.length} states, ending ${labels.at(-1)}` : text; }
    return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`;
  }
  if (typeof value === 'object' && typeof (value as any).label === 'string') return (value as any).label;
  return 'Structured value (kept in the audit record)';
}
