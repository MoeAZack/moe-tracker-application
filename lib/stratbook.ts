import { knownResult } from './analyticsEvidence';

export const STRAT_SIDES = ['Att', 'Def', 'Retake'] as const;
export type StratSide = typeof STRAT_SIDES[number];

/** One side vocabulary for every strategy writer. AI tools used to save 'Attack'/'Defense'. */
export function stratSide(value: unknown): StratSide | '' {
  const side = String(value ?? '').trim().toLowerCase();
  if (side === 'att' || side === 'attack' || side === 'atk') return 'Att';
  if (side === 'def' || side === 'defense' || side === 'defence') return 'Def';
  if (side === 'retake') return 'Retake';
  return '';
}

const sameText = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

export interface StratRecord {
  /** Runs logged against this strategy (by hand, or by Live Logger for each round it was picked). */
  runWins: number; runLosses: number; lastFailReason: string;
  /** Rounds on this strategy's map that name it in their strategy list. */
  taggedWins: number; taggedRounds: number;
}

/**
 * Per-strategy tallies. The two counts are kept apart rather than summed: Live
 * Logger writes both a run and a round tag for the same round, so adding them
 * would count it twice.
 */
export function buildStratRecords(strats: any[], runs: any[], rounds: any[], matches: any[]): Record<string, StratRecord> {
  const records: Record<string, StratRecord> = {};
  strats.forEach(strat => { records[strat.id] = { runWins: 0, runLosses: 0, lastFailReason: '', taggedWins: 0, taggedRounds: 0 }; });
  [...runs].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach(run => {
    const record = records[run.stratId];
    const result = knownResult(run.result);
    if (!record || !result) return;
    if (result === 'win') record.runWins += 1;
    else { record.runLosses += 1; if (String(run.reason || '').trim()) record.lastFailReason = String(run.reason).trim(); }
  });
  const mapByMatch = new Map(matches.map(match => [match.id, match.map]));
  rounds.forEach(round => {
    const names = String(round.strategies || '').split(',').map(name => name.trim()).filter(Boolean);
    const result = knownResult(round.result);
    if (!names.length || !result) return;
    const map = mapByMatch.get(round.matchId);
    strats.forEach(strat => {
      if (!names.some(name => sameText(name, strat.name)) || (map && !sameText(map, strat.map))) return;
      records[strat.id].taggedRounds += 1;
      if (result === 'win') records[strat.id].taggedWins += 1;
    });
  });
  return records;
}
