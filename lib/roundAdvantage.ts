export type AdvantageOutcome = 'converted' | 'lost' | 'unknown';
export type AdvantageSource = 'replay' | 'screenshot' | 'vod';

export interface RoundAdvantageState {
  oursAlive: number;
  theirsAlive: number;
  label: string;
  differential: number;
  afterEvent: number;
  outcome: AdvantageOutcome;
}

export interface RoundAdvantageEvidence {
  schemaVersion: 1;
  source: AdvantageSource;
  status: 'complete' | 'partial' | 'unsupported';
  startingPlayers: { ours: number; theirs: number };
  highestDifferential: number | null;
  roundOutcome: AdvantageOutcome;
  states: RoundAdvantageState[];
  reason: string | null;
}

type Elimination = { sequence?: number | null; victimTeam?: string | null };

const normalizedOutcome = (winner: unknown, oursAlive: number, theirsAlive: number): AdvantageOutcome => {
  const value = String(winner || '').trim().toLocaleLowerCase('en');
  if (['ours', 'our', 'win', 'w'].includes(value)) return 'converted';
  if (['theirs', 'their', 'loss', 'lost', 'l'].includes(value)) return 'lost';
  if (theirsAlive === 0 && oursAlive > 0) return 'converted';
  if (oursAlive === 0 && theirsAlive > 0) return 'lost';
  return 'unknown';
};

/**
 * Derive exact man-advantage states from a complete ordered elimination feed.
 * Every exact state is counted at most once per round: a 5v3 and later 3v1 are
 * distinct coaching situations, while a persistent 3v1 is not double-counted.
 */
export function deriveRoundAdvantage(input: {
  events: readonly Elimination[];
  source: AdvantageSource;
  complete: boolean;
  winner?: 'ours' | 'theirs' | 'unknown' | 'W' | 'L' | null;
  startingPlayers?: { ours: number; theirs: number };
}): RoundAdvantageEvidence {
  const startingPlayers = input.startingPlayers || { ours: 5, theirs: 5 };
  if (!input.complete) return { schemaVersion: 1, source: input.source, status: input.events.length ? 'partial' : 'unsupported', startingPlayers, highestDifferential: null, roundOutcome: 'unknown', states: [], reason: input.events.length ? 'Elimination order is incomplete.' : 'No elimination evidence.' };
  const events = [...input.events].sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0));
  if (!events.length || events.some((event, index) => event.sequence !== undefined && event.sequence !== null && event.sequence !== index + 1) || events.some(event => event.victimTeam !== 'ours' && event.victimTeam !== 'theirs')) return { schemaVersion: 1, source: input.source, status: 'partial', startingPlayers, highestDifferential: null, roundOutcome: 'unknown', states: [], reason: 'Elimination identities or sequence are incomplete.' };
  let oursAlive = startingPlayers.ours; let theirsAlive = startingPlayers.theirs;
  const snapshots: Array<Omit<RoundAdvantageState, 'outcome'>> = [];
  const seen = new Set<string>();
  events.forEach((event, index) => {
    if (event.victimTeam === 'ours') oursAlive = Math.max(0, oursAlive - 1);
    else theirsAlive = Math.max(0, theirsAlive - 1);
    if (oursAlive > theirsAlive && theirsAlive > 0) {
      const label = `${oursAlive}v${theirsAlive}`;
      if (!seen.has(label)) { seen.add(label); snapshots.push({ oursAlive, theirsAlive, label, differential: oursAlive - theirsAlive, afterEvent: index + 1 }); }
    }
  });
  const outcome = normalizedOutcome(input.winner, oursAlive, theirsAlive);
  const states = snapshots.map(state => ({ ...state, outcome }));
  return { schemaVersion: 1, source: input.source, status: 'complete', startingPlayers, highestDifferential: states.length ? Math.max(...states.map(state => state.differential)) : 0, roundOutcome: outcome, states, reason: outcome === 'unknown' && states.length ? 'Round winner is not proven.' : null };
}

export interface AdvantageSummaryRow {
  label: string;
  opportunities: number;
  converted: number;
  lost: number;
  unknown: number;
  conversionRate: number | null;
}

export function summarizeRoundAdvantages(rounds: readonly { advantageEvidence?: RoundAdvantageEvidence }[]): AdvantageSummaryRow[] {
  const grouped = new Map<string, AdvantageSummaryRow>();
  for (const round of rounds) for (const state of round.advantageEvidence?.states || []) {
    const row = grouped.get(state.label) || { label: state.label, opportunities: 0, converted: 0, lost: 0, unknown: 0, conversionRate: null };
    row.opportunities += 1; row[state.outcome] += 1; grouped.set(state.label, row);
  }
  return [...grouped.values()].map(row => ({ ...row, conversionRate: row.converted + row.lost ? Math.round(row.converted / (row.converted + row.lost) * 100) : null }))
    .sort((left, right) => Number(right.label.split('v')[0]) - Number(left.label.split('v')[0]) || Number(right.label.split('v')[1]) - Number(left.label.split('v')[1]));
}
