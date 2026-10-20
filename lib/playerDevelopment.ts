import type { TrackerData } from '../src/types';
import { buildRecurringReviewPatterns, buildRoundReviewCards } from './roundReviewCockpit';

export function buildPlayerDevelopment(data: TrackerData) {
  const cards = buildRoundReviewCards(data); const patterns = buildRecurringReviewPatterns(data, cards);
  const players = new Map<string, { player: string; strengths: string[]; weaknesses: string[]; evidenceRounds: number }>();
  for (const pattern of patterns.filter(item => item.dimension === 'player')) { const row = players.get(pattern.key) || { player: pattern.key, strengths: [], weaknesses: [], evidenceRounds: 0 }; row.weaknesses.push(`${pattern.issue.replaceAll('-', ' ')} · ${pattern.count} rounds`); row.evidenceRounds += pattern.count; players.set(pattern.key, row); }
  for (const stat of data.playerStats || []) { const name = stat.displayNameSnapshot || stat.player; if (!name) continue; const row = players.get(name) || { player: name, strengths: [], weaknesses: [], evidenceRounds: 0 }; if (Number(stat.fk || 0) > Number(stat.fd || 0)) row.strengths.push(`Positive openings ${stat.fk}–${stat.fd}`); if (Number(stat.kastCovered || 0) >= 5 && Number(stat.kastSuccessful || 0) / Number(stat.kastCovered) >= .75) row.strengths.push(`KAST ${Math.round(Number(stat.kastSuccessful) / Number(stat.kastCovered) * 100)}%`); players.set(name, row); }
  return [...players.values()].map(row => ({ ...row, strengths: [...new Set(row.strengths)], weaknesses: [...new Set(row.weaknesses)] })).sort((a, b) => b.evidenceRounds - a.evidenceRounds || a.player.localeCompare(b.player));
}

export function buildDebrief(data: TrackerData, matchId: string) {
  const match = data.matches.find(item => item.id === matchId); const cards = buildRoundReviewCards(data, matchId); const issues = cards.flatMap(card => card.suggestions.filter(suggestion => { const decision = card.round.reviewCockpit?.classifications?.find(item => item.type === suggestion.type && String(item.player || '') === String(suggestion.player || '')); return decision?.status !== 'dismissed' && (!suggestion.requiresCoachConfirmation || decision?.status === 'confirmed'); }).map(suggestion => ({ roundNo: card.round.roundNo, label: suggestion.label, reason: suggestion.reason, player: suggestion.player })));
  return { match, reviewedRounds: cards.filter(card => card.round.reviewCockpit?.note || card.round.reviewCockpit?.classifications?.length).length, evidenceRounds: cards.length, positives: cards.filter(card => ['W', 'win', 'won'].includes(String(card.round.result))).length, issues, nextActions: [...new Set(issues.slice(0, 3).map(issue => `Review ${issue.label.toLowerCase()} from round ${issue.roundNo}`))] };
}
