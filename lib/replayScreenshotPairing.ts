import crypto from 'crypto';
import type { ScreenshotReviewDraft } from '../src/types';

export type ScreenshotPairing = {
  id: string; deviceId: string; imageSha256: string; createdAt: string; createdBy: string;
  status: 'pending' | 'linked' | 'ambiguous' | 'incomplete'; reviewRequired: true;
  draft: ScreenshotReviewDraft; replaySha256: string | null;
  suggestions: Array<{ parserPlayerId: string; displayName: string; rosterPlayerId: string | null; screenshotTeam: 'ours' | 'theirs' }>;
  reason: string;
  autoProcessedAt?: string;
  automaticMatchId?: string;
  targetMatchId?: string;
};
export const SCREENSHOT_LIMIT = 100;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const reject = (message: string, status = 400) => Object.assign(new Error(message), { status });

export function validatePairingImage(body: any) {
  if (typeof body?.deviceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(body.deviceId)) throw reject('Choose a collection device.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(body.mediaType)) throw reject('Use a PNG, JPEG, or WebP scoreboard.');
  if (typeof body.base64 !== 'string' || body.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw reject('Screenshot encoding or size is invalid.');
  const bytes = Buffer.from(body.base64, 'base64');
  if (bytes.toString('base64') !== body.base64) throw reject('Screenshot encoding is invalid.');
  const valid = body.mediaType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : body.mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid || !bytes.length || bytes.length > MAX_IMAGE_BYTES) throw reject('Screenshot content does not match its image type or size limit.');
  return { deviceId: body.deviceId as string, base64: body.base64 as string, mediaType: body.mediaType as string, imageSha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

export function screenshotRecordId(deviceId: string, hash: string) { return crypto.createHash('sha256').update(`${deviceId}\0${hash}`).digest('hex'); }
export function pruneScreenshotPairings(store: any, now = Date.now()) {
  store.screenshots ||= {};
  for (const [id, record] of Object.entries(store.screenshots) as Array<[string, ScreenshotPairing]>) {
    if (!Number.isFinite(Date.parse(record.createdAt)) || now - Date.parse(record.createdAt) > RETENTION_MS) delete store.screenshots[id];
  }
}
export function screenshotAdmission(store: any, deviceId: string, actorId: string, now = Date.now()) {
  const records = Object.values(store.screenshots || {}) as ScreenshotPairing[];
  if (records.length >= SCREENSHOT_LIMIT || records.filter(record => (record.deviceId === deviceId || record.createdBy === actorId) && now - Date.parse(record.createdAt) < 24 * 60 * 60 * 1000).length >= 20) throw reject('Screenshot review capacity reached. Try again after retained requests expire.', 429);
}
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const field = (value: any) => value?.status === 'available' ? value.value : null;
const mapName = (value: unknown) => typeof value === 'string' ? value.trim().replace(/^map\s*[-:]\s*/i, '').trim().toLowerCase() : '';
function tuple(row: any) { return [row.kills, row.deaths, row.assists].every(integer) ? `${row.kills}/${row.deaths}/${row.assists}` : null; }
function safeSuggestions(rows: ScreenshotPairing['suggestions']) {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.rosterPlayerId) counts.set(row.rosterPlayerId, (counts.get(row.rosterPlayerId) || 0) + 1);
  return rows.map(row => row.rosterPlayerId && counts.get(row.rosterPlayerId)! > 1 ? { ...row, rosterPlayerId: null } : row);
}

function replayLine(row: any) {
  return { id: row.playerId, teamId: row.teamId, kills: field(row.kills), deaths: field(row.deaths), assists: field(row.assists), agent: field(row.agent) };
}

/**
 * Find one and only one evidence-preserving scoreboard assignment. Missing OCR
 * digits are allowed only when the remaining K/D/A and portrait constraints
 * still produce a unique perfect match; position is never used as evidence.
 */
function uniqueScoreboardAssignment(stats: any[], replayRows: any[]) {
  if (stats.length !== 10 || replayRows.length !== 10) return null;
  const compatible = (stat: any, replay: any) => {
    const knownNumbers = ['kills', 'deaths', 'assists'].filter(key => integer(stat[key]));
    const agent = typeof stat.agent === 'string' && stat.agent.trim() ? stat.agent.trim().toLowerCase() : null;
    if (knownNumbers.length < 2 && !agent) return false;
    if (knownNumbers.some(key => stat[key] !== replay[key])) return false;
    const numericCandidates = replayRows.filter(candidate => knownNumbers.every(key => stat[key] === candidate[key])).length;
    const agentMustDisambiguate = knownNumbers.length < 3 || numericCandidates > 1;
    return !agentMustDisambiguate || !agent || typeof replay.agent !== 'string' || !replay.agent.trim() || replay.agent.trim().toLowerCase() === agent;
  };
  const choices = stats.map((stat, statIndex) => ({ statIndex, rows: replayRows.map((row, replayIndex) => compatible(stat, row) ? replayIndex : -1).filter(index => index >= 0) }))
    .sort((left, right) => left.rows.length - right.rows.length || left.statIndex - right.statIndex);
  if (choices.some(choice => choice.rows.length === 0)) return null;
  const used = new Set<number>(); const current = new Map<number, number>(); let solution: Map<number, number> | null = null; let count = 0;
  const visit = (position: number) => {
    if (count > 1) return;
    if (position === choices.length) { count += 1; if (count === 1) solution = new Map(current); return; }
    const choice = choices[position];
    for (const replayIndex of choice.rows) {
      if (used.has(replayIndex)) continue;
      used.add(replayIndex); current.set(choice.statIndex, replayIndex); visit(position + 1); current.delete(choice.statIndex); used.delete(replayIndex);
    }
  };
  visit(0);
  return count === 1 ? solution : null;
}

/** Recompute suggestions separately from immutable parser evidence and accepted coach overlays. */
export function pairReplayScreenshots(store: any) {
  const records = Object.values(store.screenshots || {}) as ScreenshotPairing[];
  for (const record of records) {
    if (record.deviceId === 'manual-entry') { record.replaySha256 = null; record.suggestions = []; record.status = 'pending'; record.reason = 'Screenshot ready. Complete the match manually when convenient.'; continue; }
    record.replaySha256 = null; record.suggestions = []; record.status = 'pending'; record.reason = 'Waiting for one matching replay from the selected device.';
    const { match, stats } = record.draft;
    const hasMap = !!mapName(match.map); const hasScore = integer(match.ourScore) && integer(match.theirScore);
    const partialScore = integer(match.ourScore) !== integer(match.theirScore);
    if (partialScore || stats.length !== 10 || stats.some(row => !row.extractedName.trim() || row.extractedName.length > 80)) {
      record.status = 'incomplete'; record.reason = 'All ten named scoreboard rows are required. Map and final score may come from the replay.'; continue;
    }
    const completeKeys = stats.map(tuple);
    if (completeKeys.every(Boolean) && new Set(completeKeys).size !== 10) {
      const agentKeys = stats.map((row, index) => `${completeKeys[index]}|${typeof row.agent === 'string' ? row.agent.trim().toLowerCase() : ''}`);
      if (agentKeys.some(key => key.endsWith('|')) || new Set(agentKeys).size !== 10) { record.status = 'ambiguous'; record.reason = 'Duplicate K/D/A rows prevent a unique name mapping.'; continue; }
    }
    const scores = hasScore ? [match.ourScore, match.theirScore].sort((a, b) => a! - b!).join(':') : null;
    const associated = new Set<string>(Object.values(store.associations || {}).filter((a: any) => a.deviceId === record.deviceId).map((a: any) => a.sha256));
    const candidates: Array<{ sha256: string; suggestions: ScreenshotPairing['suggestions']; metadataMatches: number }> = [];
    for (const sha256 of associated) {
      const blob = store.blobs?.[sha256]; const job = blob?.parserJobId ? store.parserJobs?.[blob.parserJobId] : null;
      if (blob?.ingestionMode !== 'local-evidence' || job?.status !== 'completed' || !job.sourceDeviceIds?.includes(record.deviceId)) continue;
      const board = job.result?.scoreboard;
      if (!board || board.evidenceCoverage?.status !== 'complete') continue;
      const totals = [field(board.finalScore?.teamA?.score), field(board.finalScore?.teamB?.score)];
      if (!totals.every(integer) || board.players?.length !== 10) continue;
      const rows = board.players.map(replayLine);
      if (rows.some((row: any) => typeof row.id !== 'string' || !row.id) || new Set(rows.map((row: any) => row.id)).size !== 10) continue;
      const assignment = uniqueScoreboardAssignment(stats, rows);
      if (!assignment) continue;
      const replayMap = mapName(field(board.map));
      const replayScores = totals.sort((a, b) => a - b).join(':');
      const metadataMatches = Number(hasMap && !!replayMap && replayMap === mapName(match.map)) + Number(!!scores && replayScores === scores);
      candidates.push({ sha256, metadataMatches, suggestions: safeSuggestions(rows.map((row: any, replayIndex: number) => {
        const statIndex = [...assignment.entries()].find(([, assigned]) => assigned === replayIndex)?.[0];
        const stat = stats[statIndex!];
        const explicitTeam = (stat as any).screenshotTeam === 'ours' || (stat as any).screenshotTeam === 'theirs' ? (stat as any).screenshotTeam : null;
        return { parserPlayerId: row.id, displayName: stat.extractedName.trim(), rosterPlayerId: stat.rosterMatch?.status === 'matched' ? stat.matchedPlayerId : null, screenshotTeam: explicitTeam || (stat.rosterMatch?.status === 'matched' || statIndex! < 5 ? 'ours' : 'theirs') };
      })) });
    }
    const strongest = candidates.length > 1
      ? candidates.filter(candidate => candidate.metadataMatches === Math.max(...candidates.map(item => item.metadataMatches)))
      : candidates;
    if (strongest.length > 1) { record.status = 'ambiguous'; record.reason = 'More than one replay matches. No names were assigned.'; }
    else if (strongest.length === 1) { record.status = 'linked'; record.reason = record.autoProcessedAt ? 'Automatically processed from a unique exact ten-player K/D/A match. You can edit the saved match later.' : 'Unique exact ten-player K/D/A match. Ready for automatic processing.'; record.replaySha256 = strongest[0].sha256; record.suggestions = strongest[0].suggestions; }
  }
  // Two independently extracted screenshots must not silently propose conflicting identities.
  for (const record of records.filter(item => item.status === 'linked')) {
    const comparable = (item: ScreenshotPairing) => JSON.stringify([...item.suggestions].sort((a, b) => a.parserPlayerId.localeCompare(b.parserPlayerId)));
    if (records.some(other => other !== record && other.status === 'linked' && other.replaySha256 === record.replaySha256 && comparable(other) !== comparable(record))) {
      const conflicting = records.filter(other => other.status === 'linked' && other.replaySha256 === record.replaySha256);
      for (const other of conflicting) { other.status = 'ambiguous'; other.replaySha256 = null; other.suggestions = []; other.reason = 'Conflicting screenshot names require coach review. No names were assigned.'; }
    }
  }
}

export function screenshotPairingPublic(record: ScreenshotPairing) {
  const { createdBy: _privateActor, ...safe } = record;
  return safe;
}
