const crypto = require('node:crypto');

function canonical(value) {
  return JSON.stringify(value, (_key, nested) => nested && typeof nested === 'object' && !Array.isArray(nested)
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
    : nested);
}

function refreshScreenshotOutboxFromData(state, data, updatedAt = new Date().toISOString()) {
  const matches = new Map((data?.matches || []).map(match => [String(match.id), match]));
  const latest = new Map();
  const other = [];
  for (const item of state.outbox || []) {
    if (item?.kind !== 'screenshot-summary') { other.push(item); continue; }
    const matchId = String(item.matchId || '');
    const match = matches.get(matchId);
    if (!match) continue;
    const playerStats = (data?.playerStats || []).filter(stat => stat.matchId === matchId && stat.screenshotMetrics);
    if (!playerStats.length && match?.screenshotEvidence?.scoreboardPlayers?.length !== 10) continue;
    const summary = { schemaVersion: 1, match, playerStats, updatedAt: match.sourceMetadata?.capturedAt || item.summary?.updatedAt || updatedAt };
    const digest = crypto.createHash('sha256').update(canonical(summary)).digest('hex');
    latest.set(matchId, { ...item, id: `screenshot-summary:${matchId}:${digest}`, summary, createdAt: item.createdAt || updatedAt, attempts: 0, lastError: null });
  }
  // Full one-button captures are accepted matches already. Queue their
  // sanitized ten-player scoreboard even when no per-player screenshot metric
  // was materialized, so replay evidence can find and enrich the same match.
  for (const [matchId, match] of matches) {
    if (match?.screenshotEvidence?.scoreboardPlayers?.length !== 10 || latest.has(matchId)) continue;
    const playerStats = (data?.playerStats || []).filter(stat => stat.matchId === matchId && stat.screenshotMetrics);
    const summary = { schemaVersion: 1, match, playerStats, updatedAt: match.sourceMetadata?.capturedAt || updatedAt };
    const digest = crypto.createHash('sha256').update(canonical(summary)).digest('hex');
    const id = `screenshot-summary:${matchId}:${digest}`;
    if (!(state.completed || []).includes(id)) latest.set(matchId, { id, kind: 'screenshot-summary', matchId, summary, createdAt: summary.updatedAt, attempts: 0, lastError: null });
  }
  const latestReplayEvidence = new Map();
  const remaining = [];
  for (const item of other) {
    if (item?.kind !== 'replay-evidence' || !item?.sha256) { remaining.push(item); continue; }
    const prior = latestReplayEvidence.get(item.sha256);
    if (!prior || Date.parse(item.createdAt || '') >= Date.parse(prior.createdAt || '')) latestReplayEvidence.set(item.sha256, item);
  }
  state.outbox = [...remaining, ...latestReplayEvidence.values(), ...latest.values()];
  return state;
}

module.exports = { canonical, refreshScreenshotOutboxFromData };
