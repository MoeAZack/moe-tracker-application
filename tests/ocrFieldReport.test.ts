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
  it('is empty for identical runs', () => {
    expect(diffRuns(base, structuredClone(base))).toEqual([]);
  });
  it('names every changed, added or missing cell and session', () => {
    const candidate = structuredClone(base) as any;
    candidate.s1.players[0].kills = 21; candidate.s1.players[0].fd = 1; candidate.s1.rounds[0].result = 'L'; candidate.s2 = output([]);
    expect(diffRuns(base, candidate)).toEqual([
      { captureId: 's1', cell: 'players.0.fd', baseline: null, candidate: 1 },
      { captureId: 's1', cell: 'players.0.kills', baseline: 20, candidate: 21 },
      { captureId: 's1', cell: 'rounds.0.result', baseline: 'W', candidate: 'L' },
      { captureId: 's2', cell: '*', baseline: 'missing', candidate: 'present' },
    ]);
  });
});

describe('the cell diff covers every part of a run', () => {
  const full = () => ({
    folder: 'Scrim-1', seconds: 40,
    meta: { map: 'Ascent', ourScore: 13, theirScore: 9 }, startingSide: 'Attack',
    draft: { sourceMetadata: { model: 'local-v1', capturedAt: '2026-10-22T10:00:00Z' }, match: { map: 'Ascent' } },
    players: [{ extractedName: 'Player1', kills: 20, rosterMatch: { status: 'matched', score: 0.9 } }],
    rounds: [{ roundNo: 1, result: 'W', winBy: 'Elimination', extractionIssues: ['kill-feed-partial'], screenshotEvidence: {
      reviewStatus: 'confirmed', confidence: 'high', events: [{ killer: 'Player1', victim: 'OpponentA', weapon: 'Vandal' }], objectives: [{ kind: 'plant', player: 'Player1' }],
      players: [{ displayName: 'Player1', credits: 3900, weapon: 'Vandal' }] } }],
    performance: { rows: [{ player: 'Player1', damage: 3200 }] },
    headToHead: { totals: { kills: 20, deaths: 10, assists: 5 } },
    captureDiagnostics: { resolution: '1920x1080', issues: ['round-captures-incomplete'] },
  });
  const changeOne = (path: string, value: unknown) => {
    const run: any = full(); const keys = path.split('.'); let node = run;
    for (const key of keys.slice(0, -1)) node = node[key];
    node[keys.at(-1)!] = value;
    return diffRuns({ s: full() }, { s: run }).map((diff: any) => diff.cell);
  };
  it.each([
    ['startingSide', 'Defense'],
    ['draft.match.map', 'Bind'],
    ['players.0.rosterMatch.status', 'unmatched'],
    ['rounds.0.extractionIssues.0', 'kill-feed-missing'],
    ['rounds.0.screenshotEvidence.reviewStatus', 'review-required'],
    ['rounds.0.screenshotEvidence.events.0.weapon', 'Phantom'],
    ['rounds.0.screenshotEvidence.objectives.0.player', 'Player2'],
    ['rounds.0.screenshotEvidence.players.0.credits', 4100],
    ['performance.rows.0.damage', 3100],
    ['headToHead.totals.assists', 6],
    ['captureDiagnostics.issues.0', 'round-count-score-mismatch'],
  ])('finds a single change in %s', (path, value) => {
    expect(changeOne(path, value)).toEqual([path]);
  });
  it('counts an extra or missing row as a change', () => {
    const run: any = full(); run.rounds[0].screenshotEvidence.events.push({ killer: 'OpponentA', victim: 'Player1', weapon: 'Operator' });
    expect(diffRuns({ s: full() }, { s: run }).map((diff: any) => diff.cell)).toEqual(expect.arrayContaining(['rounds.0.screenshotEvidence.events.length', 'rounds.0.screenshotEvidence.events.1.killer']));
  });
  it('ignores only the run folder, its duration and read timestamps', () => {
    const run: any = full(); run.folder = 'other'; run.seconds = 99; run.draft.sourceMetadata.capturedAt = '2026-10-23T00:00:00Z';
    expect(diffRuns({ s: full() }, { s: run })).toEqual([]);
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

describe('ocr-field-report command', () => {
  it('exits 1 when a single cell differs from the baseline, and 0 when none do', async () => {
    const { execFileSync, spawnSync } = await import('node:child_process');
    const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-report-'));
    try {
      const run = { meta: { map: 'Ascent', ourScore: 13, theirScore: 9 }, players: [{ extractedName: 'Player1', kills: 20, deaths: 10, assists: 5 }], rounds: [] };
      for (const name of ['base', 'same', 'changed']) await fs.mkdir(path.join(dir, name));
      await fs.writeFile(path.join(dir, 'base', 'Scrim-1.json'), JSON.stringify(run));
      await fs.writeFile(path.join(dir, 'same', 'Scrim-1.json'), JSON.stringify(run));
      await fs.writeFile(path.join(dir, 'changed', 'Scrim-1.json'), JSON.stringify({ ...run, players: [{ ...run.players[0], assists: 6 }] }));
      const labels = path.join(dir, 'labels.json'); await fs.writeFile(labels, JSON.stringify({ sessions: [] }));
      const script = path.resolve('scripts/ocr-field-report.mjs');
      expect(JSON.parse(execFileSync(process.execPath, [script, path.join(dir, 'same'), '--baseline', path.join(dir, 'base'), '--labels', labels], { encoding: 'utf8' })).baseline.cellDiffs).toBe(0);
      const changed = spawnSync(process.execPath, [script, path.join(dir, 'changed'), '--baseline', path.join(dir, 'base'), '--labels', labels], { encoding: 'utf8' });
      expect(changed.status).toBe(1);
      expect(JSON.parse(changed.stdout).baseline.diffs).toEqual([{ captureId: 'Scrim-1', cell: 'players.0.assists', baseline: 5, candidate: 6 }]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});
