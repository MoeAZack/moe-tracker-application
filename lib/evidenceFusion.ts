import type { Round, TrackerData } from '../src/types';

export type EvidenceSource = 'coach' | 'replay' | 'screenshot' | 'vod' | 'manual';
export interface FusedFact { field: string; value: unknown; source: EvidenceSource; confidence: 'high' | 'medium' | 'low'; alternatives: Array<{ value: unknown; source: EvidenceSource }>; conflict: boolean }
export interface RoundFusion { roundId: string; roundNo: number; facts: FusedFact[]; conflicts: number; sources: EvidenceSource[] }
export interface EvidenceFusionReport { matchId: string; rounds: RoundFusion[]; coverage: number; conflicts: number; sourceCounts: Record<EvidenceSource, number>; policy: string[] }

const priority: EvidenceSource[] = ['coach', 'replay', 'screenshot', 'vod', 'manual'];
const present = (value: unknown) => value !== null && value !== undefined && value !== '' && value !== 'Unknown';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function candidate(rows: Array<{ value: unknown; source: EvidenceSource }>, source: EvidenceSource, value: unknown) { if (present(value)) rows.push({ source, value }); }

function factsFor(round: Round): FusedFact[] {
  const fields: Record<string, Array<{ value: unknown; source: EvidenceSource }>> = {};
  const add = (field: string, source: EvidenceSource, value: unknown) => candidate(fields[field] ||= [], source, value);
  const screenshot: any = round.screenshotEvidence; const vod = (round.vodEvidence?.observations || []) as any[]; const coach = round.reviewCockpit;
  for (const [field, value] of Object.entries({ result: round.result, side: round.side, buy: round.buy, enemyBuy: round.enemyBuy, plant: round.plant, site: round.site, firstKillBy: round.firstKillBy, firstDeathBy: round.firstDeathBy })) add(field, 'manual', value);
  if (screenshot) {
    add('result', 'screenshot', screenshot.result); add('buy', 'screenshot', screenshot.ourBuy || screenshot.ourAverageLoadout); add('enemyBuy', 'screenshot', screenshot.enemyBuy || screenshot.enemyAverageLoadout);
    add('events', 'screenshot', screenshot.events?.length);
  }
  if (round.replayEvidence) { add('tradeOpportunities', 'replay', round.replayEvidence.tradeOpportunities); add('successfulTrades', 'replay', round.replayEvidence.successfulTrades); }
  if (round.advantageEvidence) add('advantageStates', 'replay', round.advantageEvidence.states);
  if (vod.length) { add('events', 'vod', vod.length); add('ultimateUses', 'vod', vod.filter(event => event.kind === 'ultimate-use').length); add('orbCaptures', 'vod', vod.filter(event => event.kind === 'orb-capture').length); }
  if (coach?.note) add('coachNote', 'coach', coach.note);
  return Object.entries(fields).filter(([, rows]) => rows.length > 0).map(([field, rows]) => {
    const ordered = [...rows].sort((a, b) => priority.indexOf(a.source) - priority.indexOf(b.source)); const winner = ordered[0]; const alternatives = ordered.slice(1).filter(item => !same(item.value, winner.value));
    return { field, value: winner.value, source: winner.source, confidence: winner.source === 'coach' || winner.source === 'replay' ? 'high' : winner.source === 'screenshot' ? 'medium' : 'low', alternatives, conflict: alternatives.length > 0 };
  });
}

export function buildEvidenceFusionReport(data: Pick<TrackerData, 'rounds'>, matchId: string): EvidenceFusionReport {
  const sourceCounts = { coach: 0, replay: 0, screenshot: 0, vod: 0, manual: 0 };
  const rounds = (data.rounds || []).filter(round => round.matchId === matchId).map(round => {
    const facts = factsFor(round); const sources = [...new Set(facts.map(fact => fact.source))]; for (const source of sources) sourceCounts[source] += 1;
    return { roundId: round.id, roundNo: round.roundNo, facts, conflicts: facts.filter(fact => fact.conflict).length, sources };
  });
  const covered = rounds.filter(round => round.facts.length > 0).length;
  return { matchId, rounds, coverage: rounds.length ? Math.round(covered / rounds.length * 100) : 0, conflicts: rounds.reduce((sum, round) => sum + round.conflicts, 0), sourceCounts, policy: ['Coach correction', 'Accepted replay', 'Confirmed screenshot', 'Corroborated VOD', 'Manual log'] };
}
