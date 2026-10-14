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
    if (!playerStats.length) continue;
    const summary = { schemaVersion: 1, match, playerStats, updatedAt };
    const digest = crypto.createHash('sha256').update(canonical(summary)).digest('hex');
    latest.set(matchId, { ...item, id: `screenshot-summary:${matchId}:${digest}`, summary, createdAt: item.createdAt || updatedAt, attempts: 0, lastError: null });
  }
  state.outbox = [...other, ...latest.values()];
  return state;
}

module.exports = { canonical, refreshScreenshotOutboxFromData };
