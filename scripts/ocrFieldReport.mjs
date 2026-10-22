// Per-field OCR accuracy against labels, and cell-by-cell diffs between two
// backtest runs. Shared by scripts/ocr-field-report.mjs and its tests.
//
// A labelled cell ends up in exactly one bucket:
//   correct      the run read the labelled value
//   falseAccept  the run read a value, and it is wrong (the costly case: it
//                would be saved unless a coach catches it)
//   abstained    the run left the cell empty (a coach fills it in)
// falseAcceptRate = falseAccept / (correct + falseAccept): of the values the
// run was willing to give, how many were wrong. Accuracy alone hides this.

export const PLAYER_FIELDS = ['name', 'agent', 'kills', 'deaths', 'assists'];

const normalizeName = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const blank = value => value === null || value === undefined || value === '';
const same = (field, read, truth) => (field === 'name' || field === 'map' ? normalizeName(read) === normalizeName(truth) : read === truth);

/**
 * Which output row each labelled player is on. Labels list players in their
 * own order, so a player is found by name first; players whose name was
 * misread take the remaining rows in order.
 */
export function pairRows(labelledPlayers = [], outputPlayers = []) {
  const rows = labelledPlayers.map(player => (player.name === undefined ? -1 : outputPlayers.findIndex(row => normalizeName(row?.extractedName ?? row?.name) === normalizeName(player.name))));
  rows.forEach((row, index) => { if (row >= 0 && rows.indexOf(row) !== index) rows[index] = -1; });
  // Labels without a name (replay-joined labels know roster names, not in-game ones) pair with the
  // row nearest their K/D/A, so a misread digit still pairs and is graded as wrong rather than skipped.
  // A tie leaves the player unpaired: grading a guessed row would invent errors.
  const distance = (row, kda) => ['kills', 'deaths', 'assists'].reduce((sum, field, index) => sum + (typeof row?.[field] === 'number' ? Math.abs(row[field] - kda[index]) : 50), 0);
  labelledPlayers.forEach((player, index) => {
    if (rows[index] >= 0 || player.name !== undefined || !Array.isArray(player.kda)) return;
    const ranked = outputPlayers.map((row, outputRow) => ({ outputRow, score: distance(row, player.kda) + (player.agent && row?.agent && row.agent !== player.agent ? 25 : 0) }))
      .filter(({ outputRow }) => !rows.includes(outputRow)).sort((a, b) => a.score - b.score);
    if (ranked.length && ranked[0].score < 30 && (ranked.length === 1 || ranked[1].score > ranked[0].score)) rows[index] = ranked[0].outputRow;
  });
  const free = outputPlayers.map((_, index) => index).filter(index => !rows.includes(index));
  return rows.map((row, index) => (row >= 0 ? row : labelledPlayers[index].name === undefined ? null : free.shift() ?? null));
}

/** The labelled cells of one session. `row` is the output row; row labels already name output rows. */
export function labelledCells(session, rowLabels = [], output = null) {
  const cells = [];
  if (session.map) cells.push({ field: 'map', row: null, truth: session.map });
  if (Array.isArray(session.score)) { cells.push({ field: 'ourScore', row: null, truth: session.score[0] }); cells.push({ field: 'theirScore', row: null, truth: session.score[1] }); }
  const paired = pairRows(session.players, output?.players || []);
  (session.players || []).forEach((player, index) => {
    const row = paired[index];
    if (player.name !== undefined) cells.push({ field: 'name', row, truth: player.name });
    if (player.agent !== undefined) cells.push({ field: 'agent', row, truth: player.agent });
    if (Array.isArray(player.kda)) ['kills', 'deaths', 'assists'].forEach((field, index) => cells.push({ field, row, truth: player.kda[index] }));
  });
  (session.rounds || []).forEach(round => cells.push({ field: 'roundResult', row: round.roundNo, truth: round.result }));
  // A row label overrides the session label for that cell with an explicit acceptable set (null = abstaining is fine).
  for (const label of rowLabels.filter(item => item.captureId === session.captureId)) {
    const existing = cells.findIndex(cell => cell.field === label.field && cell.row === label.row);
    const cell = { field: label.field, row: label.row, acceptable: label.acceptable };
    if (existing >= 0) cells[existing] = cell; else cells.push(cell);
  }
  return cells;
}

/** The value a backtest output gives for a cell. */
export function readCell(output, field, row) {
  if (!output) return undefined;
  if (field === 'map') return output.meta?.map ?? null;
  if (field === 'ourScore' || field === 'theirScore') return output.meta?.[field] ?? null;
  if (field === 'roundResult') return (output.rounds || []).find(round => round.roundNo === row)?.result || null;
  if (row === null) return null;
  const player = output.players?.[row];
  if (!player) return null;
  return field === 'name' ? player.extractedName ?? player.name ?? null : player[field] ?? null;
}

export function grade(cell, read) {
  if (cell.acceptable) {
    if (blank(read)) return cell.acceptable.includes(null) ? 'abstained' : 'abstainedWrong';
    return cell.acceptable.some(value => value !== null && same(cell.field, read, value)) ? 'correct' : 'falseAccept';
  }
  if (blank(read)) return 'abstained';
  return same(cell.field, read, cell.truth) ? 'correct' : 'falseAccept';
}

const emptyTally = () => ({ labelled: 0, correct: 0, falseAccept: 0, abstained: 0 });
function finish(tally) {
  const accepted = tally.correct + tally.falseAccept;
  return { ...tally, accuracy: tally.labelled ? round(tally.correct / tally.labelled) : null, falseAcceptRate: accepted ? round(tally.falseAccept / accepted) : null, coverage: tally.labelled ? round(accepted / tally.labelled) : null };
}
const round = value => Math.round(value * 10_000) / 10_000;

/**
 * Per-field accuracy for every labelled session that has an output, overall
 * and per capture condition (resolution, Windows scale, layout), so a gap at
 * 1600×900 or 150 % shows instead of disappearing into the average.
 */
export function fieldReport(corpus, outputs) {
  const fields = {}; const byCondition = {}; const wrong = []; const missing = []; const unpaired = [];
  for (const session of corpus.sessions || []) {
    const output = outputs[session.captureId];
    if (!output) { missing.push(session.captureId); continue; }
    const condition = `${session.resolution} · ${session.windowsScalePercent}% · ${session.layout}`;
    pairRows(session.players, output.players || []).forEach((row, index) => { if (row === null) unpaired.push({ captureId: session.captureId, player: index }); });
    for (const cell of labelledCells(session, corpus.rowLabels, output)) {
      const read = readCell(output, cell.field, cell.row);
      let outcome = grade(cell, read);
      if (outcome === 'abstainedWrong') outcome = 'abstained';
      for (const bucket of [(fields[cell.field] ||= emptyTally()), ((byCondition[condition] ||= {})[cell.field] ||= emptyTally())]) { bucket.labelled += 1; bucket[outcome] += 1; }
      if (outcome === 'falseAccept') wrong.push({ captureId: session.captureId, field: cell.field, row: cell.row, read, expected: cell.acceptable ?? cell.truth });
    }
  }
  const total = Object.values(fields).reduce((sum, tally) => ({ labelled: sum.labelled + tally.labelled, correct: sum.correct + tally.correct, falseAccept: sum.falseAccept + tally.falseAccept, abstained: sum.abstained + tally.abstained }), emptyTally());
  return {
    sessions: (corpus.sessions || []).length - missing.length, missing,
    // Labelled players no output row could be paired with; their cells count as abstained.
    unpairedPlayers: unpaired,
    total: finish(total),
    fields: Object.fromEntries(Object.entries(fields).map(([field, tally]) => [field, finish(tally)])),
    byCondition: Object.fromEntries(Object.entries(byCondition).map(([condition, tallies]) => [condition, Object.fromEntries(Object.entries(tallies).map(([field, tally]) => [field, finish(tally)]))])),
    falseAccepts: wrong,
  };
}

/** Keys that change between two runs of the same code on the same images: the run's own bookkeeping and read timestamps. */
export const VOLATILE_TOP_LEVEL_KEYS = new Set(['folder', 'seconds']);
export const VOLATILE_KEYS = new Set(['capturedAt']);

/**
 * Every scalar leaf a run reports, keyed by its path (meta.map, players.3.kills,
 * rounds.4.screenshotEvidence.events.0.killer, performance…, headToHead…,
 * captureDiagnostics.issues.2, …), so two runs line up cell by cell. Array
 * lengths are cells too, so a missing or extra row is a diff. Only the
 * volatile keys above are left out.
 */
export function outputCells(output) {
  const cells = {};
  const walk = (value, path) => {
    if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) { cells[path] = value ?? null; return; }
    if (Array.isArray(value)) { cells[`${path}.length`] = value.length; value.forEach((item, index) => walk(item, `${path}.${index}`)); return; }
    if (typeof value === 'object') {
      const keys = Object.keys(value).filter(key => !VOLATILE_KEYS.has(key) && !(path === '' && VOLATILE_TOP_LEVEL_KEYS.has(key)));
      if (!keys.length) cells[path || '.'] = '{}';
      for (const key of keys) walk(value[key], path ? `${path}.${key}` : key);
    }
  };
  walk(output, '');
  return cells;
}

/** Cell-by-cell differences between a baseline run and a candidate run. Zero is the bar for an OCR change that claims no regressions. */
export function diffRuns(baseline, candidate) {
  const diffs = [];
  for (const captureId of [...new Set([...Object.keys(baseline), ...Object.keys(candidate)])].sort()) {
    if (!baseline[captureId] || !candidate[captureId]) { diffs.push({ captureId, cell: '*', baseline: baseline[captureId] ? 'present' : 'missing', candidate: candidate[captureId] ? 'present' : 'missing' }); continue; }
    const before = outputCells(baseline[captureId]); const after = outputCells(candidate[captureId]);
    for (const cell of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      if (!Object.is(before[cell] ?? null, after[cell] ?? null)) diffs.push({ captureId, cell, baseline: before[cell] ?? null, candidate: after[cell] ?? null });
    }
  }
  return diffs;
}
