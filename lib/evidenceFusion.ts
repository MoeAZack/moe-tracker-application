import type { Round, TrackerData } from '../src/types';

export type EvidenceSource = 'coach' | 'replay' | 'screenshot' | 'vod' | 'manual';
export interface EvidenceCandidate { value: unknown; source: EvidenceSource; reference?: string }
export interface EvidenceResolutionAudit { at: string; by: string; source: EvidenceSource; value: unknown; reason: string; revision: number }
export interface EvidenceFusionResolution { id: string; matchId: string; roundId: string; field: string; selectedSource: EvidenceSource; selectedValue: unknown; reason: string; revision: number; updatedAt: string; updatedBy: string; history: EvidenceResolutionAudit[] }
export interface FusedFact { field: string; value: unknown; source: EvidenceSource; confidence: 'high' | 'medium' | 'low'; candidates: EvidenceCandidate[]; alternatives: EvidenceCandidate[]; conflict: boolean; resolved: boolean; resolutionId?: string }
export interface RoundFusion { roundId: string; roundNo: number; facts: FusedFact[]; conflicts: number; unresolvedConflicts: number; sources: EvidenceSource[] }
export interface EvidenceFusionReport { schema: 'moetracker.evidence-fusion/v2'; matchId: string; rounds: RoundFusion[]; coverage: number; conflicts: number; unresolvedConflicts: number; sourceCounts: Record<EvidenceSource, number>; policy: string[]; calculationVersion: string }

const priority: EvidenceSource[] = ['coach', 'replay', 'screenshot', 'vod', 'manual'];
const present = (value: unknown) => value !== null && value !== undefined && value !== '' && value !== 'Unknown';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function candidate(rows: EvidenceCandidate[], source: EvidenceSource, value: unknown, reference?: string) { if (present(value)) rows.push({ source, value, ...(reference ? { reference } : {}) }); }
const observationRound = (observation: any) => Number(observation?.roundNumber || observation?.attributes?.roundNumber || 0);

function factsFor(round: Round, replayRecord: any, resolutionRows: EvidenceFusionResolution[]): FusedFact[] {
  const fields: Record<string, EvidenceCandidate[]> = {};
  const add = (field: string, source: EvidenceSource, value: unknown, reference?: string) => candidate(fields[field] ||= [], source, value, reference);
  const screenshot: any = round.screenshotEvidence; const vod = (round.vodEvidence?.observations || []) as any[]; const coach = round.reviewCockpit;
  for (const [field, value] of Object.entries({ result: round.result, side: round.side, buy: round.buy, enemyBuy: round.enemyBuy, plant: round.plant, site: round.site, firstKillBy: round.firstKillBy, firstDeathBy: round.firstDeathBy })) add(field, 'manual', value, `round:${round.id}`);
  if (screenshot) {
    add('result', 'screenshot', screenshot.result, `screenshot:${round.id}`); add('buy', 'screenshot', screenshot.ourBuy || screenshot.ourAverageLoadout, `screenshot:${round.id}`); add('enemyBuy', 'screenshot', screenshot.enemyBuy || screenshot.enemyAverageLoadout, `screenshot:${round.id}`); add('events', 'screenshot', screenshot.events?.length, `screenshot:${round.id}`);
  }
  if (round.replayEvidence) { add('tradeOpportunities', 'replay', round.replayEvidence.tradeOpportunities, `replay:${round.id}`); add('successfulTrades', 'replay', round.replayEvidence.successfulTrades, `replay:${round.id}`); }
  if (round.advantageEvidence) add('advantageStates', 'replay', round.advantageEvidence.states, `replay:${round.id}`);
  const replayObservations = replayRecord?.status === 'accepted' ? (replayRecord?.draft?.evidence?.observations || []).filter((item: any) => observationRound(item) === round.roundNo) : [];
  if (replayObservations.length) {
    add('events', 'replay', replayObservations.length, `replay-round:${round.roundNo}`); add('ultimateUses', 'replay', replayObservations.filter((event: any) => String(event.signal || event.kind) === 'ultimate-use').length, `replay-round:${round.roundNo}`); add('orbCaptures', 'replay', replayObservations.filter((event: any) => String(event.signal || event.kind) === 'orb-capture').length, `replay-round:${round.roundNo}`);
  }
  if (vod.length) { add('events', 'vod', vod.length, `vod-round:${round.roundNo}`); add('ultimateUses', 'vod', vod.filter(event => event.kind === 'ultimate-use').length, `vod-round:${round.roundNo}`); add('orbCaptures', 'vod', vod.filter(event => event.kind === 'orb-capture').length, `vod-round:${round.roundNo}`); }
  if (coach?.note) add('coachNote', 'coach', coach.note, `coach:${round.id}`);
  return Object.entries(fields).filter(([, rows]) => rows.length > 0).map(([field, rows]) => {
    const ordered = [...rows].sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source));
    const resolution = resolutionRows.filter(item => item.roundId === round.id && item.field === field).sort((a, b) => b.revision - a.revision)[0];
    const winner = resolution ? { source: resolution.selectedSource, value: resolution.selectedValue, reference: `resolution:${resolution.id}` } : ordered[0];
    const alternatives = ordered.filter(item => item.source !== winner.source || !same(item.value, winner.value)).filter(item => !same(item.value, winner.value));
    const distinct = new Set(ordered.map(item => JSON.stringify(item.value))).size;
    return { field, value: winner.value, source: winner.source, confidence: resolution || winner.source === 'coach' || winner.source === 'replay' ? 'high' : winner.source === 'screenshot' ? 'medium' : 'low', candidates: ordered, alternatives, conflict: distinct > 1, resolved: !!resolution, ...(resolution ? { resolutionId: resolution.id } : {}) };
  });
}

export function buildEvidenceFusionReport(data: Pick<TrackerData, 'rounds'> & { evidenceFusionResolutions?: EvidenceFusionResolution[] }, matchId: string, replayRecord?: any): EvidenceFusionReport {
  const sourceCounts = { coach: 0, replay: 0, screenshot: 0, vod: 0, manual: 0 }; const resolutions = (data.evidenceFusionResolutions || []).filter(item => item.matchId === matchId);
  const rounds = (data.rounds || []).filter(round => round.matchId === matchId).sort((a, b) => a.roundNo - b.roundNo).map(round => { const facts = factsFor(round, replayRecord, resolutions); const sources = [...new Set(facts.flatMap(fact => fact.candidates.map(item => item.source)))]; for (const source of sources) sourceCounts[source] += 1; return { roundId: round.id, roundNo: round.roundNo, facts, conflicts: facts.filter(fact => fact.conflict).length, unresolvedConflicts: facts.filter(fact => fact.conflict && !fact.resolved).length, sources }; });
  const covered = rounds.filter(round => round.facts.length > 0).length;
  return { schema: 'moetracker.evidence-fusion/v2', matchId, rounds, coverage: rounds.length ? Math.round(covered / rounds.length * 100) : 0, conflicts: rounds.reduce((sum, round) => sum + round.conflicts, 0), unresolvedConflicts: rounds.reduce((sum, round) => sum + round.unresolvedConflicts, 0), sourceCounts, policy: ['Coach resolution', 'Accepted replay', 'Confirmed screenshot', 'Corroborated VOD', 'Manual log'], calculationVersion: 'evidence-fusion/v2' };
}

export function upsertEvidenceResolution(rows: EvidenceFusionResolution[], input: Omit<EvidenceFusionResolution, 'id' | 'revision' | 'updatedAt' | 'updatedBy' | 'history'>, by: string, now = new Date().toISOString()) {
  const index = rows.findIndex(item => item.matchId === input.matchId && item.roundId === input.roundId && item.field === input.field); const current = index >= 0 ? rows[index] : null; const revision = (current?.revision || 0) + 1; const audit = { at: now, by, source: input.selectedSource, value: structuredClone(input.selectedValue), reason: input.reason, revision };
  const stableId = `${input.matchId}:${input.roundId}:${input.field}`.replace(/[^a-z0-9:_-]/gi, '-').slice(0, 180);
  const next: EvidenceFusionResolution = { id: current?.id || `fusion:${stableId}`, ...input, revision, updatedAt: now, updatedBy: by, history: [...(current?.history || []), audit] }; if (index >= 0) rows[index] = next; else rows.push(next); return next;
}
