import type { Round } from '../src/types';

export type RoundEvidenceStatus = 'complete' | 'partial' | 'unavailable';
export interface ContextualRoundIntelligence {
  schema: 'moetracker.contextual-round-intelligence/v1';
  roundId: string;
  sources: string[];
  advantage: { status: RoundEvidenceStatus; states: string[]; outcome: 'converted' | 'lost' | 'unknown'; reason: string | null };
  trades: { status: RoundEvidenceStatus; opportunities: number | null; successful: number | null; windowSeconds: 5; reason: string | null };
  utility: { status: RoundEvidenceStatus; ultimateUses: number | null; orbCaptures: number | null; timeline: Array<{ kind: string; timestampMs: number; player: string | null; source: string }>; reason: string | null };
  phase: { status: RoundEvidenceStatus; contexts: string[]; reason: string | null };
  calculationVersion: 'contextual-round-intelligence/v1';
}

const kind = (event: any) => String(event?.kind || event?.type || event?.signal || '').trim().toLocaleLowerCase('en');
const time = (event: any) => Number.isFinite(Number(event?.timestampMs)) ? Number(event.timestampMs) : Number.isFinite(Number(event?.occurredAtSeconds)) ? Number(event.occurredAtSeconds) * 1000 : 0;
const player = (event: any) => String(event?.player || event?.victim || event?.killer || '').trim() || null;
const team = (event: any, side: 'killer' | 'victim') => { const value = String(event?.[`${side}Team`] || '').toLocaleLowerCase('en'); return value === 'ours' || value === 'theirs' ? value : null; };
const isElimination = (event: any) => ['elimination', 'kill', 'player-elimination'].includes(kind(event));

export function buildContextualRoundIntelligence(round: Round): ContextualRoundIntelligence {
  const vod = Array.isArray(round.vodEvidence?.observations) ? round.vodEvidence!.observations as any[] : [];
  const screenshot = Array.isArray(round.screenshotEvidence?.events) ? round.screenshotEvidence!.events as any[] : [];
  const sources = [...new Set([...(round.advantageEvidence ? [round.advantageEvidence.source] : []), ...(round.replayEvidence ? ['replay'] : []), ...(vod.length ? ['vod'] : []), ...(screenshot.length ? ['screenshot'] : [])])].sort();
  const vodRows = vod.map(event => ({ event, source: 'vod' })); const screenshotRows = screenshot.map(event => ({ event, source: 'screenshot' }));
  const timelineRows = round.advantageEvidence?.source === 'vod' && vod.length ? vodRows : round.screenshotEvidence?.eventsComplete && screenshot.length ? screenshotRows : vod.length ? vodRows : screenshotRows;

  const advantageComplete = round.advantageEvidence?.status === 'complete';
  const advantage = { status: advantageComplete ? 'complete' as const : round.advantageEvidence ? 'partial' as const : 'unavailable' as const, states: advantageComplete ? [...new Set((round.advantageEvidence?.states || []).map(state => state.label))] : [], outcome: advantageComplete ? round.advantageEvidence!.roundOutcome : 'unknown' as const, reason: advantageComplete ? null : round.advantageEvidence?.reason || 'complete-ordered-elimination-feed-required' };

  const replay = round.replayEvidence; let opportunities = typeof replay?.tradeOpportunities === 'number' ? replay.tradeOpportunities : null; let successful = typeof replay?.successfulTrades === 'number' ? replay.successfulTrades : null; let tradeStatus: RoundEvidenceStatus = opportunities !== null && successful !== null ? 'complete' : 'unavailable';
  if (tradeStatus === 'unavailable') {
    const selected = round.advantageEvidence?.source === 'vod' && vod.some(isElimination) ? vod : round.screenshotEvidence?.eventsComplete && screenshot.some(isElimination) ? screenshot : [];
    if (selected.length) { const eliminations = selected.filter(isElimination).sort((a, b) => time(a) - time(b)); const deaths = eliminations.filter(event => team(event, 'victim') === 'ours'); opportunities = deaths.length; successful = deaths.filter(death => { const killer = String(death.killer || ''); const at = time(death); return killer && eliminations.some(event => time(event) > at && time(event) - at <= 5_000 && team(event, 'killer') === 'ours' && String(event.victim || '') === killer); }).length; tradeStatus = 'complete'; }
  }
  const trades = { status: tradeStatus, opportunities, successful, windowSeconds: 5 as const, reason: tradeStatus === 'complete' ? null : 'complete-ordered-elimination-feed-required' };

  const utilityKinds = new Set(['utility-cast', 'utility-effect', 'ultimate-use', 'orb-capture']); const utilityRows = timelineRows.filter(item => utilityKinds.has(kind(item.event))).sort((a, b) => time(a.event) - time(b.event));
  const hasCompleteTimeline = (round.advantageEvidence?.source === 'vod' && vod.length > 0) || round.screenshotEvidence?.eventsComplete === true;
  const utility = { status: utilityRows.length && hasCompleteTimeline ? 'complete' as const : utilityRows.length ? 'partial' as const : 'unavailable' as const, ultimateUses: utilityRows.some(item => kind(item.event) === 'ultimate-use') ? utilityRows.filter(item => kind(item.event) === 'ultimate-use').length : null, orbCaptures: utilityRows.some(item => kind(item.event) === 'orb-capture') ? utilityRows.filter(item => kind(item.event) === 'orb-capture').length : null, timeline: utilityRows.map(item => ({ kind: kind(item.event), timestampMs: time(item.event), player: player(item.event), source: item.source })), reason: utilityRows.length ? null : 'no-accepted-utility-timeline-evidence' };

  const phaseKinds = new Set(['execute', 'retake', 'site-entry', 'rotation', 'post-plant', 'round-phase']); const contexts = [...new Set(timelineRows.map(item => kind(item.event)).filter(value => phaseKinds.has(value)))];
  const phase = { status: contexts.length && hasCompleteTimeline ? 'complete' as const : contexts.length ? 'partial' as const : 'unavailable' as const, contexts, reason: contexts.length ? null : 'no-accepted-phase-context-evidence' };
  return { schema: 'moetracker.contextual-round-intelligence/v1', roundId: round.id, sources, advantage, trades, utility, phase, calculationVersion: 'contextual-round-intelligence/v1' };
}
