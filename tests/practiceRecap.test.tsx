import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { linkPracticeSession } from '../lib/practiceSessionProgress';
import { buildPracticeRecap, recapJudgments, recapText, recapsToSend } from '../lib/practiceRecap';
import { buildReviewInbox } from '../lib/reviewInbox';
import PracticeSummary from '../src/components/PracticeSummary';
import ReviewInbox from '../src/components/ReviewInbox';

const scheduleId = '00000000-0000-4000-8000-000000000020';
const p1 = '00000000-0000-4000-8000-0000000000a1';
const p2 = '00000000-0000-4000-8000-0000000000a2';

const round = (matchId: string, roundNo: number, result: 'W' | 'L', extra: Record<string, unknown> = {}) => ({ id: `${matchId}-r${roundNo}`, matchId, roundNo, result, side: roundNo <= 12 ? 'Attack' : 'Defense', ...extra });

function fixture() {
  const db: any = {
    settings: { inactiveMaps: [], stats: { lowSample: 15 } },
    rosterPlayers: [{ id: p1, displayName: 'Player1', createdAt: '' }, { id: p2, displayName: 'Player2', createdAt: '' }],
    schedule: [{ id: scheduleId, date: '2026-10-20', primary: 'Scrim vs OpponentA', attendance: {} }],
    goals: [],
    matches: [
      { id: 'm1', date: '2026-10-20', opponent: 'OpponentA', map: 'Ascent', ourScore: 13, theirScore: 9, sourceMetadata: { method: 'manual', capturedAt: '2026-10-20T18:00:00Z' } },
      { id: 'm2', date: '2026-10-20', opponent: 'OpponentA', map: 'Bind', ourScore: 10, theirScore: 13, sourceMetadata: { method: 'manual', capturedAt: '2026-10-20T19:00:00Z' } },
    ],
    playerStats: [
      { id: 's1', matchId: 'm1', playerId: p1, player: 'Player1', agent: 'Jett', kills: 20, deaths: 12, assists: 4, acs: 260, fk: 5, fd: 2 },
      { id: 's2', matchId: 'm2', playerId: p1, player: 'Player1', agent: 'Jett', kills: 15, deaths: 17, assists: 3, acs: 210, fk: 3, fd: 4 },
    ],
    // Pistols: won 1, 13 on Ascent, 1 on Bind, lost 13 on Bind: 3 of 4.
    rounds: [round('m1', 1, 'W'), round('m1', 13, 'W'), round('m2', 1, 'W'), round('m2', 13, 'L')],
    practiceBlocks: [], coachingSignals: [], coachingActions: [],
    vodReviews: [
      { id: 'v1', matchId: 'm1', title: 'Ascent POV', vodUrl: '', notes: [
        { id: 'n2', seconds: 300, timeLabel: '5:00', text: 'Late rotate', name: 'Coach', role: 'coach', createdAt: '', roundNo: 6, replies: [] },
        { id: 'n1', seconds: 60, timeLabel: '1:00', text: '', name: 'Coach', role: 'coach', createdAt: '', roundNo: 2, drawing: { schema: 'moetracker.frame-drawing/v1', strokes: [] }, replies: [] },
      ] },
      { id: 'v2', matchId: 'other', title: 'Other match', vodUrl: '', notes: [{ id: 'n3', seconds: 1, timeLabel: '0:01', text: 'Not this practice', name: 'Coach', role: 'coach', createdAt: '', replies: [] }] },
    ],
  };
  const { block } = linkPracticeSession(db, { scheduleId, matchIds: ['m1', 'm2'] }, 'Coach', '2026-10-20T21:00:00Z');
  db.coachingSignals = [
    { id: 'sig-a', blockId: block.id, status: 'accepted', title: 'Full buys lost on Bind' },
    { id: 'sig-n', blockId: block.id, status: 'new', title: 'Untriaged finding' },
    { id: 'sig-x', blockId: 'other-block', status: 'accepted', title: 'Another practice' },
  ];
  const action = (id: string, extra: Record<string, unknown>) => ({ id, title: id, ownerIds: [], state: 'assigned', createdAt: '2026-10-20T21:00:00Z', sourceSignalId: '', ...extra });
  db.coachingActions = [
    action('Trade the entry', { ownerIds: [p1, p2], sourceRound: { matchId: 'm2', roundNo: 7, roundId: 'm2-r7', map: 'Bind', opponent: 'OpponentA', vodSeconds: null } }),
    action('Done already', { state: 'resolved', sourceSignalId: 'sig-a' }),
    action('Cancelled task', { state: 'cancelled', sourceSignalId: 'sig-a' }),
    action('Other practice task', { sourceRound: { matchId: 'zz', roundNo: 1, roundId: null, map: 'Lotus', opponent: 'OpponentB', vodSeconds: null } }),
  ];
  return { db, block };
}

describe('practice summary', () => {
  it('sums up the linked matches, findings, tasks and notes of one session only', () => {
    const { db, block } = fixture();
    const recap = buildPracticeRecap(db, scheduleId, '2026-10-20T22:00:00Z')!;
    expect(recap).toMatchObject({ scheduleId, blockId: block.id, title: 'Scrim vs OpponentA', date: '2026-10-20', headline: 'Split 1–1 against OpponentA on Ascent, Bind.', sharedAt: null });
    expect(recap.matches.map(match => [match.map, match.result, match.score])).toEqual([['Ascent', 'W', '13–9'], ['Bind', 'L', '10–13']]);
    expect(recap.wentWell).toContain('Pistols: won 3 of 4.');
    expect(recap.findings).toEqual(['Full buys lost on Bind']);
    expect(recap.findingsToTriage).toBe(1);
    expect(recap.tasks.map(task => [task.title, task.open, task.owners])).toEqual([['Trade the entry', true, ['Player1', 'Player2']], ['Done already', false, []]]);
    expect(recap.notes.map(note => [note.timeLabel, note.drawing])).toEqual([['1:00', true], ['5:00', false]]);
    expect(recap.players).toEqual([{ player: 'Player1', agents: ['Jett'], line: '35/29/7 · 235 ACS · 8 FK · 6 FD' }]);
  });

  it('copies a team-ready text with open tasks and without the staff notes', () => {
    const { db } = fixture();
    const text = recapText(buildPracticeRecap(db, scheduleId)!);
    expect(text).toContain('Practice summary · Scrim vs OpponentA · 2026-10-20');
    expect(text).toContain('• Bind vs OpponentA: L 10–13');
    expect(text).toContain('• Trade the entry (Player1, Player2) · round 7 on Bind');
    expect(text).not.toContain('Done already');
    expect(text).not.toContain('Late rotate');
  });

  it('is not offered before the session has an accepted match', () => {
    const { db } = fixture();
    expect(buildPracticeRecap({ ...db, schedule: [{ ...db.schedule[0], practiceBlockId: undefined }] }, scheduleId)).toBeNull();
    db.matches = db.matches.map((match: any) => ({ ...match, sourceMetadata: undefined }));
    expect(buildPracticeRecap(db, scheduleId)).toBeNull();
  });

  it('makes no claim from too few rounds', () => {
    const empty: any = { openings: { pistols: { ATT: { wins: 1, samples: 1 }, DEF: { wins: 1, samples: 1 } }, firstThree: { ATT: { wins: 3, samples: 3 }, DEF: { wins: 0, samples: 3 } }, firstKills: 4, firstDeaths: 0, recoveriesAfterFirstDeath: 0, firstDeathSamples: 2 }, advantages: { converted: 1, lost: 2 }, economy: { fullBuyLosses: 3, fullBuyRounds: 4, antiEcoLosses: 1, antiEcoRounds: 1, lowBuyWins: 1, lowBuyRounds: 3 } };
    expect(recapJudgments(empty, 15)).toEqual({ wentWell: [], workOn: [] });
    const busy = { ...empty, openings: { ...empty.openings, firstKills: 6, firstDeaths: 12, firstDeathSamples: 12 }, advantages: { converted: 4, lost: 6 }, economy: { ...empty.economy, fullBuyRounds: 10, fullBuyLosses: 6, antiEcoRounds: 3, antiEcoLosses: 2 } };
    expect(recapJudgments(busy, 15).workOn).toEqual(['Opening duels: 12 first deaths to 6 first kills.', 'After losing the first player: won 0 of 12.', 'Player advantages: closed out 4 of 10.', 'Full buys: lost 6 of 10.', 'Against their eco: lost 2 of 3.']);
  });

  it('shows in the inbox for a week until the coach sends it', () => {
    const { db } = fixture();
    const now = new Date('2026-10-22T10:00:00Z');
    expect(buildReviewInbox(db, {}, now).filter(item => item.kind === 'summary')).toEqual([expect.objectContaining({ id: `summary:${scheduleId}`, title: 'Practice summary ready · Scrim vs OpponentA', target: { surface: 'practice-summary', scheduleId } })]);
    expect(recapsToSend(db, new Date('2026-10-28T10:00:00Z'))).toHaveLength(0);
    db.schedule[0].summarySharedAt = '2026-10-21T10:00:00Z';
    expect(recapsToSend(db, now)).toHaveLength(0);
  });

  it('shows the summary with the staff-only notes marked, and keeps it out of the website inbox', () => {
    const { db } = fixture();
    const html = renderToStaticMarkup(<PracticeSummary data={db} scheduleId={scheduleId} onClose={() => {}} onRefresh={async () => {}} />).replace(/<!-- -->/g, '');
    expect(html).toContain('aria-labelledby="practice-summary-title"');
    expect(html).toContain('Pistols: won 3 of 4.');
    expect(html).toContain('VOD notes (staff only, not copied)');
    expect(html).toContain('Late rotate');
    expect(html).toContain('aria-label="has a drawing"');
    expect(html).toContain('Copy for the team');
    expect(html).toContain('Not sent yet');
    expect(html).toContain('1 finding from this practice still to accept or dismiss');
    vi.useFakeTimers({ now: new Date('2026-10-22T10:00:00Z') });
    try {
      expect(renderToStaticMarkup(<ReviewInbox data={db} desktopMode onOpen={() => {}} />)).toContain('Practice summary ready');
      expect(renderToStaticMarkup(<ReviewInbox data={db} desktopMode={false} onOpen={() => {}} />)).not.toContain('Practice summary ready');
    } finally { vi.useRealTimers(); }
  });
});
