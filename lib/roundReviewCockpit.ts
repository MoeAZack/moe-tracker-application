import type { Match, PlayerStats, Round, TrackerData, VodReview } from '../src/types';
import { buildContextualRoundIntelligence, type ContextualRoundIntelligence } from './contextualRoundIntelligence';

export type ReviewMomentKind = 'round-start' | 'opening-duel' | 'advantage-gained' | 'advantage-lost' | 'failed-trade' | 'plant' | 'defuse' | 'ultimate-use' | 'orb-capture' | 'coach-note';
export type ReviewClassificationType = 'advantage-collapse' | 'failed-trade-spacing' | 'economy-mismatch' | 'post-plant-loss' | 'first-death-review' | 'utility-unused-review';

export interface RoundReviewMoment {
  id: string;
  kind: ReviewMomentKind;
  timestampMs: number;
  label: string;
  player: string | null;
  confidence: number | null;
  source: 'vod' | 'screenshot' | 'replay' | 'coach';
}

export interface RoundReviewSuggestion {
  type: ReviewClassificationType;
  label: string;
  reason: string;
  player: string | null;
  confidence: 'high' | 'medium' | 'review';
  requiresCoachConfirmation: boolean;
}

export interface RoundReviewCard {
  id: string;
  match: Match;
  round: Round;
  review: VodReview | null;
  economy: { ours: string | null; theirs: string | null };
  opening: { firstKillBy: string | null; firstDeathBy: string | null };
  trades: { opportunities: number | null; successful: number | null };
  objective: { plant: boolean | null; defuse: boolean | null; site: string | null };
  utility: { ultimateUses: number | null; orbCaptures: number | null };
  moments: RoundReviewMoment[];
  suggestions: RoundReviewSuggestion[];
  sources: Array<'replay' | 'screenshot' | 'vod' | 'coach'>;
  evidenceCoverage: 'complete' | 'partial' | 'limited';
  intelligence: ContextualRoundIntelligence;
}

export interface RecurringReviewPattern {
  dimension: 'player' | 'map' | 'side' | 'site' | 'agent' | 'composition' | 'opponent';
  key: string;
  issue: ReviewClassificationType;
  count: number;
  rounds: Array<{ matchId: string; roundNo: number }>;
}

const text = (value: unknown) => String(value ?? '').trim();
const numberOrNull = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const eventTime = (event: any, fallback = 0) => numberOrNull(event?.timestampMs) ?? (numberOrNull(event?.occurredAtSeconds) !== null ? Number(event.occurredAtSeconds) * 1000 : fallback);
const eventKind = (event: any) => text(event?.kind || event?.type || event?.signal).toLocaleLowerCase('en');
const isWin = (round: Round) => ['w', 'win', 'won'].includes(text(round.result).toLocaleLowerCase('en'));
const isLoss = (round: Round) => ['l', 'loss', 'lost'].includes(text(round.result).toLocaleLowerCase('en'));
const display = (value: unknown) => text(value) || null;

function vodEvents(round: Round): any[] { return Array.isArray(round.vodEvidence?.observations) ? round.vodEvidence.observations as any[] : []; }
function screenshotEvents(round: Round): any[] { return Array.isArray(round.screenshotEvidence?.events) ? round.screenshotEvidence.events as any[] : []; }
function allTimedEvents(round: Round): Array<{ event: any; source: 'vod' | 'screenshot' }> {
  return [...vodEvents(round).map(event => ({ event, source: 'vod' as const })), ...screenshotEvents(round).map(event => ({ event, source: 'screenshot' as const }))]
    .filter(item => eventTime(item.event, -1) >= 0)
    .sort((left, right) => eventTime(left.event) - eventTime(right.event));
}

function eliminationTeam(event: any, side: 'killer' | 'victim'): string | null {
  const value = text(event?.[`${side}Team`]).toLocaleLowerCase('en');
  return value === 'ours' || value === 'theirs' ? value : null;
}

function buildMoments(round: Round, review: VodReview | null): RoundReviewMoment[] {
  const items: RoundReviewMoment[] = [];
  const timed = allTimedEvents(round);
  const eliminations = timed.filter(item => eventKind(item.event) === 'elimination' || eventKind(item.event) === 'kill');
  const add = (kind: ReviewMomentKind, timestampMs: number, label: string, player: string | null, source: RoundReviewMoment['source'], confidence: number | null = null) => {
    const id = `${kind}:${Math.round(timestampMs)}:${player || ''}`;
    if (!items.some(item => item.id === id)) items.push({ id, kind, timestampMs: Math.max(0, Math.round(timestampMs)), label, player, source, confidence });
  };
  const first = eliminations[0];
  if (first) add('opening-duel', eventTime(first.event), `Opening duel · ${display(first.event.killer) || 'unknown'} → ${display(first.event.victim) || 'unknown'}`, display(first.event.victim), first.source, numberOrNull(first.event.confidence));

  let oursAlive = 5; let theirsAlive = 5; let hadAdvantage = false;
  for (const item of eliminations) {
    const victimTeam = eliminationTeam(item.event, 'victim');
    if (victimTeam === 'ours') oursAlive = Math.max(0, oursAlive - 1);
    if (victimTeam === 'theirs') theirsAlive = Math.max(0, theirsAlive - 1);
    if (oursAlive > theirsAlive && theirsAlive > 0 && !hadAdvantage) {
      hadAdvantage = true;
      add('advantage-gained', eventTime(item.event), `Advantage gained · ${oursAlive}v${theirsAlive}`, display(item.event.killer), item.source, numberOrNull(item.event.confidence));
    } else if (hadAdvantage && oursAlive <= theirsAlive) {
      hadAdvantage = false;
      add('advantage-lost', eventTime(item.event), `Advantage lost · ${oursAlive}v${theirsAlive}`, display(item.event.victim), item.source, numberOrNull(item.event.confidence));
    }
  }

  for (const death of eliminations.filter(item => eliminationTeam(item.event, 'victim') === 'ours')) {
    const killer = display(death.event.killer); const at = eventTime(death.event);
    if (!killer) continue;
    const traded = eliminations.some(item => eventTime(item.event) > at && eventTime(item.event) - at <= 5_000 && eliminationTeam(item.event, 'killer') === 'ours' && display(item.event.victim) === killer);
    if (!traded && (round.screenshotEvidence?.eventsComplete || round.advantageEvidence?.status === 'complete')) add('failed-trade', at, `Untraded death · ${display(death.event.victim) || 'unknown'}`, display(death.event.victim), death.source, numberOrNull(death.event.confidence));
  }

  for (const item of timed) {
    const kind = eventKind(item.event);
    if (kind === 'plant') add('plant', eventTime(item.event), `Spike planted${display(item.event.player) ? ` · ${display(item.event.player)}` : ''}`, display(item.event.player), item.source, numberOrNull(item.event.confidence));
    if (kind === 'defuse') add('defuse', eventTime(item.event), `Spike defused${display(item.event.player) ? ` · ${display(item.event.player)}` : ''}`, display(item.event.player), item.source, numberOrNull(item.event.confidence));
    if (kind === 'ultimate-use') add('ultimate-use', eventTime(item.event), `Ultimate used${display(item.event.player) ? ` · ${display(item.event.player)}` : ''}`, display(item.event.player), item.source, numberOrNull(item.event.confidence));
    if (kind === 'orb-capture') add('orb-capture', eventTime(item.event), `Orb captured${display(item.event.player) ? ` · ${display(item.event.player)}` : ''}`, display(item.event.player), item.source, numberOrNull(item.event.confidence));
  }
  for (const note of review?.notes || []) if (note.roundNo === round.roundNo) add('coach-note', note.seconds * 1000, `Coach note · ${note.text}`, null, 'coach', 1);
  return items.sort((left, right) => left.timestampMs - right.timestampMs);
}

function buildSuggestions(round: Round, moments: RoundReviewMoment[]): RoundReviewSuggestion[] {
  const suggestions: RoundReviewSuggestion[] = [];
  const add = (suggestion: RoundReviewSuggestion) => { if (!suggestions.some(item => item.type === suggestion.type && item.player === suggestion.player)) suggestions.push(suggestion); };
  const lostAdvantage = round.advantageEvidence?.states?.some(state => state.outcome === 'lost');
  if (lostAdvantage) add({ type: 'advantage-collapse', label: 'Advantage collapse', reason: `Lost after reaching ${round.advantageEvidence?.states?.find(state => state.outcome === 'lost')?.label || 'a man advantage'}.`, player: null, confidence: round.advantageEvidence?.status === 'complete' ? 'high' : 'medium', requiresCoachConfirmation: false });
  for (const moment of moments.filter(item => item.kind === 'failed-trade')) add({ type: 'failed-trade-spacing', label: 'Failed trade spacing', reason: `${moment.player || 'A player'} died without a proven return kill inside five seconds.`, player: moment.player, confidence: 'high', requiresCoachConfirmation: false });
  if (text(round.buy) && text(round.enemyBuy) && text(round.buy).toLocaleLowerCase('en') !== text(round.enemyBuy).toLocaleLowerCase('en') && isLoss(round)) add({ type: 'economy-mismatch', label: 'Economy mismatch', reason: `${round.buy} versus ${round.enemyBuy} ended in a loss.`, player: null, confidence: 'high', requiresCoachConfirmation: false });
  if ((round.plant === 'TRUE' || moments.some(item => item.kind === 'plant')) && isLoss(round)) add({ type: 'post-plant-loss', label: 'Post-plant loss', reason: 'The spike was planted, but the round was lost.', player: null, confidence: 'high', requiresCoachConfirmation: false });
  if (round.firstDeathBy && isLoss(round)) add({ type: 'first-death-review', label: 'Review first-death decision', reason: 'Check isolation, overpeek risk, spacing, and the intended trade plan. Tactical intent is not asserted automatically.', player: round.firstDeathBy, confidence: 'review', requiresCoachConfirmation: true });
  const readyStates = vodEvents(round).filter(event => eventKind(event) === 'ultimate-state' && Number(event.current) === Number(event.required));
  if (readyStates.length && !moments.some(item => item.kind === 'ultimate-use') && isLoss(round)) for (const state of readyStates) add({ type: 'utility-unused-review', label: 'Review unused ultimate', reason: 'The HUD showed an ultimate ready and no cast was proven before the loss. Confirm tactical context.', player: display(state.player), confidence: 'review', requiresCoachConfirmation: true });
  return suggestions;
}

export function buildRoundReviewCards(data: TrackerData, matchId?: string | null): RoundReviewCard[] {
  const matches = new Map((data.matches || []).map(match => [match.id, match]));
  const reviews = data.vodReviews || [];
  return (data.rounds || []).filter(round => !matchId || round.matchId === matchId).map(round => {
    const match = matches.get(round.matchId); if (!match) return null;
    const review = reviews.find(item => item.matchId === round.matchId) || null;
    const moments = buildMoments(round, review);
    const intelligence = buildContextualRoundIntelligence(round);
    const objectives = [...(round.screenshotEvidence?.objectives || []), ...vodEvents(round).filter(event => ['plant', 'defuse'].includes(eventKind(event)))];
    const sources: RoundReviewCard['sources'] = [];
    if (round.replayEvidence) sources.push('replay'); if (round.screenshotEvidence) sources.push('screenshot'); if (round.vodEvidence) sources.push('vod'); if (review?.notes?.some(note => note.roundNo === round.roundNo)) sources.push('coach');
    const completeness = sources.length >= 2 && (round.advantageEvidence?.status === 'complete' || round.screenshotEvidence?.eventsComplete) ? 'complete' : sources.length ? 'partial' : 'limited';
    return { id: round.id, match, round, review, economy: { ours: display(round.buy), theirs: display(round.enemyBuy) }, opening: { firstKillBy: display(round.firstKillBy), firstDeathBy: display(round.firstDeathBy) }, trades: { opportunities: intelligence.trades.opportunities, successful: intelligence.trades.successful }, objective: { plant: round.plant === 'TRUE' || objectives.some(event => eventKind(event) === 'plant') ? true : round.plant === 'FALSE' ? false : null, defuse: objectives.some(event => eventKind(event) === 'defuse') ? true : null, site: display(round.site) }, utility: { ultimateUses: intelligence.utility.ultimateUses, orbCaptures: intelligence.utility.orbCaptures }, moments, suggestions: buildSuggestions(round, moments), sources, evidenceCoverage: completeness, intelligence };
  }).filter((card): card is RoundReviewCard => Boolean(card)).sort((left, right) => left.match.date.localeCompare(right.match.date) || left.round.roundNo - right.round.roundNo);
}

function statForPlayer(stats: PlayerStats[], matchId: string, player: string) {
  const normalized = player.toLocaleLowerCase('en');
  return stats.find(stat => stat.matchId === matchId && [stat.player, stat.displayNameSnapshot].some(value => text(value).toLocaleLowerCase('en') === normalized));
}

export function buildRecurringReviewPatterns(data: TrackerData, cards = buildRoundReviewCards(data)): RecurringReviewPattern[] {
  const grouped = new Map<string, RecurringReviewPattern>();
  for (const card of cards) for (const suggestion of card.suggestions) {
    const decision = card.round.reviewCockpit?.classifications?.find(item => item.type === suggestion.type && String(item.player || '') === String(suggestion.player || ''));
    if (decision?.status === 'dismissed' || (suggestion.requiresCoachConfirmation && decision?.status !== 'confirmed')) continue;
    const stats = (data.playerStats || []).filter(stat => stat.matchId === card.match.id);
    const playerStat = suggestion.player ? statForPlayer(stats, card.match.id, suggestion.player) : null;
    const composition = [...new Set(stats.map(stat => text(stat.agent)).filter(Boolean))].sort().join(' · ');
    const dimensions: Array<[RecurringReviewPattern['dimension'], string | null]> = [['player', suggestion.player], ['map', display(card.match.map)], ['side', display(card.round.side)], ['site', card.objective.site], ['agent', display(playerStat?.agent)], ['composition', composition || null], ['opponent', display(card.match.opponent)]];
    for (const [dimension, key] of dimensions) {
      if (!key) continue; const id = `${dimension}:${key.toLocaleLowerCase('en')}:${suggestion.type}`;
      const row = grouped.get(id) || { dimension, key, issue: suggestion.type, count: 0, rounds: [] };
      row.count += 1; row.rounds.push({ matchId: card.match.id, roundNo: card.round.roundNo }); grouped.set(id, row);
    }
  }
  return [...grouped.values()].filter(row => row.count >= 2).sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}
