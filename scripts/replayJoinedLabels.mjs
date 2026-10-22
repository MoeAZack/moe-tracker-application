// OCR labels for free: when a captured match also has an accepted replay,
// the replay's numbers are the truth the screenshots should have read. This
// turns every such match in a database into a label session for
// scripts/ocr-field-report.mjs, so accuracy is measured on all of them, not
// only the few that were labelled by hand.
//
// Labels hold the team's own match data, so they are written outside the
// repository and never committed.

const finite = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Scoreboard columns beyond K/D/A that a replay reports. */
export const REPLAY_STAT_FIELDS = ['fk', 'fd', 'plants', 'defuses'];

/**
 * First bloods, first deaths, plants and defuses as the replay itself read
 * them. A saved row falls back to the screenshot value where the replay had
 * none, so the row is not the source: the replay values recorded when it was
 * reconciled with the screenshot are.
 */
function replayStats(row) {
  const stats = {};
  for (const comparison of row?.evidenceReconciliation?.comparisons || []) {
    if (REPLAY_STAT_FIELDS.includes(comparison?.field) && finite(comparison.replay) !== null) stats[comparison.field] = comparison.replay;
  }
  return stats;
}

/** One label session per match that has both a capture session and an accepted replay. */
export function replayJoinedLabels(db) {
  const sessions = []; const skipped = [];
  const replays = db?.engineAdapters?.replay || {};
  for (const match of db?.matches || []) {
    const captureId = match?.screenshotEvidence?.captureId;
    if (!captureId) continue;
    const replay = replays[match.id];
    if (replay?.status !== 'accepted') { skipped.push({ captureId, reason: 'no-accepted-replay' }); continue; }
    if (match.duplicateReview?.status === 'quarantined') { skipped.push({ captureId, reason: 'quarantined' }); continue; }
    const provider = row => row?.sourceMetadata?.provider === 'vrfkit' && row?.sourceMetadata?.externalId === replay.provenance?.replaySha256;
    const players = (db.playerStats || []).filter(row => row.matchId === match.id && provider(row))
      .map(row => ({ agent: typeof row.agent === 'string' && row.agent && row.agent !== 'Unknown' ? row.agent : undefined, kda: [finite(row.kills), finite(row.deaths), finite(row.assists)], stats: replayStats(row) }))
      .filter(player => player.kda.every(value => value !== null))
      .map(({ agent, kda, stats }) => ({ ...(agent ? { agent } : {}), kda, ...(Object.keys(stats).length ? { stats } : {}) }));
    const rounds = (db.rounds || []).filter(round => round.matchId === match.id && provider(round) && (round.result === 'W' || round.result === 'L'))
      .sort((a, b) => a.roundNo - b.roundNo).map(round => ({ roundNo: round.roundNo, result: round.result }));
    const score = [finite(match.ourScore), finite(match.theirScore)];
    const diagnostics = match.screenshotEvidence.diagnostics || {};
    if (!players.length && !rounds.length) { skipped.push({ captureId, reason: 'replay-has-no-rows' }); continue; }
    sessions.push({
      captureId, labelStatus: 'replay-joined', matchId: match.id,
      resolution: typeof diagnostics.resolution === 'string' ? diagnostics.resolution : 'unknown',
      layout: typeof diagnostics.layout === 'string' ? diagnostics.layout : 'unknown',
      windowsScalePercent: 'unknown',
      ...(typeof match.map === 'string' && match.map ? { map: match.map } : {}),
      ...(score.every(value => value !== null) ? { score, roundCount: score[0] + score[1] } : {}),
      players, rounds,
    });
  }
  return { schemaVersion: 2, source: 'replay-joined', sessions, rowLabels: [], skipped };
}
