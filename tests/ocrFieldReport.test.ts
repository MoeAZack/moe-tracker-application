import { describe, expect, it } from 'vitest';
import { diffRuns, fieldReport, pairRows } from '../scripts/ocrFieldReport.mjs';
import { replayJoinedLabels } from '../scripts/replayJoinedLabels.mjs';

const session = (captureId: string, extra: Record<string, unknown> = {}) => ({
  captureId, resolution: '1920x1080', windowsScalePercent: 100, layout: 'custom', map: 'Ascent', score: [13, 9],
  players: [{ name: 'Player1', agent: 'Jett', kda: [20, 10, 5] }, { name: 'Player2', agent: 'Sova', kda: [15, 12, 8] }],
  ...extra,
});
const output = (players: unknown[], meta: Record<string, unknown> = { map: 'Ascent', ourScore: 13, theirScore: 9 }, rounds: unknown[] = []) => ({ meta, players, rounds });

describe('OCR per-field report', () => {
  it('separates wrong values (false accepts) from empty cells, per field', () => {
    const corpus = { sessions: [session('s1')] };
    const report = fieldReport(corpus, { s1: output([
      { extractedName: 'Player1', agent: 'Jett', kills: 20, deaths: 10, assists: 5 },
      { extractedName: 'Player2', agent: null, kills: 16, deaths: 12, assists: null },
    ]) });
    expect(report.fields.kills).toEqual({ labelled: 2, correct: 1, falseAccept: 1, abstained: 0, accuracy: 0.5, falseAcceptRate: 0.5, coverage: 1 });
    expect(report.fields.agent).toMatchObject({ labelled: 2, correct: 1, falseAccept: 0, abstained: 1, falseAcceptRate: 0 });
    expect(report.fields.assists).toMatchObject({ correct: 1, abstained: 1 });
    expect(report.fields.map).toMatchObject({ correct: 1, falseAccept: 0 });
    expect(report.falseAccepts).toEqual([{ captureId: 's1', field: 'kills', row: 1, read: 16, expected: 15 }]);
    expect(report.total).toMatchObject({ labelled: 13, correct: 10, falseAccept: 1, abstained: 2 });
  });

  it('finds each labelled player by name, whatever order the rows come in, and a misread name takes the row left over', () => {
    expect(pairRows([{ name: 'Player1' }, { name: 'Player2' }, { name: 'Player3' }], [{ extractedName: 'player 2' }, { extractedName: 'P1ayer3' }, { extractedName: 'PLAYER1' }])).toEqual([2, 0, 1]);
    const report = fieldReport({ sessions: [session('s1')] }, { s1: output([
      { extractedName: 'Plyer2', agent: 'Sova', kills: 15, deaths: 12, assists: 8 },
      { extractedName: 'Player1', agent: 'Jett', kills: 20, deaths: 10, assists: 5 },
    ]) });
    expect(report.fields.kills).toMatchObject({ correct: 2, falseAccept: 0 });
    expect(report.fields.name).toMatchObject({ correct: 1, falseAccept: 1 });
  });

  it('honours row labels: an acceptable empty cell is not counted as a miss, a wrong read still is', () => {
    const corpus = { sessions: [session('s1', { players: [] })], rowLabels: [
      { captureId: 's1', row: 0, field: 'agent', acceptable: [null, 'Jett'] },
      { captureId: 's1', row: 1, field: 'agent', acceptable: [null, 'Sova'] },
    ] };
    const report = fieldReport(corpus, { s1: output([{ agent: null }, { agent: 'Deadlock' }]) });
    expect(report.fields.agent).toMatchObject({ labelled: 2, correct: 0, abstained: 1, falseAccept: 1 });
  });

  it('reports each capture condition on its own, and lists sessions without output', () => {
    const corpus = { sessions: [session('s1'), session('s2', { resolution: '1600x900', windowsScalePercent: 150 }), session('s3')] };
    const good = output([{ extractedName: 'Player1', agent: 'Jett', kills: 20, deaths: 10, assists: 5 }, { extractedName: 'Player2', agent: 'Sova', kills: 15, deaths: 12, assists: 8 }]);
    const report = fieldReport(corpus, { s1: good, s2: output(good.players, { map: 'Bind', ourScore: 13, theirScore: 9 }) });
    expect(report.missing).toEqual(['s3']);
    expect(report.byCondition['1920x1080 · 100% · custom'].map).toMatchObject({ correct: 1 });
    expect(report.byCondition['1600x900 · 150% · custom'].map).toMatchObject({ falseAccept: 1, falseAcceptRate: 1 });
  });

  it('grades round results when the labels have them', () => {
    const report = fieldReport({ sessions: [session('s1', { players: [], rounds: [{ roundNo: 1, result: 'W' }, { roundNo: 2, result: 'L' }, { roundNo: 3, result: 'W' }] })] }, { s1: output([], undefined, [{ roundNo: 1, result: 'W' }, { roundNo: 2, result: 'W' }]) });
    expect(report.fields.roundResult).toMatchObject({ labelled: 3, correct: 1, falseAccept: 1, abstained: 1 });
  });
});

describe('baseline vs candidate cell diff', () => {
  const base = { s1: output([{ extractedName: 'Player1', kills: 20, agent: 'Jett', rosterMatch: { status: 'matched' } }], undefined, [{ roundNo: 1, result: 'W', winBy: 'Elimination' }]) };
  it('is empty for identical runs and ignores nested objects', () => {
    expect(diffRuns(base, structuredClone(base))).toEqual([]);
  });
  it('names every changed, added or missing cell and session', () => {
    const candidate = structuredClone(base) as any;
    candidate.s1.players[0].kills = 21; candidate.s1.players[0].fd = 1; candidate.s1.rounds[0].result = 'L'; candidate.s2 = output([]);
    expect(diffRuns(base, candidate)).toEqual([
      { captureId: 's1', cell: 'players.0.fd', baseline: null, candidate: 1 },
      { captureId: 's1', cell: 'players.0.kills', baseline: 20, candidate: 21 },
      { captureId: 's1', cell: 'rounds.1.result', baseline: 'W', candidate: 'L' },
      { captureId: 's2', cell: '*', baseline: 'missing', candidate: 'present' },
    ]);
  });
});

describe('replay-joined labels', () => {
  const sha = 'a'.repeat(64);
  const replayRow = { sourceMetadata: { method: 'provider-import', provider: 'vrfkit', externalId: sha } };
  const db = {
    matches: [
      { id: 'm1', map: 'Ascent', ourScore: 13, theirScore: 11, screenshotEvidence: { captureId: 'Scrim-1', diagnostics: { resolution: '1600x900', layout: 'custom' } } },
      { id: 'm2', screenshotEvidence: { captureId: 'Scrim-2' } },
      { id: 'm3', map: 'Bind' },
    ],
    engineAdapters: { replay: { m1: { status: 'accepted', provenance: { replaySha256: sha } }, m3: { status: 'accepted', provenance: { replaySha256: sha } } } },
    playerStats: [
      { matchId: 'm1', agent: 'Jett', kills: 20, deaths: 10, assists: 5, ...replayRow },
      { matchId: 'm1', agent: 'Unknown', kills: 15, deaths: 12, assists: 8, ...replayRow },
      { matchId: 'm1', agent: 'Sova', kills: 3, deaths: 3, assists: 3, sourceMetadata: { method: 'screenshot' } },
    ],
    rounds: [{ matchId: 'm1', roundNo: 2, result: 'L', ...replayRow }, { matchId: 'm1', roundNo: 1, result: 'W', ...replayRow }, { matchId: 'm1', roundNo: 3, result: 'W', sourceMetadata: { method: 'screenshot' } }],
  };

  it('labels each captured match that has an accepted replay, from the replay rows only', () => {
    const labels = replayJoinedLabels(db);
    expect(labels.sessions).toEqual([{ captureId: 'Scrim-1', labelStatus: 'replay-joined', matchId: 'm1', resolution: '1600x900', layout: 'custom', windowsScalePercent: 'unknown', map: 'Ascent', score: [13, 11], roundCount: 24,
      players: [{ agent: 'Jett', kda: [20, 10, 5] }, { kda: [15, 12, 8] }], rounds: [{ roundNo: 1, result: 'W' }, { roundNo: 2, result: 'L' }] }]);
    expect(labels.skipped).toEqual([{ captureId: 'Scrim-2', reason: 'no-accepted-replay' }]);
  });

  it('pairs a name-less label with the nearest K/D/A row, so a misread digit is graded wrong, not skipped', () => {
    const labels = replayJoinedLabels(db);
    const run = { 'Scrim-1': output([
      { extractedName: 'enemy', agent: 'Reyna', kills: 9, deaths: 18, assists: 2 },
      { extractedName: 'x', agent: 'Jett', kills: 21, deaths: 10, assists: 5 },
      { extractedName: 'y', agent: 'Omen', kills: 15, deaths: 12, assists: 8 },
    ], { map: 'Ascent', ourScore: 13, theirScore: 11 }, [{ roundNo: 1, result: 'W' }, { roundNo: 2, result: 'L' }]) };
    const report = fieldReport(labels, run);
    expect(report.unpairedPlayers).toEqual([]);
    expect(report.fields.kills).toMatchObject({ correct: 1, falseAccept: 1 });
    expect(report.fields.agent).toMatchObject({ labelled: 1, correct: 1 });
    expect(report.fields.roundResult).toMatchObject({ correct: 2 });
    expect(report.byCondition['1600x900 · unknown% · custom']).toBeDefined();
  });

  it('leaves a player unpaired rather than guessing between two equally close rows', () => {
    expect(pairRows([{ kda: [10, 10, 10] }], [{ kills: 11, deaths: 10, assists: 10 }, { kills: 9, deaths: 10, assists: 10 }])).toEqual([null]);
    expect(pairRows([{ kda: [10, 10, 10] }], [{ kills: 40, deaths: 0, assists: 0 }])).toEqual([null]);
  });
});
